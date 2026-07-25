import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { SqliteMemoryStore } from "../../memory/sqlite-store.js";
import type { RuntimePaths } from "../../runtime/paths.js";
import { getUiMemorySummary } from "./memory.js";

test("getUiMemorySummary includes rolling conversation summaries", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    store.upsertConversationSummary({ channel: "ui", userId: "session:7", content: "Earlier UI context for continuity.", summarizedMessageId: 12 });
    store.upsertConversationSummary({ channel: "telegram", userId: "123", content: "Earlier Telegram context.", summarizedMessageId: 9 });
  } finally {
    store.close();
  }

  try {
    const summary = await getUiMemorySummary(paths);
    assert.equal(summary.counts.conversationSummaries, 2);
    assert.deepEqual(summary.conversationSummaries.map((item) => item.channel).sort(), ["telegram", "ui"]);
    assert.ok(summary.conversationSummaries.some((item) => item.userId === "session:7" && item.content === "Earlier UI context for continuity." && item.summarizedMessageId === 12));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-ui-memory-test-"));
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

