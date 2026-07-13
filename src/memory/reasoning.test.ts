import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { runMemoryReasoningPass } from "./reasoning.js";
import { SqliteMemoryStore } from "./sqlite-store.js";
import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";

test("runMemoryReasoningPass stores allowed durable candidates", async () => {
  const paths = await createTempPaths();

  try {
    const result = await runMemoryReasoningPass({
      config: { ...createConfig(), memory: { writePolicy: "allow" } },
      paths,
      apiKey: "test-key",
      turn: { channel: "terminal", userInput: "I prefer terse answers.", assistantText: "Got it." },
      chatCompletion: async () => '{"candidates":[{"type":"communication_preference","content":"User prefers terse answers.","reason":"The user stated a durable response preference.","confidence":0.9}]}',
    });

    assert.deepEqual(result.stored.map((memory) => `${memory.type}:${memory.content}:${memory.source}`), ["communication_preference:User prefers terse answers.:reasoning:terminal"]);
    assert.deepEqual(result.pending, []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMemoryReasoningPass queues candidates when write policy asks", async () => {
  const paths = await createTempPaths();

  try {
    const result = await runMemoryReasoningPass({
      config: { ...createConfig(), memory: { writePolicy: "ask" } },
      paths,
      apiKey: "test-key",
      turn: { channel: "telegram", userId: "12345", userInput: "This repo is now called Bestie.", assistantText: "Noted." },
      chatCompletion: async () => '{"candidates":[{"type":"project_context","content":"The project is now called Bestie.","reason":"The user announced a durable project rename.","confidence":0.95}]}',
    });

    assert.deepEqual(result.pending.map((memory) => `${memory.type}:${memory.content}:${memory.source}`), ["project_context:The project is now called Bestie.:reasoning:telegram"]);
    assert.match(result.pending[0]?.reason ?? "", /Reasoned from conversation/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMemoryReasoningPass skips secrets duplicates and empty candidates", async () => {
  const paths = await createTempPaths();

  try {
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "project_context", content: "The project is now called Bestie.", source: "test" });
    } finally {
      store.close();
    }

    const result = await runMemoryReasoningPass({
      config: { ...createConfig(), memory: { writePolicy: "allow" } },
      paths,
      apiKey: "test-key",
      turn: { channel: "terminal", userInput: "api key = sk-testsecret123456", assistantText: "I will not store that." },
      chatCompletion: async () =>
        JSON.stringify({
          candidates: [
            { type: "project_context", content: "The project is now called Bestie.", reason: "Duplicate." },
            { type: "project_context", content: "api key = sk-testsecret123456", reason: "Secret." },
            { type: "communication_preference", content: "" },
          ],
        }),
    });

    assert.deepEqual(result.stored, []);
    assert.deepEqual(result.pending, []);
    assert.equal(result.skipped.length, 2);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMemoryReasoningPass does nothing when memory is paused or denied", async () => {
  const paths = await createTempPaths();
  let calls = 0;

  try {
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.setMemoryPaused(true);
    } finally {
      store.close();
    }

    const paused = await runMemoryReasoningPass({
      config: { ...createConfig(), memory: { writePolicy: "allow" } },
      paths,
      apiKey: "test-key",
      turn: { channel: "terminal", userInput: "remember this", assistantText: "ok" },
      chatCompletion: async () => {
        calls += 1;
        return '{"candidates":[]}';
      },
    });

    assert.deepEqual(paused, { stored: [], pending: [], skipped: [] });
    assert.equal(calls, 0);

    const storeAfterPause = await SqliteMemoryStore.open(paths);
    try {
      storeAfterPause.setMemoryPaused(false);
    } finally {
      storeAfterPause.close();
    }

    const denied = await runMemoryReasoningPass({
      config: { ...createConfig(), memory: { writePolicy: "deny" } },
      paths,
      apiKey: "test-key",
      turn: { channel: "terminal", userInput: "remember this", assistantText: "ok" },
      chatCompletion: async () => {
        calls += 1;
        return '{"candidates":[]}';
      },
    });

    assert.deepEqual(denied, { stored: [], pending: [], skipped: [] });
    assert.equal(calls, 0);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

function createConfig(): AppConfig {
  return {
    version: 1,
    agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
    llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "test-model", apiKeyEnv: "OPENAI_API_KEY" },
  };
}

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-memory-reasoning-test-"));
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