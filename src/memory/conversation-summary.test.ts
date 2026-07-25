import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { MAX_RECENT_TURNS } from "../chat/message-builder.js";
import { loadConversationSummaryContext, loadUiConversationSummaryContext, refreshAllConversationSummaries, refreshConversationSummary, refreshUiConversationSummary } from "./conversation-summary.js";
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

test("refreshConversationSummary honors configured recent message limit", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    for (let index = 0; index < 10; index += 1) {
      store.addMessage({ channel: "zalo", userId: "owner", role: index % 2 === 0 ? "user" : "assistant", content: `zalo-${index}` });
    }
  } finally {
    store.close();
  }

  const seenPrompt: string[] = [];
  try {
    await refreshConversationSummary({
      config: { ...config, memory: { recentMessageLimit: 6 } },
      paths,
      apiKey: "test-key",
      channel: "zalo",
      userId: "owner",
      chatCompletion: async (_config, _apiKey, options) => {
        seenPrompt.push(JSON.stringify(options.messages));
        return '{"summary":"Earlier Zalo context."}';
      },
    });

    assert.match(seenPrompt[0] ?? "", /zalo-0/);
    assert.match(seenPrompt[0] ?? "", /zalo-3/);
    assert.doesNotMatch(seenPrompt[0] ?? "", /zalo-4/);

    const checkStore = await SqliteMemoryStore.open(paths);
    try {
      const summary = checkStore.getConversationSummary("zalo", "owner");
      assert.equal(summary?.summarizedMessageId, 4);
    } finally {
      checkStore.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("refreshUiConversationSummary folds only UI messages older than the recent window", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);
  let sessionId = 0;

  try {
    const session = store.createUiChatSession("Long UI chat");
    sessionId = session.id;
    for (let index = 0; index < MAX_RECENT_TURNS + 2; index += 1) {
      store.addUiChatMessage(session.id, index % 2 === 0 ? "user" : "assistant", `ui-${index}`);
    }
  } finally {
    store.close();
  }

  const seenPrompt: string[] = [];
  try {
    await refreshUiConversationSummary({
      config,
      paths,
      apiKey: "test-key",
      sessionId,
      chatCompletion: async (_config, _apiKey, options) => {
        seenPrompt.push(JSON.stringify(options.messages));
        return '{"summary":"User and assistant discussed the earliest UI session context."}';
      },
    });

    assert.match(seenPrompt[0] ?? "", /ui-0/);
    assert.match(seenPrompt[0] ?? "", /ui-1/);
    assert.doesNotMatch(seenPrompt[0] ?? "", /ui-2/);

    const checkStore = await SqliteMemoryStore.open(paths);
    try {
      const summary = checkStore.getConversationSummary("ui", `session:${sessionId}`);
      assert.equal(summary?.content, "User and assistant discussed the earliest UI session context.");
      assert.equal(summary?.summarizedMessageId, 2);
    } finally {
      checkStore.close();
    }

    const context = await loadUiConversationSummaryContext(paths, sessionId);
    assert.equal(context.length, 1);
    assert.match(String(context[0]?.content ?? ""), /earliest UI session context/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("refreshAllConversationSummaries refreshes stale channel and UI summaries", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);
  let sessionId = 0;

  try {
    for (let index = 0; index < 9; index += 1) {
      store.addMessage({ channel: "telegram", userId: "owner", role: index % 2 === 0 ? "user" : "assistant", content: `telegram-long-${index}` });
    }
    for (let index = 0; index < 5; index += 1) {
      store.addMessage({ channel: "zalo", userId: "owner", role: "user", content: `zalo-short-${index}` });
    }
    const session = store.createUiChatSession("Stale UI");
    sessionId = session.id;
    for (let index = 0; index < 8; index += 1) {
      store.addUiChatMessage(session.id, index % 2 === 0 ? "user" : "assistant", `ui-long-${index}`);
    }
  } finally {
    store.close();
  }

  const calls: string[] = [];
  try {
    const report = await refreshAllConversationSummaries({
      config: { ...config, memory: { recentMessageLimit: 6 } },
      paths,
      apiKey: "test-key",
      chatCompletion: async (_config, _apiKey, options) => {
        const prompt = JSON.stringify(options.messages);
        calls.push(prompt);
        return prompt.includes("ui-long") ? '{"summary":"Earlier UI context."}' : '{"summary":"Earlier Telegram context."}';
      },
    });

    assert.equal(report.checked, 2);
    assert.equal(report.refreshed, 2);
    assert.equal(report.failed, 0);
    assert.equal(calls.length, 2);
    assert.ok(calls.some((prompt) => prompt.includes("telegram-long-0") && !prompt.includes("zalo-short")));
    assert.ok(calls.some((prompt) => prompt.includes("ui-long-0")));

    const checkStore = await SqliteMemoryStore.open(paths);
    try {
      assert.equal(checkStore.getConversationSummary("telegram", "owner")?.content, "Earlier Telegram context.");
      assert.equal(checkStore.getConversationSummary("ui", `session:${sessionId}`)?.content, "Earlier UI context.");
      assert.equal(checkStore.getConversationSummary("zalo", "owner"), undefined);
    } finally {
      checkStore.close();
    }
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
