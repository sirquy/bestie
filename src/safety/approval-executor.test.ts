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

test("executeApprovedAction approves pending knowledge graph items", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const pending = store.addPendingKnowledgeItem({ payload: { entities: [{ name: "Bestie", kind: "project" }], relations: [] }, source: "agent-tool" });
    const approval = store.addPendingActionApproval({ channel: "telegram", category: "local_write", action: "knowledge_approve", target: `pending-knowledge:${pending.id}` });
    const approved = store.approvePendingActionApproval(approval.id);

    assert.ok(approved);
    const result = await executeApprovedAction(store, approved, "approve");

    assert.deepEqual(result, { status: "executed", shortText: "Knowledge graph saved.", message: "Knowledge graph approved and saved: 1 entities, 0 relations." });
    assert.deepEqual(store.listKnowledgeEntities().map((entity) => entity.canonicalName), ["Bestie"]);
    assert.deepEqual(store.listPendingKnowledgeItems(), []);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("executeApprovedAction reports blocked pending knowledge approval", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const pending = store.addPendingKnowledgeItem({
      payload: {
        entities: [{ name: "Integration credential", kind: "concept" }],
        relations: [{ sourceName: "Integration credential", sourceKind: "concept", type: "contains", targetName: "Token", targetKind: "concept", evidence: "api_key: sk-secret1234567890" }],
      },
      source: "agent-tool",
    });
    const approval = store.addPendingActionApproval({ channel: "telegram", category: "local_write", action: "knowledge_approve", target: `pending-knowledge:${pending.id}` });
    const approved = store.approvePendingActionApproval(approval.id);

    assert.ok(approved);
    const result = await executeApprovedAction(store, approved, "approve");

    assert.equal(result.status, "invalid");
    assert.equal(result.shortText, "Knowledge graph blocked.");
    assert.match(result.message, /API key field/);
    assert.match(result.message, /No graph fact was stored/);
    assert.ok(store.getPendingKnowledgeItem(pending.id));
    assert.deepEqual(store.listKnowledgeEntities(), []);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("executeApprovedAction denies pending knowledge graph items", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const pending = store.addPendingKnowledgeItem({ payload: { entities: [{ name: "Temporary", kind: "topic" }], relations: [] }, source: "agent-tool" });
    const approval = store.addPendingActionApproval({ channel: "telegram", category: "local_write", action: "knowledge_approve", target: `pending-knowledge:${pending.id}` });
    const denied = store.denyPendingActionApproval(approval.id);

    assert.ok(denied);
    const result = await executeApprovedAction(store, denied, "deny");

    assert.deepEqual(result, { status: "denied", shortText: "Knowledge graph denied.", message: "Knowledge graph request denied: 1." });
    assert.deepEqual(store.listKnowledgeEntities(), []);
    assert.deepEqual(store.listPendingKnowledgeItems(), []);
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

test("executeApprovedAction executes approved knowledge graph merge payloads", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    store.upsertKnowledgeEntity({ canonicalName: "Bestie", kind: "project", aliases: ["Bestie Agent"] });
    store.upsertKnowledgeEntity({ canonicalName: "bestie-agent", kind: "project" });
    const approval = store.addPendingActionApproval({
      channel: "telegram",
      category: "local_write",
      action: "internal.merge_knowledge_entities",
      target: "entity #1 <- #2",
      payloadJson: JSON.stringify({ tool: "internal.merge_knowledge_entities", arguments: { primaryId: 1, duplicateId: 2, reason: "same project alias" } }),
    });
    const approved = store.approvePendingActionApproval(approval.id);

    assert.ok(approved);
    const result = await executeApprovedAction(store, approved, "approve", { config: createConfig(), paths });

    assert.equal(result.status, "executed");
    assert.match(result.message, /Executed internal\.merge_knowledge_entities/);
    assert.equal(store.getKnowledgeEntity(2), undefined);
    assert.deepEqual(store.getKnowledgeEntity(1)?.aliases, ["Bestie Agent", "bestie-agent"]);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("executeApprovedAction executes approved knowledge relation review payloads", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const user = store.upsertKnowledgeEntity({ canonicalName: "User", kind: "person" });
    const bestie = store.upsertKnowledgeEntity({ canonicalName: "Bestie", kind: "project" });
    store.upsertKnowledgeRelation({ sourceEntityId: user.id, relationType: "works_on", targetEntityId: bestie.id, evidence: "Initial evidence.", confidence: 0.4 });
    const approval = store.addPendingActionApproval({
      channel: "telegram",
      category: "local_write",
      action: "internal.update_knowledge_relation",
      target: "relation #1",
      payloadJson: JSON.stringify({ tool: "internal.update_knowledge_relation", arguments: { id: 1, confidence: 0.72, evidence: "Reviewed evidence.", reason: "reviewed relation metadata" } }),
    });
    const approved = store.approvePendingActionApproval(approval.id);

    assert.ok(approved);
    const result = await executeApprovedAction(store, approved, "approve", { config: createConfig(), paths });

    assert.equal(result.status, "executed");
    assert.match(result.message, /Executed internal\.update_knowledge_relation/);
    const relation = store.getKnowledgeRelation(1);
    assert.equal(relation?.confidence, 0.72);
    assert.equal(relation?.evidence, "Reviewed evidence.");
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
    version: 2,
    agent: { name: "Bea", ownerName: "Andy", language: "vi", toneIntensity: 7 },
    llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key" as const,
          baseUrl: "http://127.0.0.1:9/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
  } as const;
}
