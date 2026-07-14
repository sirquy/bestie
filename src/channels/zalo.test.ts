import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../runtime/config.js";
import { createZaloOutboundAdapter, handleZaloUpdate, mapZaloIncomingMessage, type ZaloClient } from "./zalo.js";

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

test("createZaloOutboundAdapter chunks messages at Zalo text limit", () => {
  const adapter = createZaloOutboundAdapter(createRecordingClient([]));
  const chunks = adapter.createResponseAdapter("chat-1").splitMessage("a".repeat(2_001));

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 2_000);
  assert.equal(chunks[1], "a");
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