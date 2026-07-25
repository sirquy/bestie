import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { runMemoryMaintenanceDigest } from "./maintenance.js";
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
  memory: { recentMessageLimit: 6 },
};

test("runMemoryMaintenanceDigest refreshes stale conversation summaries before reporting", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    for (let index = 0; index < 9; index += 1) {
      store.addMessage({ channel: "telegram", userId: "owner", role: index % 2 === 0 ? "user" : "assistant", content: `maintenance-${index}` });
    }
  } finally {
    store.close();
  }

  try {
    const result = await runMemoryMaintenanceDigest({
      config,
      paths,
      apiKey: "test-key",
      summaryChatCompletion: async (_config, _apiKey, options) => {
        assert.match(JSON.stringify(options.messages), /maintenance-0/);
        return '{"summary":"Earlier maintenance context."}';
      },
      isolatedChat: async () => "Digest body.",
    });

    assert.equal(result.ok, true);
    assert.equal(result.conversationSummaryRefresh?.refreshed, 1);
    assert.match(result.output, /^Conversation summary refresh: checked 1, refreshed 1, skipped 0, failed 0\./);
    assert.match(result.output, /Digest body/);

    const checkStore = await SqliteMemoryStore.open(paths);
    try {
      assert.equal(checkStore.getConversationSummary("telegram", "owner")?.content, "Earlier maintenance context.");
    } finally {
      checkStore.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMemoryMaintenanceDigest keeps reporting when summary refresh fails", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    for (let index = 0; index < 9; index += 1) {
      store.addMessage({ channel: "terminal", role: index % 2 === 0 ? "user" : "assistant", content: `terminal-${index}` });
    }
  } finally {
    store.close();
  }

  try {
    const result = await runMemoryMaintenanceDigest({
      config,
      paths,
      apiKey: "test-key",
      summaryChatCompletion: async () => {
        throw new Error("summary provider down");
      },
      isolatedChat: async () => "Digest still ran.",
    });

    assert.equal(result.ok, true);
    assert.equal(result.conversationSummaryRefresh?.failed, 1);
    assert.match(result.output, /^Conversation summary refresh: checked 1, refreshed 0, skipped 0, failed 1\./);
    assert.match(result.output, /Digest still ran/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-maintenance-test-"));
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
