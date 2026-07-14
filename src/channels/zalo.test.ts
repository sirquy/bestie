import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../runtime/config.js";
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