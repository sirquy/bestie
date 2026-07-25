import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { RuntimePaths } from "../runtime/paths.js";
import { loadRelevantMemories } from "./context.js";
import { SqliteMemoryStore } from "./sqlite-store.js";

test("loadRelevantMemories blends query matches with pinned and high-priority anchors", async () => {
  const paths = await createTempPaths();

  try {
    const store = await SqliteMemoryStore.open(paths);
    try {
      const pinned = store.addMemory({ type: "preference", content: "Always answer in Vietnamese.", pinned: true, importance: 1 });
      const relevant = store.addMemory({ type: "project_context", content: "Bestie uses Telegram attachment vision input.", importance: 1 });
      const highPriority = store.addMemory({ type: "durable_decision", content: "Prefer safe local-first automation.", importance: 5 });
      store.addMemory({ type: "one_off", content: "Unrelated low priority note.", importance: 1 });

      const memories = await loadRelevantMemories(paths, { query: "telegram vision", limit: 3, anchorLimit: 2 });

      assert.deepEqual(memories.map((memory) => memory.id), [relevant.id, pinned.id, highPriority.id]);
    } finally {
      store.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("loadRelevantMemories finds memories from noisy conversational prompts", async () => {
  const paths = await createTempPaths();

  try {
    const store = await SqliteMemoryStore.open(paths);
    try {
      const relevant = store.addMemory({ type: "project_context", content: "Project codename Lotus is the launch name.", importance: 1 });
      const anchor = store.addMemory({ type: "preference", content: "Always answer in Vietnamese.", pinned: true, importance: 5 });

      const memories = await loadRelevantMemories(paths, {
        query: "Mình hỏi hơi vòng vòng: hôm qua project có cái codename nào ấy nhỉ, hình như Lotus, bạn nhớ giúp mình không?",
        limit: 2,
        anchorLimit: 1,
      });

      assert.deepEqual(memories.map((memory) => memory.id), [relevant.id, anchor.id]);
    } finally {
      store.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("loadRelevantMemories records access for memories used in provider context", async () => {
  const paths = await createTempPaths();

  try {
    const store = await SqliteMemoryStore.open(paths);
    let relevantId: number;
    try {
      relevantId = store.addMemory({ type: "project_context", content: "Bestie remembers Lotus launch naming.", importance: 1 }).id;
    } finally {
      store.close();
    }

    await loadRelevantMemories(paths, { query: "Lotus launch", limit: 1, anchorLimit: 1 });

    const verifyStore = await SqliteMemoryStore.open(paths);
    try {
      const memory = verifyStore.listActiveMemories().find((candidate) => candidate.id === relevantId);
      assert.equal(memory?.accessCount, 1);
      assert.match(memory?.lastAccessedAt ?? "", /\d{4}-\d{2}-\d{2}/);
    } finally {
      verifyStore.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("loadRelevantMemories returns no memories while memory is paused", async () => {
  const paths = await createTempPaths();

  try {
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "preference", content: "Paused memory should stay hidden." });
      store.setMemoryPaused(true);
    } finally {
      store.close();
    }

    assert.deepEqual(await loadRelevantMemories(paths, { query: "paused" }), []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-memory-context-test-"));
  const appDir = resolve(rootDir, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");
  await mkdir(dataDir, { recursive: true });

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
