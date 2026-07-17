import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { ProviderResponseError } from "../llm/errors.js";
import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import type { AppConfig } from "../runtime/config.js";
import { writeEnvFile } from "../runtime/env.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { ZaloHttpClient, createZaloOutboundAdapter, handleZaloUpdate, mapZaloIncomingMessage, type ZaloClient } from "./zalo.js";

const config: AppConfig = {
  version: 1,
  agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
  llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY" },
  channels: { zalo: { enabled: true, botTokenEnv: "BESTIE_ZALO_BOT_TOKEN", ownerUserId: "owner-1" } },
};

test("mapZaloIncomingMessage normalizes string ids and text", () => {
  const incoming = mapZaloIncomingMessage({ message_id: "m-1", from: { id: "owner-1" }, chat: { id: "chat-1" }, text: { text: "hello" } });

  assert.equal(incoming.chatId, "chat-1");
  assert.equal(incoming.messageId, "m-1");
  assert.equal(incoming.senderId, "owner-1");
  assert.equal(incoming.text, "hello");
});

test("mapZaloIncomingMessage accepts alternate Zalo id fields", () => {
  const incoming = mapZaloIncomingMessage({ message_id: "m-2", sender_id: "owner-2", chat_id: "chat-2", text: "hello" });

  assert.equal(incoming.chatId, "chat-2");
  assert.equal(incoming.senderId, "owner-2");
  assert.equal(incoming.text, "hello");
});

test("createZaloOutboundAdapter chunks messages at Zalo text limit", () => {
  const adapter = createZaloOutboundAdapter(createRecordingClient([]));
  const chunks = adapter.createResponseAdapter("chat-1").splitMessage("a".repeat(2_001));

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 2_000);
  assert.equal(chunks[1], "a");
});

test("ZaloHttpClient accepts object-wrapped getUpdates results", async () => {
  const client = new ZaloHttpClient("test-token", async () => jsonResponse({ ok: true, result: { updates: [{ update_id: 1, message: { text: "hello" } }] } }));

  const updates = await client.getUpdates(undefined, 20);

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.update_id, 1);
});

test("ZaloHttpClient can capture redacted getUpdates result structure", async () => {
  const captured: Record<string, unknown>[] = [];
  const client = new ZaloHttpClient(
    "test-token",
    async () => jsonResponse({ ok: true, result: { event_name: "message.text.received", message: { text: "secret text" } } }),
    { captureGetUpdatesShape: (shape) => { captured.push(shape); } },
  );

  await client.getUpdates(undefined, 20);

  assert.deepEqual(captured[0], {
    type: "object",
    keys: ["event_name", "message"],
    fields: {
      event_name: { type: "string", length: 21 },
      message: { type: "object", keys: ["text"], fields: { text: { type: "string", length: 11 } } },
    },
  });
});

test("ZaloHttpClient accepts a single getUpdates result object", async () => {
  const client = new ZaloHttpClient("test-token", async () => jsonResponse({ ok: true, result: { event_name: "message.text.received", message: { text: "hello" } } }));

  const updates = await client.getUpdates(undefined, 20);

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.message?.text, "hello");
  assert.equal(typeof updates[0]?.update_id, "number");
});

test("ZaloHttpClient treats getUpdates timeout as no updates", async () => {
  const client = new ZaloHttpClient("test-token", async () => jsonResponse({ ok: false, error_code: 408, description: "Request timeout" }));

  assert.deepEqual(await client.getUpdates(undefined, 20), []);
});

test("ZaloHttpClient treats string timeout code as no updates", async () => {
  const client = new ZaloHttpClient("test-token", async () => jsonResponse({ ok: false, error_code: "408", description: "Request timeout" }));

  assert.deepEqual(await client.getUpdates(undefined, 20), []);
});

test("ZaloHttpClient treats empty getUpdates result as no updates", async () => {
  const client = new ZaloHttpClient("test-token", async () => jsonResponse({ ok: true, result: { count: 0 } }));

  assert.deepEqual(await client.getUpdates(undefined, 20), []);
});

test("ZaloHttpClient treats metadata-only getUpdates result as no updates", async () => {
  const client = new ZaloHttpClient("test-token", async () => jsonResponse({ ok: true, result: { count: 0, offset: 10, has_more: false } }));

  assert.deepEqual(await client.getUpdates(undefined, 20), []);
});

test("ZaloHttpClient rejects unexpected getUpdates result shape", async () => {
  const client = new ZaloHttpClient("test-token", async () => jsonResponse({ ok: true, result: { status: "ready" } }));

  await assert.rejects(() => client.getUpdates(undefined, 20), /result keys: status/);
});

test("handleZaloUpdate ignores non-owner messages", async () => {
  const sent: Array<{ chatId: string; text: string }> = [];
  const result = await handleZaloUpdate(
    { update_id: 1, message: { from: { id: "stranger" }, chat: { id: "chat-1" }, text: "hello" } },
    { config, paths: fakePaths(), client: createRecordingClient(sent) },
  );

  assert.equal(result, "ignored");
  assert.deepEqual(sent, []);
});

test("handleZaloUpdate replies to owner help command", async () => {
  const sent: Array<{ chatId: string; text: string }> = [];
  const result = await handleZaloUpdate(
    { update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/help" } },
    { config, paths: fakePaths(), client: createRecordingClient(sent) },
  );

  assert.equal(result, "replied");
  assert.match(sent[0]?.text ?? "", /\/memory pending/);
});

test("handleZaloUpdate manages cron schedules for the current chat", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const store = await SqliteMemoryStore.open(paths);
    const own = store.addCronSchedule({ name: "Zalo mine", scheduleType: "interval", scheduleValue: "1h", prompt: "A", channel: "zalo:chat-1", nextRunAt: new Date(Date.now() + 60_000).toISOString() });
    store.addCronSchedule({ name: "Zalo other", scheduleType: "interval", scheduleValue: "1h", prompt: "B", channel: "zalo:chat-2", nextRunAt: new Date(Date.now() + 60_000).toISOString() });
    store.close();

    await handleZaloUpdate({ update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/cron list" } }, { config, paths, client: createRecordingClient(sent) });
    await handleZaloUpdate({ update_id: 2, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: `/cron delete ${own.id}` } }, { config, paths, client: createRecordingClient(sent) });

    assert.match(sent[0].text, /#\d+ Zalo mine/);
    assert.doesNotMatch(sent[0].text, /Zalo other/);
    assert.match(sent[1].text, new RegExp(`Cron schedule ${own.id} deleted\\.`));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleZaloUpdate reports memory analysis and cleanup dry-run", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "project_context", content: "Vietnamese-first replies", importance: 5 });
      store.addMemory({ type: "project_context", content: "Vietnamese-first replies", importance: 1 });
      store.addMemory({ type: "project_context", content: "Old context", importance: 1, expiresAt: "2020-01-01T00:00:00.000Z" });
    } finally {
      store.close();
    }

    await handleZaloUpdate({ update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory analyze" } }, { config, paths, client: createRecordingClient(sent) });
    await handleZaloUpdate({ update_id: 2, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory cleanup --dry-run" } }, { config, paths, client: createRecordingClient(sent) });
    await handleZaloUpdate({ update_id: 3, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory hygiene" } }, { config, paths, client: createRecordingClient(sent) });
    await handleZaloUpdate({ update_id: 4, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory hygiene status" } }, { config: { ...config, memory: { deletePolicy: "ask", retrievalPolicy: "governed" } }, paths, client: createRecordingClient(sent) });
    await handleZaloUpdate({ update_id: 5, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory hygiene doctor" } }, { config: { ...config, memory: { deletePolicy: "allow", retrievalPolicy: "full" } }, paths, client: createRecordingClient(sent) });
    await handleZaloUpdate({ update_id: 6, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory hygiene trend" } }, { config, paths, client: createRecordingClient(sent) });

    assert.match(sent[0].text, /Memory analysis \(3 checked\)/);
    assert.match(sent[0].text, /Duplicates: 1 group\(s\)/);
    assert.match(sent[0].text, /Stale: 1/);
    assert.match(sent[1].text, /Memory cleanup dry-run \(3 checked\)/);
    assert.match(sent[1].text, /Would delete: #2, #3/);
    assert.match(sent[2].text, /Memory hygiene dry-run \(3 checked\)/);
    assert.match(sent[2].text, /Would delete: #2, #3/);
    assert.match(sent[3].text, /Memory hygiene status \(3 checked\)/);
    assert.match(sent[3].text, /Memory hygiene score: \d+\/100 \((healthy|attention|needs cleanup)\)/);
    assert.match(sent[3].text, /Delete policy: ask/);
    assert.match(sent[3].text, /Next safe command: \/memory hygiene apply confirm/);
    assert.match(sent[4].text, /Memory hygiene doctor: \d+ issue\(s\)/);
    assert.match(sent[4].text, /Memory hygiene score: \d+\/100 \((healthy|attention|needs cleanup)\)/);
    assert.match(sent[4].text, /\[WARN\] Maintenance digest/);
    assert.match(sent[5].text, /Memory hygiene trend \(2 snapshot\(s\)\)/);
    assert.match(sent[5].text, /Recent snapshots:/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleZaloUpdate applies memory hygiene when delete policy allows", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "project_context", content: "Apply hygiene from Zalo", importance: 5 });
      store.addMemory({ type: "project_context", content: "Apply hygiene from Zalo", importance: 1 });
      store.addMemory({ type: "project_context", content: "Old Zalo context", importance: 1, expiresAt: "2020-01-01T00:00:00.000Z" });
      store.addMemory({ type: "preference", content: "Use voice replies" });
      store.addMemory({ type: "preference", content: "Do not use voice replies" });
    } finally {
      store.close();
    }

    await handleZaloUpdate({ update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory hygiene apply" } }, { config: { ...config, memory: { deletePolicy: "allow" } }, paths, client: createRecordingClient(sent) });

    assert.match(sent[0].text, /Memory hygiene applied \(5 checked\)/);
    assert.match(sent[0].text, /Deleted: #2, #3/);
    assert.match(sent[0].text, /Review only: #4, #5/);

    const checkStore = await SqliteMemoryStore.open(paths);
    try {
      assert.equal(checkStore.getActiveMemory(1)?.content, "Apply hygiene from Zalo");
      assert.equal(checkStore.getActiveMemory(2), undefined);
      assert.equal(checkStore.getActiveMemory(3), undefined);
      assert.equal(checkStore.getActiveMemory(4)?.content, "Use voice replies");
      assert.equal(checkStore.getActiveMemory(5)?.content, "Do not use voice replies");
    } finally {
      checkStore.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleZaloUpdate reports memory governance status", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "project_context", content: "Vietnamese-first replies", importance: 5 });
      store.addMemory({ type: "project_context", content: "Vietnamese-first replies", importance: 1 });
      store.addMemory({ type: "project_context", content: "Old context", importance: 1, expiresAt: "2020-01-01T00:00:00.000Z" });
    } finally {
      store.close();
    }

    await handleZaloUpdate({ update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory governance status" } }, { config: { ...config, memory: { retrievalPolicy: "governed" } }, paths, client: createRecordingClient(sent) });

    assert.match(sent[0].text, /Memory governance status/);
    assert.match(sent[0].text, /Retrieval policy: governed/);
    assert.match(sent[0].text, /Duplicate memories: 1 across 1 group\(s\)/);
    assert.match(sent[0].text, /Stale memories: 1/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleZaloUpdate updates memory retrieval policy", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);

    await handleZaloUpdate({ update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory governance policy governed" } }, { config, paths, client: createRecordingClient(sent) });
    const updated = JSON.parse(await readFile(paths.configPath, "utf8")) as { memory?: { retrievalPolicy?: string } };

    assert.match(sent[0].text, /memory\.retrievalPolicy set to governed/);
    assert.equal(updated.memory?.retrievalPolicy, "governed");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleZaloUpdate pins and unpins active memories", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const store = await SqliteMemoryStore.open(paths);
    let id: number;
    try {
      id = store.addMemory({ type: "preference", content: "Pin from Zalo" }).id;
    } finally {
      store.close();
    }

    await handleZaloUpdate({ update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: `/memory pin ${id}` } }, { config, paths, client: createRecordingClient(sent) });
    await handleZaloUpdate({ update_id: 2, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: `/memory unpin ${id}` } }, { config, paths, client: createRecordingClient(sent) });

    const checkStore = await SqliteMemoryStore.open(paths);
    try {
      assert.match(sent[0].text, new RegExp(`Memory pinned: #${id}`));
      assert.match(sent[1].text, new RegExp(`Memory unpinned: #${id}`));
      assert.equal(checkStore.getActiveMemory(id)?.pinned, false);
    } finally {
      checkStore.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleZaloUpdate lists and moves memory scopes", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const store = await SqliteMemoryStore.open(paths);
    let id: number;
    try {
      id = store.addMemory({ type: "preference", content: "Move from Zalo" }).id;
    } finally {
      store.close();
    }

    await handleZaloUpdate({ update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory scope core" } }, { config, paths, client: createRecordingClient(sent) });
    await handleZaloUpdate({ update_id: 2, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: `/memory move ${id} session` } }, { config, paths, client: createRecordingClient(sent) });
    await handleZaloUpdate({ update_id: 3, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory scope session" } }, { config, paths, client: createRecordingClient(sent) });
    await handleZaloUpdate({ update_id: 4, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory tiers" } }, { config, paths, client: createRecordingClient(sent) });

    assert.match(sent[0].text, /Active memories \/ core \(1\)/);
    assert.match(sent[1].text, new RegExp(`Memory #${id} moved to session`));
    assert.match(sent[2].text, /Active memories \/ session \(1\)/);
    assert.match(sent[2].text, /Move from Zalo/);
    assert.match(sent[3].text, /Memory tiers \(1 active\)/);
    assert.match(sent[3].text, /session: 1 active/);
    assert.match(sent[3].text, /Next: \/memory scope session/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleZaloUpdate inspects a memory record", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const store = await SqliteMemoryStore.open(paths);
    let id: number;
    try {
      id = store.addMemory({ type: "project_context", content: "Inspect from Zalo", scope: "session", pinned: true }).id;
    } finally {
      store.close();
    }

    await handleZaloUpdate({ update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: `/memory inspect ${id}` } }, { config, paths, client: createRecordingClient(sent) });

    assert.match(sent[0].text, new RegExp(`Memory #${id}`));
    assert.match(sent[0].text, /Type: project_context/);
    assert.match(sent[0].text, /Scope: session/);
    assert.match(sent[0].text, /Pinned: yes/);
    assert.match(sent[0].text, /Content:\nInspect from Zalo/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleZaloUpdate supersedes active memories", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const store = await SqliteMemoryStore.open(paths);
    let oldId: number;
    let newId: number;
    try {
      oldId = store.addMemory({ type: "project_context", content: "Old Zalo fact" }).id;
      newId = store.addMemory({ type: "project_context", content: "New Zalo fact" }).id;
    } finally {
      store.close();
    }

    await handleZaloUpdate({ update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: `/memory supersede ${oldId} ${newId}` } }, { config, paths, client: createRecordingClient(sent) });

    const checkStore = await SqliteMemoryStore.open(paths);
    try {
      assert.match(sent[0].text, new RegExp(`Memory #${oldId} superseded by #${newId}`));
      assert.equal(checkStore.getActiveMemory(oldId)?.supersededBy, newId);
    } finally {
      checkStore.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleZaloUpdate manages memory maintenance reports", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);

    await handleZaloUpdate({ update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory maintenance install" } }, { config, paths, client: createRecordingClient(sent) });
    await handleZaloUpdate({ update_id: 2, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory maintenance status" } }, { config, paths, client: createRecordingClient(sent) });
    await handleZaloUpdate({ update_id: 3, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory maintenance remove" } }, { config, paths, client: createRecordingClient(sent) });

    assert.match(sent[0].text, /Memory maintenance report installed: #\d+/);
    assert.match(sent[0].text, /Channel: zalo:chat-1/);
    assert.match(sent[1].text, /Memory maintenance report: #\d+ enabled/);
    assert.match(sent[1].text, /Channel: zalo:chat-1/);
    assert.match(sent[2].text, /Memory maintenance report removed: #\d+/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleZaloUpdate replies with sanitized provider error details", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const result = await handleZaloUpdate(
      { update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "hello" } },
      {
        config,
        paths,
        client: createRecordingClient(sent),
        chatCompletion: async () => {
          throw new ProviderResponseError('500 Internal Server Error: {"error":{"message":"Upstream provider request failed"}}', 500);
        },
      },
    );

    assert.equal(result, "replied");
    assert.match(sent.at(-1)?.text ?? "", /could not get a provider response/);
    assert.match(sent.at(-1)?.text ?? "", /Upstream provider request failed/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleZaloUpdate sends memory approval prompts for reasoned Zalo memories", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];
  let callCount = 0;

  try {
    await writeRuntimeFiles(paths);
    const result = await handleZaloUpdate(
      { update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "This repo is called Bestie." } },
      {
        config: { ...config, memory: { writePolicy: "ask" } },
        paths,
        client: createRecordingClient(sent),
        chatCompletion: async () => {
          callCount += 1;
          return callCount === 1
            ? '{"answer":"Noted."}'
            : '{"candidates":[{"type":"project_context","content":"The repo is called Bestie.","reason":"The user named the repo.","confidence":0.95}]}';
        },
      },
    );

    assert.equal(result, "replied");
    assert.match(sent.at(-1)?.text ?? "", /Memory approval needed\. Request: \d+/);
    assert.match(sent.at(-1)?.text ?? "", /Content: The repo is called Bestie\./);
    assert.match(sent.at(-1)?.text ?? "", /Reply \/approve \d+ to save it or \/deny \d+ to reject it\./);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleZaloUpdate uses friendly tool progress labels", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];
  let callCount = 0;

  try {
    await writeRuntimeFiles(paths);
    await mkdir(paths.workspaceDir, { recursive: true });
    await writeFile(resolve(paths.workspaceDir, "notes.md"), "hello\n");

    const result = await handleZaloUpdate(
      { update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "read notes" } },
      {
        config,
        paths,
        client: createRecordingClient(sent),
        chatCompletion: async () => {
          callCount += 1;
          return callCount === 1 ? '{"tool":"internal.read_file","arguments":{"path":"notes.md"}}' : '{"answer":"notes read"}';
        },
      },
    );

    assert.equal(result, "replied");
    assert.ok(sent.some((message) => /Miu is reading file notes\.md/.test(message.text)));
    assert.equal(sent.some((message) => /internal\.read_file/.test(message.text)), false);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

function createRecordingClient(sent: Array<{ chatId: string; text: string }>): ZaloClient {
  return {
    getUpdates: async () => [],
    sendMessage: async (chatId, text) => {
      sent.push({ chatId, text });
    },
    sendChatAction: async () => undefined,
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

function fakePaths() {
  return {
    rootDir: "/tmp/bestie-zalo-test",
    appDir: "/tmp/bestie-zalo-test/.bestie",
    configPath: "/tmp/bestie-zalo-test/.bestie/config.json",
    envPath: "/tmp/bestie-zalo-test/.bestie/.env",
    characterPath: "/tmp/bestie-zalo-test/.bestie/character.json",
    systemPromptPath: "/tmp/bestie-zalo-test/.bestie/system-prompt.md",
    logsDir: "/tmp/bestie-zalo-test/.bestie/logs",
    appLogPath: "/tmp/bestie-zalo-test/.bestie/logs/app.log",
    dataDir: "/tmp/bestie-zalo-test/.bestie/data",
    memoryDbPath: "/tmp/bestie-zalo-test/.bestie/data/memory.sqlite",
    workspaceDir: "/tmp/bestie-zalo-test/.bestie/workspace",
  };
}

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-zalo-test-"));
  const appDir = resolve(rootDir, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");

  return {
    rootDir,
    appDir,
    configPath: resolve(appDir, "config.json"),
    envPath: resolve(appDir, ".env"),
    characterPath: resolve(appDir, "character.json"),
    systemPromptPath: resolve(appDir, "system-prompt.md"),
    logsDir,
    appLogPath: resolve(logsDir, "app.log"),
    dataDir,
    memoryDbPath: resolve(dataDir, "memory.sqlite"),
    workspaceDir: resolve(appDir, "workspace"),
  };
}

async function writeRuntimeFiles(paths: RuntimePaths): Promise<void> {
  await mkdir(paths.dataDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await writeFile(paths.configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await writeEnvFile({ OPENAI_API_KEY: "sk-test" }, paths);
  await writeFile(paths.systemPromptPath, "You are Miu.\n");
}