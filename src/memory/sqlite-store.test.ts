import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { SqliteMemoryStore } from "./sqlite-store.js";
import type { RuntimePaths } from "../runtime/paths.js";

test("SqliteMemoryStore creates schema and stores active memories", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const inserted = store.addMemory({
      type: "communication_preference",
      content: "User prefers concise replies.",
      importance: 5,
      source: "manual-command",
      explicitConsent: true,
      policyReason: "User explicitly added this memory.",
    });

    assert.equal(inserted.id, 1);
    assert.equal(inserted.sensitivity, "normal");
    assert.equal(inserted.importance, 5);
    assert.equal(inserted.source, "manual-command");
    assert.equal(inserted.explicitConsent, true);
    assert.equal(inserted.policyReason, "User explicitly added this memory.");
    assert.deepEqual(store.listAllMemories().map((memory) => memory.content), ["User prefers concise replies."]);
    assert.deepEqual(store.listActiveMemories().map((memory) => memory.content), ["User prefers concise replies."]);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore forgetMemory hides active memories", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const inserted = store.addMemory({ type: "preference", content: "User likes terse answers." });

    assert.equal(store.forgetMemory(inserted.id), true);
    assert.equal(store.forgetMemory(inserted.id), false);
    assert.deepEqual(store.listActiveMemories(), []);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore can pin and unpin active memories", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const inserted = store.addMemory({ type: "preference", content: "Important preference" });

    assert.equal(store.setMemoryPinned(inserted.id, true)?.pinned, true);
    assert.equal(store.getActiveMemory(inserted.id)?.pinned, true);
    assert.equal(store.setMemoryPinned(inserted.id, false)?.pinned, false);
    assert.equal(store.setMemoryPinned(999, true), undefined);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore assigns and moves memory scopes", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const core = store.addMemory({ type: "preference", content: "Core preference" });
    const project = store.addMemory({ type: "project_context", content: "Project context" });
    const session = store.addMemory({ type: "preference", content: "Short-lived context", scope: "session" });

    assert.equal(core.scope, "core");
    assert.equal(core.expiresAt, undefined);
    assert.equal(project.scope, "project");
    assert.equal(project.expiresAt, undefined);
    assert.equal(session.scope, "session");
    assert.ok(session.expiresAt);
    assert.ok(Date.parse(session.expiresAt) > Date.now());
    assert.deepEqual(store.listActiveMemoriesByScope("core").map((memory) => memory.id), [core.id]);
    const moved = store.setMemoryScope(core.id, "session");
    assert.equal(moved?.scope, "session");
    assert.ok(moved?.expiresAt);
    assert.ok(Date.parse(moved.expiresAt) > Date.now());
    assert.deepEqual(store.listActiveMemoriesByScope("session").map((memory) => memory.id), [core.id, session.id]);
    assert.equal(store.setMemoryScope(999, "core"), undefined);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore marks active memories as superseded", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const oldMemory = store.addMemory({ type: "project_context", content: "Old project fact" });
    const newMemory = store.addMemory({ type: "project_context", content: "New project fact" });

    const updated = store.supersedeMemory(oldMemory.id, newMemory.id);

    assert.equal(updated?.supersededBy, newMemory.id);
    assert.equal(store.getActiveMemory(oldMemory.id)?.supersededBy, newMemory.id);
    assert.equal(store.supersedeMemory(oldMemory.id, oldMemory.id), undefined);
    assert.equal(store.supersedeMemory(oldMemory.id, 999), undefined);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore lists all active memories by default", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    for (let index = 1; index <= 25; index += 1) {
      store.addMemory({ type: "preference", content: `Memory ${index}` });
    }

    assert.equal(store.listActiveMemories().length, 25);
    assert.equal(store.listActiveMemories(20).length, 20);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore searches active memories by content and type", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    store.addMemory({ type: "preference", content: "User prefers concise replies." });
    store.addMemory({ type: "project_context", content: "Working on Bestie terminal memory." });
    const deleted = store.addMemory({ type: "preference", content: "Deleted concise memory." });

    assert.equal(store.forgetMemory(deleted.id), true);
    assert.deepEqual(store.searchMemories("concise").map((memory) => memory.content), ["User prefers concise replies."]);
    assert.deepEqual(store.searchMemories("project_context").map((memory) => memory.content), ["Working on Bestie terminal memory."]);
    assert.deepEqual(store.searchMemories("   "), []);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore uses full-text memory search and keeps the index synchronized", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const first = store.addMemory({ type: "project_context", content: "Working on Bestie terminal memory." });
    const second = store.addMemory({ type: "preference", content: "User prefers concise replies." });

    assert.deepEqual(store.searchMemories("memories terminal").map((memory) => memory.content), ["Working on Bestie terminal memory."]);

    store.updateMemoryContent(first.id, "Working on Telegram voice replies.");
    assert.deepEqual(store.searchMemories("terminal memory"), []);
    assert.deepEqual(store.searchMemories("voice reply").map((memory) => memory.content), ["Working on Telegram voice replies."]);

    assert.equal(store.forgetMemory(second.id), true);
    assert.deepEqual(store.searchMemories("concise replies"), []);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore stores and searches knowledge graph entities and relations", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const memory = store.addMemory({ type: "project_context", content: "User is building Bestie with SQLite memory." });
    const user = store.upsertKnowledgeEntity({ canonicalName: "User", kind: "person", aliases: ["Boss"], sourceMemoryId: memory.id, confidence: 0.8 });
    const bestie = store.upsertKnowledgeEntity({ canonicalName: "Bestie", kind: "project", aliases: ["Bestie Agent"], sourceMemoryId: memory.id, confidence: 0.7 });
    const duplicate = store.upsertKnowledgeEntity({ canonicalName: "Bestie", kind: "project", aliases: ["bestie agent", "Local Bestie"], confidence: 0.9 });

    assert.equal(duplicate.id, bestie.id);
    assert.equal(duplicate.confidence, 0.9);
    assert.deepEqual(duplicate.aliases, ["Bestie Agent", "Local Bestie"]);

    const relation = store.upsertKnowledgeRelation({ sourceEntityId: user.id, relationType: "works on", targetEntityId: bestie.id, evidence: "User is building Bestie.", sourceMemoryId: memory.id, confidence: 0.75 });
    const relationAgain = store.upsertKnowledgeRelation({ sourceEntityId: user.id, relationType: "works_on", targetEntityId: bestie.id, confidence: 0.85 });

    assert.equal(relationAgain?.id, relation?.id);
    assert.equal(relationAgain?.confidence, 0.85);
    assert.deepEqual(store.listKnowledgeAuditEvents("entity", bestie.id).map((event) => event.eventType), ["updated", "created"]);
    assert.deepEqual(store.listKnowledgeAuditEvents("relation", relation!.id).map((event) => event.eventType), ["updated", "created"]);
    assert.deepEqual(store.searchKnowledgeGraph("Bestie").entities.map((entity) => entity.canonicalName), ["Bestie"]);
    assert.deepEqual(store.searchKnowledgeGraph("works").relations.map((item) => `${item.sourceEntity.canonicalName}:${item.relationType}:${item.targetEntity.canonicalName}`), ["User:works_on:Bestie"]);
    assert.deepEqual(store.getKnowledgeEntityNeighborhood(bestie.id).map((item) => item.relationType), ["works_on"]);
    assert.deepEqual(store.getKnowledgeGraphStats(), { entities: 2, relations: 1, pending: 0 });
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore handles pending and deleted knowledge graph items", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const pending = store.addPendingKnowledgeItem({ payload: { entity: "Sensitive" }, reason: "Needs approval.", source: "test", explicitConsent: true });
    assert.deepEqual(store.getPendingKnowledgeItem(pending.id)?.payload, { entity: "Sensitive" });
    assert.equal(store.listPendingKnowledgeItems().length, 1);
    assert.equal(store.rejectPendingKnowledgeItem(pending.id), true);
    assert.deepEqual(store.listKnowledgeAuditEvents("pending", pending.id).map((event) => event.eventType), ["rejected", "queued"]);
    assert.equal(store.rejectPendingKnowledgeItem(pending.id), false);

    const first = store.upsertKnowledgeEntity({ canonicalName: "User", kind: "person" });
    const second = store.upsertKnowledgeEntity({ canonicalName: "Bestie", kind: "project" });
    const relation = store.upsertKnowledgeRelation({ sourceEntityId: first.id, relationType: "works_on", targetEntityId: second.id });

    assert.equal(store.forgetKnowledgeRelation(relation!.id), true);
    assert.equal(store.listKnowledgeAuditEvents("relation", relation!.id)[0]?.eventType, "forgotten");
    assert.deepEqual(store.listKnowledgeRelations(), []);
    assert.equal(store.forgetKnowledgeEntity(first.id), true);
    assert.equal(store.listKnowledgeAuditEvents("entity", first.id)[0]?.eventType, "forgotten");
    assert.deepEqual(store.searchKnowledgeGraph("User").entities, []);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore updates knowledge relation review metadata", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const user = store.upsertKnowledgeEntity({ canonicalName: "User", kind: "person" });
    const bestie = store.upsertKnowledgeEntity({ canonicalName: "Bestie", kind: "project" });
    const relation = store.upsertKnowledgeRelation({ sourceEntityId: user.id, relationType: "works_on", targetEntityId: bestie.id, evidence: "Initial evidence.", confidence: 0.4 });

    assert.ok(relation);
    const updated = store.updateKnowledgeRelation(relation.id, { evidence: "Reviewed evidence.", confidence: 1.3, scope: "project", sensitivity: "sensitive" });

    assert.equal(updated?.evidence, "Reviewed evidence.");
    assert.equal(updated?.confidence, 1);
    assert.equal(updated?.scope, "project");
    assert.equal(updated?.sensitivity, "sensitive");
    assert.equal(store.listKnowledgeAuditEvents("relation", relation.id)[0]?.eventType, "updated");

    const cleared = store.updateKnowledgeRelation(relation.id, { evidence: "" });
    assert.equal(cleared?.evidence, undefined);
    assert.equal(store.updateKnowledgeRelation(404, { confidence: 0.5 }), undefined);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore approves pending knowledge graph items", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const pending = store.addPendingKnowledgeItem({
      payload: {
        entities: [
          { name: "User", kind: "person", aliases: ["Boss"], confidence: 0.8 },
          { name: "Bestie", kind: "project", aliases: ["Bestie Agent"], confidence: 0.9 },
        ],
        relations: [
          { sourceName: "User", sourceKind: "person", type: "works_on", targetName: "Bestie", targetKind: "project", evidence: "User is building Bestie.", confidence: 0.85 },
        ],
      },
      reason: "Needs approval.",
      source: "test",
    });

    const approved = store.approvePendingKnowledgeItem(pending.id);

    assert.equal(approved?.status, "approved");
    if (approved?.status !== "approved") throw new Error("Expected pending knowledge item to be approved.");
    assert.equal(approved?.entities.length, 2);
    assert.equal(approved?.relations.length, 1);
    assert.deepEqual(store.listKnowledgeAuditEvents("pending", pending.id).map((event) => event.eventType), ["approved", "queued"]);
    assert.equal(store.listKnowledgeAuditEvents("entity", approved.entities[0]!.id)[0]?.eventType, "approved");
    assert.equal(store.getPendingKnowledgeItem(pending.id), undefined);
    assert.deepEqual(store.searchKnowledgeGraph("Bestie").entities.map((entity) => entity.canonicalName), ["Bestie"]);
    assert.deepEqual(store.searchKnowledgeGraph("works").relations.map((relation) => relation.relationType), ["works_on"]);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore blocks unsafe pending knowledge approval without deleting the pending item", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const pending = store.addPendingKnowledgeItem({
      payload: {
        entities: [{ name: "Payment note", kind: "concept" }],
        relations: [{ sourceName: "Payment note", sourceKind: "concept", type: "mentions", targetName: "User", targetKind: "person", evidence: "Card number 4111 1111 1111 1111 should not be stored." }],
      },
      reason: "Needs approval.",
      source: "test",
    });

    const blocked = store.approvePendingKnowledgeItem(pending.id);

    assert.equal(blocked?.status, "blocked");
    if (blocked?.status !== "blocked") throw new Error("Expected pending knowledge item to be blocked.");
    assert.deepEqual(blocked.diagnostics?.blockedBy, ["payment_card_like"]);
    assert.match(blocked.explanation ?? "", /payment card details/);
    assert.ok(store.getPendingKnowledgeItem(pending.id));
    assert.deepEqual(store.listKnowledgeEntities(), []);
    assert.deepEqual(store.listKnowledgeRelations(), []);
    assert.deepEqual(store.listKnowledgeAuditEvents("pending", pending.id).map((event) => event.eventType), ["blocked", "queued"]);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore sanitizes unsafe pending knowledge items before approval", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const pending = store.addPendingKnowledgeItem({
      payload: {
        entities: [
          { name: "Integration credential", kind: "concept" },
          { name: "Bestie", kind: "project" },
        ],
        relations: [{ sourceName: "Bestie", sourceKind: "project", type: "mentions", targetName: "Integration credential", targetKind: "concept", evidence: "api_key: sk-secret1234567890 was found in docs and should be removed." }],
      },
      reason: "Needs approval.",
      source: "test",
    });

    const sanitized = store.sanitizePendingKnowledgeItem(pending.id);

    assert.equal(sanitized?.status, "sanitized");
    if (sanitized?.status !== "sanitized") throw new Error("Expected pending knowledge item to be sanitized.");
    assert.deepEqual(sanitized.previousDiagnostics?.blockedBy, ["api_key_assignment", "openai_key"]);
    assert.doesNotMatch(JSON.stringify(sanitized.item.payload), /sk-secret1234567890|api_key/);
    assert.match(JSON.stringify(sanitized.item.payload), /REDACTED SECRET-LIKE VALUE/);

    const approved = store.approvePendingKnowledgeItem(pending.id);
    assert.equal(approved?.status, "approved");
    if (approved?.status !== "approved") throw new Error("Expected sanitized pending knowledge item to be approved.");
    assert.equal(approved.entities.length, 2);
    assert.equal(approved.relations.length, 1);
    assert.equal(store.getPendingKnowledgeItem(pending.id), undefined);
    assert.deepEqual(store.listKnowledgeAuditEvents("pending", pending.id).map((event) => event.eventType), ["approved", "sanitized", "queued"]);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore merges duplicate knowledge entities", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const user = store.upsertKnowledgeEntity({ canonicalName: "User", kind: "person" });
    const bestie = store.upsertKnowledgeEntity({ canonicalName: "Bestie", kind: "project", aliases: ["Bestie Agent"], confidence: 0.7 });
    const duplicate = store.upsertKnowledgeEntity({ canonicalName: "Bestie-Agent", kind: "project", aliases: ["Local Bestie"], confidence: 0.9 });
    store.upsertKnowledgeRelation({ sourceEntityId: user.id, relationType: "works_on", targetEntityId: duplicate.id, evidence: "Duplicate target." });

    const result = store.mergeKnowledgeEntities(bestie.id, duplicate.id);

    assert.equal(result?.primary.id, bestie.id);
    assert.equal(store.getKnowledgeEntity(duplicate.id), undefined);
    assert.equal(store.listKnowledgeAuditEvents("entity", bestie.id)[0]?.eventType, "merged");
    assert.equal(store.listKnowledgeAuditEvents("entity", duplicate.id)[0]?.eventType, "merged_into");
    assert.deepEqual(store.getKnowledgeEntity(bestie.id)?.aliases, ["Bestie Agent", "Bestie-Agent", "Local Bestie"]);
    assert.deepEqual(store.searchKnowledgeGraph("works_on").relations.map((relation) => `${relation.sourceEntityId}:${relation.targetEntityId}`), [`${user.id}:${bestie.id}`]);
    assert.equal(store.mergeKnowledgeEntities(bestie.id, user.id), undefined);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore updateMemoryContent edits active memories only", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const inserted = store.addMemory({ type: "preference", content: "Original memory." });
    const updated = store.updateMemoryContent(inserted.id, "Updated memory.");

    assert.equal(updated?.id, inserted.id);
    assert.equal(updated?.content, "Updated memory.");
    assert.deepEqual(store.listActiveMemories().map((memory) => memory.content), ["Updated memory."]);

    assert.equal(store.forgetMemory(inserted.id), true);
    assert.equal(store.updateMemoryContent(inserted.id, "Should not update."), undefined);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore approves and rejects pending memories", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const pending = store.addPendingMemory({
      type: "sensitive_personal",
      content: "User wants this sensitive context reviewed.",
      reason: "Sensitive memory requires user approval before storage.",
      source: "explicit-chat",
    });

    assert.equal(pending.source, "explicit-chat");
    assert.equal(pending.explicitConsent, false);
    assert.equal(store.getPendingMemoryById(pending.id)?.reason, "Sensitive memory requires user approval before storage.");
    assert.deepEqual(store.searchPendingMemories("reviewed").map((memory) => memory.content), ["User wants this sensitive context reviewed."]);
    assert.deepEqual(store.searchPendingMemories("approval").map((memory) => memory.content), ["User wants this sensitive context reviewed."]);
    assert.equal(store.listPendingMemories().length, 1);

    const approved = store.approvePendingMemory(pending.id);
    assert.equal(approved?.sensitivity, "sensitive");
    assert.equal(approved?.source, "explicit-chat");
    assert.equal(approved?.explicitConsent, true);
    assert.equal(approved?.policyReason, "Sensitive memory requires user approval before storage.");
    assert.deepEqual(store.listPendingMemories(), []);
    assert.deepEqual(store.listActiveMemories().map((memory) => memory.content), ["User wants this sensitive context reviewed."]);

    const rejected = store.addPendingMemory({ type: "sensitive_personal", content: "Do not keep this." });
    assert.equal(store.rejectPendingMemory(rejected.id), true);
    assert.equal(store.rejectPendingMemory(rejected.id), false);

    store.addPendingMemory({ type: "sensitive_personal", content: "Clear one." });
    store.addPendingMemory({ type: "sensitive_personal", content: "Clear two." });
    assert.equal(store.rejectAllPendingMemories(), 2);
    assert.deepEqual(store.listPendingMemories(), []);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore tracks pending action approvals without executing actions", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const first = store.addPendingActionApproval({
      channel: "telegram",
      userId: "12345",
      category: "local_write",
      action: "memory_approve",
      target: "pending-memory:7",
      reason: "Approve one pending memory.",
      proposedReason: "Local write actions require approval by default.",
      ttlMs: 60_000,
    });
    const otherUser = store.addPendingActionApproval({ channel: "telegram", userId: "99999", category: "read", action: "read", ttlMs: 60_000 });

    assert.equal(first.status, "pending");
    assert.equal(first.userId, "12345");
    assert.deepEqual(store.listPendingActionApprovals("telegram", "12345").map((approval) => approval.id), [first.id]);
    assert.deepEqual(store.listPendingActionApprovals("telegram").map((approval) => approval.id), [otherUser.id, first.id]);

    const approved = store.approvePendingActionApproval(first.id);
    assert.equal(approved?.status, "approved");
    assert.ok(approved?.decidedAt);
    assert.equal(store.approvePendingActionApproval(first.id), undefined);

    const denied = store.denyPendingActionApproval(otherUser.id);
    assert.equal(denied?.status, "denied");
    assert.deepEqual(store.listPendingActionApprovals("telegram"), []);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore expires pending action approvals", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const pending = store.addPendingActionApproval({ channel: "telegram", category: "unknown", action: "old action", ttlMs: -1 });

    assert.equal(store.expirePendingActionApprovals(), 1);
    assert.equal(store.getPendingActionApprovalById(pending.id)?.status, "expired");
    assert.equal(store.approvePendingActionApproval(pending.id), undefined);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore stores and lists recent messages", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const userMessage = store.addMessage({ channel: "terminal", role: "user", content: "Xin chao" });
    const assistantMessage = store.addMessage({ channel: "terminal", role: "assistant", content: "Chao boss" });

    assert.equal(userMessage.id, 1);
    assert.equal(assistantMessage.id, 2);
    assert.deepEqual(store.listAllMessages().map((message) => message.content), ["Xin chao", "Chao boss"]);
    assert.deepEqual(store.listRecentMessages().map((message) => message.content), ["Xin chao", "Chao boss"]);
    assert.deepEqual(store.listRecentMessages(1).map((message) => message.content), ["Chao boss"]);
    assert.deepEqual(store.listRecentMessages(20, "user").map((message) => message.content), ["Xin chao"]);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore stores memory hygiene score snapshots", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const first = store.addMemoryHygieneSnapshot({ score: 82, label: "attention", checked: 10, deleteCandidates: 1, reviewOnly: 2, duplicateGroups: 1, staleMemories: 1, conflictGroups: 1, source: "test" });
    const second = store.addMemoryHygieneSnapshot({ score: 91, label: "healthy", checked: 8, deleteCandidates: 0, reviewOnly: 0, duplicateGroups: 0, staleMemories: 0, conflictGroups: 0 });

    assert.equal(first.source, "test");
    assert.equal(second.source, "manual");
    assert.deepEqual(store.listMemoryHygieneSnapshots().map((snapshot) => snapshot.score), [91, 82]);
    assert.equal(store.getMemoryHygieneSnapshot(first.id)?.label, "attention");
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore lists recent messages for one channel user", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    store.addMessage({ channel: "terminal", role: "user", content: "Terminal user" });
    store.addMessage({ channel: "telegram", userId: "12345", role: "user", content: "Telegram user" });
    store.addMessage({ channel: "telegram", userId: "12345", role: "assistant", content: "Telegram assistant" });
    store.addMessage({ channel: "telegram", userId: "99999", role: "user", content: "Other Telegram user" });

    assert.deepEqual(store.listRecentMessagesForChannel("terminal").map((message) => message.content), ["Terminal user"]);
    assert.deepEqual(store.listRecentMessagesForChannel("telegram", "12345").map((message) => message.content), ["Telegram user", "Telegram assistant"]);
    assert.deepEqual(store.listRecentMessagesForChannel("telegram", "12345", 1).map((message) => message.content), ["Telegram assistant"]);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore upserts conversation summaries by channel and user", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const terminal = store.upsertConversationSummary({ channel: "terminal", content: "Old terminal context", summarizedMessageId: 10 });
    const telegram = store.upsertConversationSummary({ channel: "telegram", userId: "12345", content: "Old Telegram context", summarizedMessageId: 20 });
    const updated = store.upsertConversationSummary({ channel: "telegram", userId: "12345", content: "Updated Telegram context", summarizedMessageId: 24 });

    assert.equal(terminal.userId, undefined);
    assert.equal(terminal.content, "Old terminal context");
    assert.equal(telegram.id, updated.id);
    assert.equal(store.getConversationSummary("telegram", "12345")?.content, "Updated Telegram context");
    assert.equal(store.getConversationSummary("telegram", "12345")?.summarizedMessageId, 24);
    assert.equal(store.getConversationSummary("telegram", "99999"), undefined);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore searches messages by content", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    store.addMessage({ channel: "terminal", role: "user", content: "Xin chao from user" });
    store.addMessage({ channel: "terminal", role: "assistant", content: "Assistant remembers project details" });
    store.addMessage({ channel: "terminal", role: "user", content: "Project follow up" });

    assert.deepEqual(store.searchMessages("project").map((message) => message.content), ["Assistant remembers project details", "Project follow up"]);
    assert.deepEqual(store.searchMessages("project", 1).map((message) => message.content), ["Project follow up"]);
    assert.deepEqual(store.searchMessages("project", 20, "assistant").map((message) => message.content), ["Assistant remembers project details"]);
    assert.deepEqual(store.searchMessages("   "), []);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore clearAllData removes memories pending items and messages", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    store.addMemory({ type: "preference", content: "Clear me." });
    store.addPendingMemory({ type: "sensitive_personal", content: "Clear pending." });
    store.addMessage({ channel: "terminal", role: "user", content: "Clear message." });

    store.clearAllData();

    assert.deepEqual(store.listAllMemories(), []);
    assert.deepEqual(store.listPendingMemories(), []);
    assert.deepEqual(store.listAllMessages(), []);
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore stores memory pause state", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    assert.deepEqual(store.getMemoryState(), { paused: false });
    assert.deepEqual(store.setMemoryPaused(true), { paused: true });
    assert.deepEqual(store.getMemoryState(), { paused: true });
    assert.deepEqual(store.setMemoryPaused(false), { paused: false });
    assert.equal(store.getMemoryStateValue("custom"), undefined);
    store.setMemoryStateValue("custom", "value-1");
    assert.equal(store.getMemoryStateValue("custom"), "value-1");
    store.setMemoryStateValue("custom", "value-2");
    assert.equal(store.getMemoryStateValue("custom"), "value-2");
  } finally {
    store.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-sqlite-memory-test-"));
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
