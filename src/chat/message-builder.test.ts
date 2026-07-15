import assert from "node:assert/strict";
import test from "node:test";

import { appendConversationTurn, buildChatMessages } from "./message-builder.js";
import type { ChatMessage } from "../llm/types.js";
import type { StoredMemory } from "../memory/sqlite-store.js";

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
      {
        id: 1,
        type: "communication_preference",
        content: "User prefers concise replies.",
        sensitivity: "normal",
        importance: 3,
        status: "active",
        explicitConsent: false,
        createdAt: "now",
        updatedAt: "now",
      },
      {
        id: 2,
        type: "preference",
        content: "Deleted memory should not appear.",
        sensitivity: "normal",
        importance: 3,
        status: "deleted",
        explicitConsent: false,
        createdAt: "now",
        updatedAt: "now",
      },
    ],
  );

  assert.equal(messages[1]?.role, "system");
  assert.match(String(messages[1]?.content ?? ""), /Approved local memories/);
  assert.match(String(messages[1]?.content ?? ""), /User prefers concise replies/);
  assert.doesNotMatch(String(messages[1]?.content ?? ""), /Deleted memory/);
  assert.equal(messages.at(-1)?.content, "remember?");
});

test("buildChatMessages prioritizes important recent memories in context", () => {
  const memories: StoredMemory[] = Array.from({ length: 10 }, (_, index) => ({
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
  const memoryLines = memoryContext.split("\n").filter((line) => line.startsWith("- preference:"));

  assert.equal(memoryLines[0], "- preference: Memory 10");
  assert.equal(memoryLines[1], "- preference: Memory 9");
  assert.equal(memoryLines.at(-1), "- preference: Memory 1");
});

test("buildChatMessages includes all active memories that fit the context budget", () => {
  const memories: StoredMemory[] = Array.from({ length: 55 }, (_, index) => ({
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

  assert.equal(memoryContext.split("\n- preference:").length - 1, 55);
  assert.match(memoryContext, /Memory 55/);
  assert.match(memoryContext, /- preference: Memory 1$/m);
});

test("buildChatMessages keeps memory context under the character budget", () => {
  const memories: StoredMemory[] = Array.from({ length: 50 }, (_, index) => ({
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

  assert.ok(memoryContext.length <= 12_000);
  assert.match(memoryContext, /Important memory 50/);
  assert.doesNotMatch(memoryContext, /Important memory 1/);
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
