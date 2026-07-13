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

test("SqliteMemoryStore lists recent messages for one channel user", async () => {
  const paths = await createTempPaths();
  const store = await SqliteMemoryStore.open(paths);

  try {
    store.addMessage({ channel: "terminal", role: "user", content: "Terminal user" });
    store.addMessage({ channel: "telegram", userId: "12345", role: "user", content: "Telegram user" });
    store.addMessage({ channel: "telegram", userId: "12345", role: "assistant", content: "Telegram assistant" });
    store.addMessage({ channel: "telegram", userId: "99999", role: "user", content: "Other Telegram user" });

    assert.deepEqual(store.listRecentMessagesForChannel("telegram", "12345").map((message) => message.content), ["Telegram user", "Telegram assistant"]);
    assert.deepEqual(store.listRecentMessagesForChannel("telegram", "12345", 1).map((message) => message.content), ["Telegram assistant"]);
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
