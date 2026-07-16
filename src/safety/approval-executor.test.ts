import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { executeApprovedAction } from "./approval-executor.js";

test("executeApprovedAction approves pending memory", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const pending = store.addPendingMemory({ type: "user_fact", content: "Con heo chỉ có 2 chân", source: "agent-tool", explicitConsent: true });
    const approval = store.addPendingActionApproval({ channel: "telegram", category: "local_write", action: "memory_approve", target: `pending-memory:${pending.id}` });
    const approved = store.approvePendingActionApproval(approval.id);

    assert.ok(approved);
    const result = await executeApprovedAction(store, approved, "approve");

    assert.deepEqual(result, { status: "executed", shortText: "Memory saved.", message: "Memory approved and saved: 1." });
    assert.deepEqual(store.listActiveMemories().map((memory) => memory.content), ["Con heo chỉ có 2 chân"]);
    assert.deepEqual(store.listPendingMemories(), []);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("executeApprovedAction denies pending memory", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const pending = store.addPendingMemory({ type: "user_fact", content: "Temporary claim", source: "agent-tool", explicitConsent: true });
    const approval = store.addPendingActionApproval({ channel: "telegram", category: "local_write", action: "memory_approve", target: `pending-memory:${pending.id}` });
    const denied = store.denyPendingActionApproval(approval.id);

    assert.ok(denied);
    const result = await executeApprovedAction(store, denied, "deny");

    assert.deepEqual(result, { status: "denied", shortText: "Memory denied.", message: "Memory request denied: 1." });
    assert.deepEqual(store.listActiveMemories(), []);
    assert.deepEqual(store.listPendingMemories(), []);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("executeApprovedAction returns unsupported for actions without executors", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const approval = store.addPendingActionApproval({ channel: "telegram", category: "external_write", action: "send_webhook", target: "https://example.invalid/hook" });
    const approved = store.approvePendingActionApproval(approval.id);

    assert.ok(approved);
    const result = await executeApprovedAction(store, approved, "approve");

    assert.equal(result.status, "unsupported");
    assert.match(result.message, /execution for send_webhook is not implemented yet/);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("executeApprovedAction handles missing pending memory targets", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const approval = store.addPendingActionApproval({ channel: "telegram", category: "local_write", action: "memory_approve", target: "pending-memory:404" });
    const approved = store.approvePendingActionApproval(approval.id);

    assert.ok(approved);
    const result = await executeApprovedAction(store, approved, "approve");

    assert.equal(result.status, "invalid");
    assert.match(result.message, /pending memory 404 was not found/);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("executeApprovedAction executes stored internal tool payloads", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const approval = store.addPendingActionApproval({
      channel: "telegram",
      category: "local_write",
      action: "internal.write_file",
      target: "note.txt",
      payloadJson: JSON.stringify({ tool: "internal.write_file", arguments: { path: "note.txt", content: "approved\n" } }),
    });
    const approved = store.approvePendingActionApproval(approval.id);

    assert.ok(approved);
    const result = await executeApprovedAction(store, approved, "approve", { config: createConfig(), paths });

    assert.equal(result.status, "executed");
    assert.match(result.message, /Executed internal\.write_file/);
    assert.equal(await readFile(resolve(paths.workspaceDir, "note.txt"), "utf8"), "approved\n");
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("executeApprovedAction executes approved memory cleanup payloads", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    store.addMemory({ type: "preference", content: "old duplicate", importance: 1 });
    store.addMemory({ type: "preference", content: "stale duplicate", importance: 1 });
    store.addMemory({ type: "durable_decision", content: "keep this", importance: 5 });
    const approval = store.addPendingActionApproval({
      channel: "telegram",
      category: "local_write",
      action: "internal.cleanup_memories",
      target: "2 memories",
      reason: "Cleaning duplicate memories.",
      payloadJson: JSON.stringify({ tool: "internal.cleanup_memories", arguments: { ids: [1, 2], reason: "Cleaning duplicate memories." } }),
    });
    const approved = store.approvePendingActionApproval(approval.id);

    assert.ok(approved);
    const result = await executeApprovedAction(store, approved, "approve", { config: createConfig(), paths });

    assert.equal(result.status, "executed");
    assert.match(result.message, /Executed internal\.cleanup_memories/);
    assert.deepEqual(store.listActiveMemories().map((memory) => memory.content), ["keep this"]);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});


test("executeApprovedAction rejects invalid stored internal tool payloads", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const approval = store.addPendingActionApproval({
      channel: "telegram",
      category: "local_write",
      action: "internal.not_real",
      target: "note.txt",
      payloadJson: JSON.stringify({ tool: "internal.not_real", arguments: { limit: 1 } }),
    });
    const approved = store.approvePendingActionApproval(approval.id);

    assert.ok(approved);
    const result = await executeApprovedAction(store, approved, "approve", { config: createConfig(), paths });

    assert.equal(result.status, "invalid");
    assert.match(result.message, /Stored action payload is invalid/);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("executeApprovedAction does not execute an approved internal tool twice", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const approval = store.addPendingActionApproval({
      channel: "telegram",
      category: "local_write",
      action: "internal.write_file",
      target: "note.txt",
      payloadJson: JSON.stringify({ tool: "internal.write_file", arguments: { path: "note.txt", content: "approved\n", overwrite: true } }),
    });
    const approved = store.approvePendingActionApproval(approval.id);

    assert.ok(approved);
    const first = await executeApprovedAction(store, approved, "approve", { config: createConfig(), paths });
    const second = await executeApprovedAction(store, approved, "approve", { config: createConfig(), paths });

    assert.equal(first.status, "executed");
    assert.equal(second.status, "invalid");
    assert.match(second.message, /not in an executable state|already executed/);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-approval-executor-test-"));
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

function createConfig() {
  return {
    version: 1,
    agent: { name: "Bea", ownerName: "Andy", language: "vi", toneIntensity: 7 },
    llm: { provider: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", model: "test-model", apiKeyEnv: "OPENAI_API_KEY" },
  } as const;
}
