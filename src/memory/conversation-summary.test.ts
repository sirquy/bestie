import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { MAX_RECENT_TURNS } from "../chat/message-builder.js";
import { loadConversationSummaryContext, refreshConversationSummary } from "./conversation-summary.js";
import { SqliteMemoryStore } from "./sqlite-store.js";

const config: AppConfig = {
  version: 2,
  agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
  llm: {
    primary: "openai/test-model",
    authProfile: "openai:api-key",
    profiles: { "openai:api-key": { provider: "openai-compatible", mode: "api-key", baseUrl: "https://example.com/v1", apiKeyEnv: "OPENAI_API_KEY" } },
    modelCatalog: { "openai/test-model": { profile: "openai:api-key" } },
  },
};

test("refreshConversationSummary folds only messages older than the recent window", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    for (let index = 0; index < MAX_RECENT_TURNS + 2; index += 1) {
      store.addMessage({ channel: "telegram", userId: "12345", role: index % 2 === 0 ? "user" : "assistant", content: `telegram-${index}` });
    }
    store.addMessage({ channel: "telegram", userId: "99999", role: "user", content: "other-user" });
  } finally {
    store.close();
  }

  const seenPrompt: string[] = [];
  try {
    await refreshConversationSummary({
      config,
      paths,
      apiKey: "test-key",
      channel: "telegram",
      userId: "12345",
      chatCompletion: async (_config, _apiKey, options) => {
        seenPrompt.push(JSON.stringify(options.messages));
        return '{"summary":"User and assistant discussed the earliest Telegram context."}';
      },
    });

    assert.match(seenPrompt[0] ?? "", /telegram-0/);
    assert.match(seenPrompt[0] ?? "", /telegram-1/);
    assert.doesNotMatch(seenPrompt[0] ?? "", /telegram-2/);
    assert.doesNotMatch(seenPrompt[0] ?? "", /other-user/);

    const checkStore = await SqliteMemoryStore.open(paths);
    try {
      const summary = checkStore.getConversationSummary("telegram", "12345");
      assert.equal(summary?.content, "User and assistant discussed the earliest Telegram context.");
      assert.equal(summary?.summarizedMessageId, 2);
    } finally {
      checkStore.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("loadConversationSummaryContext returns a system message when summary exists", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    store.upsertConversationSummary({ channel: "terminal", content: "Earlier terminal context", summarizedMessageId: 4 });
  } finally {
    store.close();
  }

  try {
    const context = await loadConversationSummaryContext(paths, "terminal");
    assert.equal(context.length, 1);
    assert.equal(context[0]?.role, "system");
    assert.match(String(context[0]?.content ?? ""), /Earlier terminal context/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-conversation-summary-test-"));
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
