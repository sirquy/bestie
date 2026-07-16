import assert from "node:assert/strict";
import test from "node:test";

import { appendConversationTurn, buildChatMessages } from "./message-builder.js";
import type { ChatMessage } from "../llm/types.js";
import type { StoredMemory } from "../memory/sqlite-store.js";

function createStoredMemory(overrides: Partial<StoredMemory>): StoredMemory {
  return {
    id: 1,
    type: "preference",
    content: "memory",
    sensitivity: "normal",
    importance: 3,
    status: "active",
    explicitConsent: false,
    pinned: false,
    scope: "global",
    confidence: 1,
    accessCount: 0,
    createdAt: "now",
    updatedAt: "now",
    ...overrides,
  };
}

test("buildChatMessages puts system prompt first and current user message last", () => {
  const messages = buildChatMessages("system prompt", [{ role: "assistant", content: "old" }], "hello");

  assert.deepEqual(messages, [
    { role: "system", content: "system prompt" },
    { role: "assistant", content: "old" },
    { role: "user", content: "hello" },
  ]);
});

test("buildChatMessages includes approved active memory context", () => {
  const messages = buildChatMessages(
    "system prompt",
    [],
    "remember?",
    [
      createStoredMemory({
        id: 1,
        type: "communication_preference",
        content: "User prefers concise replies.",
      }),
      createStoredMemory({
        id: 2,
        type: "preference",
        content: "Deleted memory should not appear.",
        status: "deleted",
      }),
    ],
  );

  assert.equal(messages[1]?.role, "system");
  assert.match(String(messages[1]?.content ?? ""), /Approved local memories/);
  assert.match(String(messages[1]?.content ?? ""), /#1 \[communication_preference\] User prefers concise replies/);
  assert.doesNotMatch(String(messages[1]?.content ?? ""), /Deleted memory/);
  assert.equal(messages.at(-1)?.content, "remember?");
});

test("buildChatMessages prioritizes important recent memories in context", () => {
  const memories: StoredMemory[] = Array.from({ length: 10 }, (_, index) => createStoredMemory({
    id: index + 1,
    type: "preference",
    content: `Memory ${index + 1}`,
    sensitivity: "normal",
    importance: index === 9 ? 5 : 1,
    status: "active",
    explicitConsent: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
  }));

  const messages = buildChatMessages("system prompt", [], "hello", memories);
  const memoryContext = String(messages[1]?.content ?? "");
  const memoryLines = memoryContext.split("\n").filter((line) => line.includes("[preference]"));

  assert.equal(memoryLines[0], "- #10 [preference] Memory 10");
  assert.equal(memoryLines[1], "- #9 [preference] Memory 9");
  assert.equal(memoryLines.at(-1), "- #1 [preference] Memory 1");
});

test("buildChatMessages includes all active memories", () => {
  const memories: StoredMemory[] = Array.from({ length: 55 }, (_, index) => createStoredMemory({
    id: index + 1,
    type: "preference",
    content: `Memory ${index + 1}`,
    sensitivity: "normal",
    importance: 1,
    status: "active",
    explicitConsent: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  }));

  const messages = buildChatMessages("system prompt", [], "hello", memories);
  const memoryContext = String(messages[1]?.content ?? "");

  assert.equal(memoryContext.split("\n- #").length - 1, 55);
  assert.match(memoryContext, /Memory 55/);
  assert.match(memoryContext, /- #1 \[preference\] Memory 1$/m);
});

test("buildChatMessages can organize full memory context with governance labels", () => {
  const messages = buildChatMessages(
    "system prompt",
    [],
    "hello",
    [
      createStoredMemory({ id: 1, content: "normal current memory", confidence: 0.9, importance: 1, updatedAt: "2026-01-01T00:00:00.000Z" }),
      createStoredMemory({ id: 2, content: "pinned memory", pinned: true, confidence: 0.8, importance: 1, updatedAt: "2026-01-02T00:00:00.000Z" }),
      createStoredMemory({ id: 3, content: "old low confidence", confidence: 0.2, expiresAt: "2020-01-01T00:00:00.000Z", supersededBy: 1, importance: 5, updatedAt: "2026-01-03T00:00:00.000Z" }),
    ],
    { memoryRetrievalPolicy: "governed" },
  );

  const memoryContext = String(messages[1]?.content ?? "");
  const memoryLines = memoryContext.split("\n").filter((line) => line.includes("[preference]"));

  assert.match(memoryContext, /organized by memory governance/);
  assert.equal(memoryLines.length, 3);
  assert.match(memoryLines[0], /#2 \[preference\] \(pinned\) pinned memory/);
  assert.match(memoryLines.at(-1) ?? "", /#3 \[preference\] \(low-confidence:0.2, stale:expired 2020-01-01T00:00:00.000Z, superseded-by:#1\) old low confidence/);
});

test("buildChatMessages does not truncate long active memory context", () => {
  const memories: StoredMemory[] = Array.from({ length: 50 }, (_, index) => createStoredMemory({
    id: index + 1,
    type: "project_context",
    content: `Important memory ${index + 1}: ${"x".repeat(900)}`,
    sensitivity: "normal",
    importance: index === 49 ? 5 : 1,
    status: "active",
    explicitConsent: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  }));

  const messages = buildChatMessages("system prompt", [], "hello", memories);
  const memoryContext = String(messages[1]?.content ?? "");

  assert.match(memoryContext, /Important memory 50/);
  assert.match(memoryContext, /Important memory 1/);
});

test("appendConversationTurn keeps only recent terminal turns", () => {
  const turns: ChatMessage[] = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `turn-${index}`,
  }));

  const nextTurns = appendConversationTurn(turns, "new user", "new assistant");

  assert.equal(nextTurns.length, 12);
  assert.equal(nextTurns[0]?.content, "turn-2");
  assert.equal(nextTurns.at(-1)?.content, "new assistant");
});
