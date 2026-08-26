import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { ProviderResponseError } from "../llm/errors.js";
import { handleCronChannelCommand } from "../cron/channel-commands.js";
import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import type { AppConfig } from "../runtime/config.js";
import { writeEnvFile } from "../runtime/env.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { ZaloHttpClient, createZaloOutboundAdapter, handleZaloUpdate, mapZaloIncomingMessage, stripMarkdown, type ZaloClient } from "./zalo.js";

const config: AppConfig = {
  version: 2,
  agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
  llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key" as const,
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
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

test("createZaloOutboundAdapter routes group text and typing to the group thread", async () => {
  const calls: Array<{ chatId: string; text?: string; threadType?: number }> = [];
  const client = {
    ...createRecordingClient([]),
    sendMessage: async (chatId: string, text: string, options?: { threadType?: 0 | 1 }) => { calls.push({ chatId, text, threadType: options?.threadType }); },
    sendChatAction: async (chatId: string, _action: "typing", threadType?: 0 | 1) => { calls.push({ chatId, threadType }); },
  } satisfies ZaloClient;
  const adapter = createZaloOutboundAdapter(client, 1);
  await adapter.createResponseAdapter("group-1").sendMessage("hello group");
  await adapter.createActivityOptions("group-1", "typing").client.sendChatAction("group-1", "typing");
  assert.deepEqual(calls, [
    { chatId: "group-1", text: "hello group", threadType: 1 },
    { chatId: "group-1", threadType: 1 },
  ]);
});

test("createZaloOutboundAdapter quotes the triggering Zalo Personal group message once", async () => {
  const calls: Array<{ text: string; options?: { threadType?: 0 | 1; quote?: unknown } }> = [];
  const quote = { msgId: "message-1", uidFrom: "member-1" };
  const client = {
    ...createRecordingClient([]),
    sendMessage: async (_chatId: string, text: string, options?: { threadType?: 0 | 1; quote?: unknown }) => { calls.push({ text, options }); },
  } satisfies ZaloClient;
  const adapter = createZaloOutboundAdapter(client, 1, quote);

  await adapter.createResponseAdapter("group-1").sendMessage("first reply");
  await adapter.createResponseAdapter("group-1").sendMessage("second reply");

  assert.deepEqual(calls, [
    { text: "first reply", options: { threadType: 1, quote } },
    { text: "second reply", options: { threadType: 1 } },
  ]);
});

test("createZaloOutboundAdapter omits Markdown formatting for Zalo Personal", async () => {
  const calls: Array<{ options?: { parseMode?: "Markdown"; threadType?: 0 | 1 } }> = [];
  const client = {
    ...createRecordingClient([]),
    sendMessage: async (_chatId: string, _text: string, options?: { parseMode?: "Markdown"; threadType?: 0 | 1 }) => { calls.push({ options }); },
  } satisfies ZaloClient;
  const adapter = createZaloOutboundAdapter(client, 0, undefined, true);

  await adapter.createResponseAdapter("controller-1").sendMessage("# **plain** [text](https://example.com)\n- `code`");

  assert.deepEqual(calls, [{ options: { threadType: 0 } }]);
  assert.equal(stripMarkdown("# **plain** [text](https://example.com)\n- `code`"), "plain text\ncode");
});

test("handleZaloUpdate applies Zalo Personal group policy and mention gating", async () => {
  const paths = fakePaths();
  const sent: Array<{ chatId: string; text: string }> = [];
  const groupConfig: AppConfig = {
    ...config,
    channels: {
      ...config.channels,
      zaloPersonal: {
        enabled: true,
        sessionEnv: "BESTIE_ZALO_PERSONAL_SESSION",
        ownerUserId: "controller-1",
        groupPolicy: "allowlist",
        groups: ["group-1"],
        groupAllowFrom: ["member-1"],
        requireMention: true,
      },
    },
  };

  assert.equal(await handleZaloUpdate({ update_id: 1, message: { from: { id: "member-1" }, chat: { id: "group-1", type: "group" }, text: "hello" } }, { config: groupConfig, paths, client: createRecordingClient(sent), channel: "zalo-personal" }), "ignored");
  assert.equal(await handleZaloUpdate({ update_id: 2, message: { from: { id: "member-1" }, chat: { id: "group-2", type: "group" }, text: "@Miu hello" } }, { config: groupConfig, paths, client: createRecordingClient(sent), channel: "zalo-personal" }), "ignored");
  assert.equal(await handleZaloUpdate({ update_id: 3, message: { from: { id: "member-2" }, chat: { id: "group-1", type: "group" }, text: "@Miu hello" } }, { config: groupConfig, paths, client: createRecordingClient(sent), channel: "zalo-personal", chatCompletion: async () => '{"answer":"must be ignored"}' }), "ignored");
  assert.equal(await handleZaloUpdate({ update_id: 4, message: { from: { id: "member-1" }, chat: { id: "group-1", type: "group" }, text: "@Miu hello" } }, { config: groupConfig, paths, client: createRecordingClient(sent), channel: "zalo-personal", chatCompletion: async () => '{"answer":"hi"}' }), "replied");
  assert.equal(sent.at(-1)?.chatId, "group-1");
});

test("handleZaloUpdate blocks slash commands in Zalo Personal groups", async () => {
  const sent: Array<{ chatId: string; text: string }> = [];
  const groupConfig: AppConfig = {
    ...config,
    channels: {
      ...config.channels,
      zaloPersonal: { enabled: true, sessionEnv: "BESTIE_ZALO_PERSONAL_SESSION", ownerUserId: "controller-1", groupPolicy: "allowlist", groups: ["group-1"], requireMention: false },
    },
  };

  assert.equal(await handleZaloUpdate({ update_id: 1, message: { from: { id: "member-1" }, chat: { id: "group-1", type: "group" }, text: "/help" } }, { config: groupConfig, paths: fakePaths(), client: createRecordingClient(sent), channel: "zalo-personal" }), "replied");
  assert.match(sent[0]?.text ?? "", /Commands are not available/);
});

test("handleZaloUpdate accepts any mentioned group member in open wildcard mode", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];
  const chatActions: Array<{ chatId: string; action: string }> = [];
  const openConfig: AppConfig = {
    ...config,
    channels: {
      ...config.channels,
      zaloPersonal: {
        enabled: true,
        sessionEnv: "BESTIE_ZALO_PERSONAL_SESSION",
        ownerUserId: "controller-1",
        groupPolicy: "open",
        groups: ["*"],
        groupAllowFrom: ["*"],
        requireMention: true,
      },
    },
  };

  try {
    await writeRuntimeFiles(paths);
    const result = await handleZaloUpdate(
      { update_id: 1, message: { from: { id: "any-member" }, chat: { id: "any-group", type: "group" }, text: "@Miu hello" } },
      { config: openConfig, paths, client: createRecordingClient(sent), channel: "zalo-personal", chatCompletion: async () => '{"answer":"hello group"}' },
    );

    assert.equal(result, "replied");
    assert.equal(sent.at(-1)?.chatId, "any-group");
    assert.equal(sent.at(-1)?.text, "hello group");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("mapZaloIncomingMessage represents sticker-only messages as chat input", () => {
  const incoming = mapZaloIncomingMessage({
    from: { id: "customer-a" },
    chat: { id: "chat-a" },
    sticker: { emoji: "🙂" },
  });

  assert.equal(incoming.text, "[User sent a sticker.]");
});

test("ZaloHttpClient sends text messages with Markdown parse mode", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new ZaloHttpClient("bot-token", async (input, init) => {
    calls.push({ url: String(input), init });
    return jsonResponse({ ok: true, result: { message_id: "123" } });
  });

  const sent = await client.sendMessage("user-1", "**Hello**");

  assert.deepEqual(sent, { message_id: "123" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://bot-api.zaloplatforms.com/botbot-token/sendMessage");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(calls[0]?.init?.headers, { "content-type": "application/json" });
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    chat_id: "user-1",
    text: "**Hello**",
    parse_mode: "Markdown",
  });
});

test("ZaloHttpClient sends documents through Zalo Bot API message attachments", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new ZaloHttpClient("bot-token", async (input, init) => {
    calls.push({ url: String(input), init });
    return jsonResponse({ ok: true, result: { messageId: "321" } });
  });

  const sent = await client.sendDocument("user-1", new Uint8Array([1, 2, 3]), { fileName: "report.txt", mimeType: "text/plain", caption: "Here" });

  assert.deepEqual(sent, { messageId: "321" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://bot-api.zaloplatforms.com/botbot-token/sendMessage");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(calls[0]?.init?.headers, { "content-type": "application/json" });
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    chat_id: "user-1",
    text: "Here",
    attachments: [{ type: "file", url: "data:text/plain;base64,AQID", file_name: "report.txt", mime_type: "text/plain", size: 3 }],
  });
});

test("ZaloHttpClient sends photos through Zalo Bot API JSON photo field", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new ZaloHttpClient("bot-token", async (input, init) => {
    calls.push({ url: String(input), init });
    return jsonResponse({ ok: true, result: { message_id: "654" } });
  });

  const sent = await client.sendPhoto("user-1", new Uint8Array([137, 80, 78, 71]), { fileName: "image.png", mimeType: "image/png", caption: "Look" });

  assert.deepEqual(sent, { message_id: "654" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://bot-api.zaloplatforms.com/botbot-token/sendPhoto");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(calls[0]?.init?.headers, { "content-type": "application/json" });
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    chat_id: "user-1",
    photo: "data:image/png;base64,iVBORw==",
    caption: "Look",
  });
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

test("ZaloHttpClient maps getFile metadata", async () => {
  const client = new ZaloHttpClient("test-token", async () => jsonResponse({ ok: true, result: { file_id: "file-1", file_url: "https://example.com/file.txt", file_size: 10 } }));

  const file = await client.getFile("file-1");

  assert.deepEqual(file, { fileId: "file-1", filePath: "https://example.com/file.txt", fileSize: 10 });
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

test("handleZaloUpdate saves document attachments and sends metadata to LLM", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];
  let requestMessages: unknown;

  try {
    await writeRuntimeFiles(paths);
    const client: ZaloClient = {
      ...createRecordingClient(sent),
      getFile: async (fileId) => ({ fileId, filePath: "documents/note.txt", fileSize: 11 }),
      downloadFile: async () => new TextEncoder().encode("hello zalo"),
    };

    const result = await handleZaloUpdate(
      { update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, caption: "please read this", document: { file_id: "file-1", file_name: "note.txt", mime_type: "text/plain", file_size: 11 } } },
      {
        config,
        paths,
        client,
        chatCompletion: async (_config, _apiKey, options) => {
          requestMessages = options.messages;
          const systemText = String(options.messages[0]?.content ?? "");
          return systemText.includes("memory reasoning pass") ? '{"candidates":[]}' : '{"answer":"Đã đọc file Zalo."}';
        },
      },
    );

    assert.equal(result, "replied");
    assert.equal(sent.at(-1)?.text, "Đã đọc file Zalo.");
    assert.match(JSON.stringify(requestMessages), /User caption: please read this/);
    assert.match(JSON.stringify(requestMessages), /Kind: document/);
    assert.match(JSON.stringify(requestMessages), /Text preview \(text\):/);
    assert.match(JSON.stringify(requestMessages), /hello zalo/);
    const savedPathMatch = JSON.stringify(requestMessages).match(/Local path: ([^\\"]+)/);
    assert.ok(savedPathMatch?.[1]);
    assert.match(savedPathMatch[1], /\/media\/inbound\/zalo-/);
    assert.equal(await readFile(savedPathMatch[1], "utf8"), "hello zalo");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleZaloUpdate attaches photo bytes to LLM when primary provider supports vision", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];
  let requestMessages: unknown;
  const imageBytes = new Uint8Array([1, 2, 3, 4]);

  try {
    await writeRuntimeFiles(paths);
    const client: ZaloClient = {
      ...createRecordingClient(sent),
      downloadFile: async () => imageBytes,
    };

    const result = await handleZaloUpdate(
      { update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, caption: "what is this?", photo: { file_url: "https://example.com/photo.jpg", file_name: "photo.jpg", mime_type: "image/jpeg", file_size: imageBytes.byteLength } } },
      {
        config,
        paths,
        client,
        chatCompletion: async (_config, _apiKey, options) => {
          requestMessages = options.messages;
          const systemText = String(options.messages[0]?.content ?? "");
          return systemText.includes("memory reasoning pass") ? '{"candidates":[]}' : '{"answer":"Đã xem ảnh Zalo."}';
        },
      },
    );

    assert.equal(result, "replied");
    assert.equal(sent.at(-1)?.text, "Đã xem ảnh Zalo.");
    assert.match(JSON.stringify(requestMessages), /image_url/);
    assert.match(JSON.stringify(requestMessages), /data:image\/jpeg;base64/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleZaloUpdate sanitizes pending knowledge graph items from Zalo", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];

  try {
    await writeRuntimeFiles(paths);
    const store = await SqliteMemoryStore.open(paths);
    let pendingId: number;
    try {
      pendingId = store.addPendingKnowledgeItem({
        payload: {
          entities: [
            { name: "Integration credential", kind: "concept" },
            { name: "Bestie", kind: "project" },
          ],
          relations: [{ sourceName: "Bestie", sourceKind: "project", type: "mentions", targetName: "Integration credential", targetKind: "concept", evidence: "api_key: sk-secret1234567890 was found in docs and should be removed." }],
        },
        reason: "Needs approval.",
        source: "test",
      }).id;
    } finally {
      store.close();
    }

    const result = await handleZaloUpdate(
      { update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: `/graph pending sanitize ${pendingId}` } },
      { config, paths, client: createRecordingClient(sent) },
    );

    assert.equal(result, "replied");
    assert.match(sent[0]?.text ?? "", new RegExp(`Pending knowledge graph item sanitized: #${pendingId}`));
    assert.match(sent[0]?.text ?? "", new RegExp(`/memory graph approve ${pendingId}`));
    assert.doesNotMatch(sent[0]?.text ?? "", /sk-secret1234567890/);

    const verifyStore = await SqliteMemoryStore.open(paths);
    try {
      assert.doesNotMatch(JSON.stringify(verifyStore.getPendingKnowledgeItem(pendingId)?.payload), /sk-secret1234567890|api_key/);
    } finally {
      verifyStore.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleZaloUpdate manages cron schedules for the current chat", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];
  let triggeredId: number | undefined;

  try {
    await writeRuntimeFiles(paths);
    const store = await SqliteMemoryStore.open(paths);
    const own = store.addCronSchedule({ name: "Zalo mine", scheduleType: "interval", scheduleValue: "1h", prompt: "A", channel: "zalo:chat-1", nextRunAt: new Date(Date.now() + 60_000).toISOString() });
    store.addCronSchedule({ name: "Zalo other", scheduleType: "interval", scheduleValue: "1h", prompt: "B", channel: "zalo:chat-2", nextRunAt: new Date(Date.now() + 60_000).toISOString() });
    store.close();

    await handleZaloUpdate({ update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/cron list" } }, { config, paths, client: createRecordingClient(sent) });
    await handleZaloUpdate({ update_id: 2, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: `/cron update ${own.id} --name "Zalo updated" --schedule 2h --prompt "Updated task" --disable` } }, { config, paths, client: createRecordingClient(sent) });
    await handleCronChannelCommand({
      text: `/cron trigger ${own.id}`,
      paths,
      channel: "zalo",
      userId: "chat-1",
      sendMessage: (message) => {
        sent.push({ chatId: "chat-1", text: message });
        return Promise.resolve();
      },
      triggerSchedule: async (scheduleId) => { triggeredId = scheduleId; },
    });
    await handleZaloUpdate({ update_id: 3, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: `/cron delete ${own.id}` } }, { config, paths, client: createRecordingClient(sent) });

    assert.match(sent[0].text, /#\d+ Zalo mine/);
    assert.doesNotMatch(sent[0].text, /Zalo other/);
    assert.match(sent[1].text, /Cron schedule \d+ updated\./);
    assert.match(sent[1].text, /Zalo updated/);
    assert.match(sent[2].text, /Triggering cron schedule/);
    assert.match(sent[3].text, /triggered/);
    assert.equal(triggeredId, own.id);
    assert.match(sent[4].text, new RegExp(`Cron schedule ${own.id} deleted\\.`));
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
    await handleZaloUpdate({ update_id: 5, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory rebalance dry-run" } }, { config, paths, client: createRecordingClient(sent) });
    await handleZaloUpdate({ update_id: 6, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "/memory rebalance apply confirm" } }, { config: { ...config, memory: { deletePolicy: "allow" } }, paths, client: createRecordingClient(sent) });

    assert.match(sent[0].text, /Active memories \/ core \(1\)/);
    assert.match(sent[1].text, new RegExp(`Memory #${id} moved to session`));
    assert.match(sent[2].text, /Active memories \/ session \(1\)/);
    assert.match(sent[2].text, /Move from Zalo/);
    assert.match(sent[3].text, /Memory tiers \(1 active\)/);
    assert.match(sent[3].text, /session: 1 active/);
    assert.match(sent[3].text, /Next: \/memory scope session/);
    assert.match(sent[4].text, /Memory rebalance dry-run \(1 checked\)/);
    assert.match(sent[4].text, new RegExp(`#${id} \\[preference\\] session -> core`));
    assert.match(sent[4].text, /Next: \/memory move <id> core\|project\|session/);
    assert.match(sent[5].text, /Memory rebalance applied: 1 moved/);
    assert.match(sent[5].text, new RegExp(`#${id} session->core`));

    const checkStore = await SqliteMemoryStore.open(paths);
    try {
      assert.equal(checkStore.getActiveMemory(id)?.scope, "core");
    } finally {
      checkStore.close();
    }
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

test("handleZaloUpdate sends knowledge graph approval prompts for reasoned Zalo items", async () => {
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
          if (callCount === 1) return '{"answer":"Noted."}';
          if (callCount === 2) return '{"candidates":[]}';
          return '{"entities":[{"name":"Bestie","kind":"project","confidence":0.95}],"relations":[]}';
        },
      },
    );

    assert.equal(result, "replied");
    assert.match(sent.at(-1)?.text ?? "", /Knowledge graph approval needed\. Request: \d+/);
    assert.match(sent.at(-1)?.text ?? "", /Bestie/);
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

test("handleZaloUpdate sends outbound files and photos through the Zalo client", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];
  const sentDocuments: Array<{ chatId: string; bytes: number[]; fileName?: string; mimeType?: string; caption?: string }> = [];
  const sentPhotos: Array<{ chatId: string; bytes: number[]; fileName?: string; mimeType?: string; caption?: string }> = [];
  let callCount = 0;
  const client: ZaloClient = {
    ...createRecordingClient(sent),
    sendDocument: async (chatId, bytes, options) => {
      sentDocuments.push({ chatId, bytes: [...bytes], fileName: options?.fileName, mimeType: options?.mimeType, caption: options?.caption });
      return { messageId: "doc-1" };
    },
    sendPhoto: async (chatId, bytes, options) => {
      sentPhotos.push({ chatId, bytes: [...bytes], fileName: options?.fileName, mimeType: options?.mimeType, caption: options?.caption });
      return { messageId: "photo-1" };
    },
  };

  try {
    await writeRuntimeFiles(paths);
    await mkdir(paths.workspaceDir, { recursive: true });
    await writeFile(resolve(paths.workspaceDir, "report.txt"), "hello file");
    await writeFile(resolve(paths.workspaceDir, "image.png"), new Uint8Array([137, 80, 78, 71]));

    const result = await handleZaloUpdate(
      { update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "send the files" } },
      {
        config,
        paths,
        client,
        chatCompletion: async () => {
          callCount += 1;
          if (callCount === 1) return '{"tool":"internal.send_file","arguments":{"path":"report.txt","caption":"Report"}}';
          if (callCount === 2) return '{"tool":"internal.send_photo","arguments":{"path":"image.png","caption":"Image"}}';
          return '{"answer":"sent"}';
        },
      },
    );

    assert.equal(result, "replied");
    assert.deepEqual(sentDocuments, [{ chatId: "chat-1", bytes: [...Buffer.from("hello file")], fileName: "report.txt", mimeType: "text/plain", caption: "Report" }]);
    assert.deepEqual(sentPhotos, [{ chatId: "chat-1", bytes: [137, 80, 78, 71], fileName: "image.png", mimeType: "image/png", caption: "Image" }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleZaloUpdate isolates public customer context and uses only the bound agent knowledge", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];
  const chatActions: Array<{ chatId: string; action: string }> = [];
  const chatRequests: Array<{ messages: unknown[] }> = [];
  let completionCalls = 0;
  const promptPath = resolve(paths.appDir, "agents", "support", "system-prompt.md");
  const publicConfig: AppConfig = {
    ...config,
    channels: {
      zalo: {
        enabled: true,
        botTokenEnv: "BESTIE_ZALO_BOT_TOKEN",
        ownerUserId: ["*"],
        adminUserIds: ["operator-1"],
      },
    },
    agents: {
      support: {
        enabled: true,
        displayName: "Support",
        role: "Customer support",
        description: "Answers customers from the approved support knowledge base.",
        promptPath,
        channels: ["zalo"],
        memoryScope: "agent:support",
        approvalPolicy: "deny-external-actions",
        public: { enabled: true, customerMemory: "isolated", knowledgeAccess: "agent-only", toolPolicy: "deny" },
      },
    },
  };

  try {
    await writeRuntimeFiles(paths);
    await mkdir(resolve(paths.appDir, "agents", "support"), { recursive: true });
    await writeFile(promptPath, "You are the public support agent.");
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "user_fact", content: "Customer A has an active subscription.", namespace: "agent:support:customer:customer-a" });
      store.addMemory({ type: "user_fact", content: "Customer B has a billing dispute.", namespace: "agent:support:customer:customer-b" });
      store.addMemory({ type: "project_context", content: "Internal billing escalation secret.", namespace: "primary" });
      store.addMessage({ channel: "zalo", userId: "agent:support:user:customer-b", role: "user", content: "Customer B private conversation." });
      store.upsertKnowledgeEntity({ canonicalName: "Public subscription guide", kind: "topic", namespace: "agent:support:knowledge" });
      store.upsertKnowledgeEntity({ canonicalName: "Internal subscription playbook", kind: "topic", namespace: "primary" });
    } finally {
      store.close();
    }

    const result = await handleZaloUpdate({ update_id: 1, message: { from: { id: "customer-a" }, chat: { id: "chat-a" }, text: "Can you help with my subscription?" } }, {
      config: publicConfig,
      paths,
      client: createRecordingClient(sent, chatActions),
      chatCompletion: async (_config, _apiKey, options) => {
        chatRequests.push({ messages: options.messages as unknown[] });
        completionCalls += 1;
        return completionCalls === 1
          ? '{"tool":"internal.list_files","arguments":{"path":".","limit":10}}'
          : "Public support reply.";
      },
    });

    assert.equal(result, "replied");
    const prompt = JSON.stringify(chatRequests[0]?.messages ?? []);
    assert.match(prompt, /Customer A has an active subscription/);
    assert.match(prompt, /Public subscription guide/);
    assert.doesNotMatch(prompt, /Customer B has a billing dispute|Customer B private conversation|Internal billing escalation secret|Internal subscription playbook/);
    assert.deepEqual(sent, [{ chatId: "chat-a", text: "Public support reply." }]);
    assert.deepEqual(chatActions, []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleZaloUpdate blocks management commands for public channel admins", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];
  const publicConfig: AppConfig = {
    ...config,
    channels: {
      zalo: {
        enabled: true,
        botTokenEnv: "BESTIE_ZALO_BOT_TOKEN",
        ownerUserId: ["*"],
        adminUserIds: ["operator-1"],
      },
    },
  };

  try {
    const result = await handleZaloUpdate({ update_id: 1, message: { from: { id: "operator-1" }, chat: { id: "public-chat" }, text: "/memory list" } }, {
      config: publicConfig,
      paths,
      client: createRecordingClient(sent),
      chatCompletion: async () => {
        throw new Error("The provider must not be called for public commands.");
      },
    });

    assert.equal(result, "replied");
    assert.deepEqual(sent, [{ chatId: "public-chat", text: "Commands are not available in this public support chat." }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("handleZaloUpdate sends generated media to an explicit Zalo Personal direct-message target", async () => {
  const paths = await createTempPaths();
  const sent: Array<{ chatId: string; text: string }> = [];
  const sentDocuments: Array<{ chatId: string; bytes: number[]; fileName?: string; mimeType?: string; caption?: string }> = [];
  let callCount = 0;
  const client: ZaloClient = {
    ...createRecordingClient(sent),
    sendDocument: async (chatId, bytes, options) => {
      sentDocuments.push({ chatId, bytes: [...bytes], fileName: options?.fileName, mimeType: options?.mimeType, caption: options?.caption });
      return { messageId: "doc-1" };
    },
  };
  const personalConfig: AppConfig = {
    ...config,
    channels: {
      ...config.channels,
      zaloPersonal: { enabled: true, sessionEnv: "BESTIE_ZALO_PERSONAL_SESSION", ownerUserId: "controller-1" },
    },
  };

  try {
    await writeRuntimeFiles(paths);
    await mkdir(paths.workspaceDir, { recursive: true });
    await writeFile(resolve(paths.workspaceDir, "report.txt"), "hello personal");

    const result = await handleZaloUpdate(
      { update_id: 1, message: { from: { id: "controller-1" }, chat: { id: "controller-1" }, text: "send the file" } },
      {
        config: personalConfig,
        paths,
        client,
        channel: "zalo-personal",
        chatCompletion: async () => {
          callCount += 1;
          return callCount === 1
            ? '{"tool":"internal.send_file","arguments":{"path":"report.txt","caption":"Personal report","channel":"zalo-personal:target-2"}}'
            : '{"answer":"sent"}';
        },
      },
    );

    assert.equal(result, "replied");
    assert.deepEqual(sentDocuments, [{ chatId: "target-2", bytes: [...Buffer.from("hello personal")], fileName: "report.txt", mimeType: "text/plain", caption: "Personal report" }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

function createRecordingClient(sent: Array<{ chatId: string; text: string }>, chatActions: Array<{ chatId: string; action: string }> = []): ZaloClient {
  return {
    getUpdates: async () => [],
    sendMessage: async (chatId, text) => {
      sent.push({ chatId, text });
    },
    sendChatAction: async (chatId, action) => { chatActions.push({ chatId, action }); },
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
