import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
      store.addMemory({ type: "preference", content: "Vietnamese-first replies", importance: 5 });
      store.addMemory({ type: "preference", content: "Vietnamese-first replies", importance: 1 });
      store.addMemory({ type: "project_context", content: "Old context", importance: 1, expiresAt: "2020-01-01T00:00:00.000Z" });
    } finally {
      store.close();
    }

    await handleZaloUpdate({ update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory analyze" } }, { config, paths, client: createRecordingClient(sent) });
    await handleZaloUpdate({ update_id: 2, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory cleanup --dry-run" } }, { config, paths, client: createRecordingClient(sent) });

    assert.match(sent[0].text, /Memory analysis \(3 checked\)/);
    assert.match(sent[0].text, /Duplicates: 1 group\(s\)/);
    assert.match(sent[0].text, /Stale: 1/);
    assert.match(sent[1].text, /Memory cleanup dry-run \(3 checked\)/);
    assert.match(sent[1].text, /Would delete: #2, #3/);
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
  await writeEnvFile({ OPENAI_API_KEY: "sk-test" }, paths);
  await writeFile(paths.systemPromptPath, "You are Miu.\n");
}