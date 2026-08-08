import assert from "node:assert/strict";
import test from "node:test";

import { formatTerminalAssistantMessage, formatTerminalError, formatTerminalGoodbye, formatTerminalPrompt, formatTerminalToolActivity, renderTerminalChatHeader } from "./terminal-chat-ui.js";

test("terminal chat UI preserves readable non-interactive output", () => {
  assert.equal(formatTerminalPrompt("Andy"), "[YOU] Andy > ");
  assert.equal(formatTerminalAssistantMessage("Bea", "Xin chao"), "[BOT] Bea > Xin chao");
  assert.equal(formatTerminalError("Provider unavailable."), "[FAIL] Provider unavailable.");
  assert.equal(formatTerminalToolActivity("Bea", "internal.read_file", "Reading README.md"), "[BOT] Bea > [TOOL] internal.read_file Reading README.md");
  assert.equal(formatTerminalGoodbye(), "Bye.");
});

test("terminal chat UI renders session metadata in non-interactive mode", () => {
  assert.deepEqual(renderTerminalChatHeader({
    agentName: "Bea",
    ownerName: "Andy",
    model: "openai/gpt-4o-mini",
    runtimePath: "/tmp/.bestie",
  }), [
    "Bestie chat local terminal session",
    "Runtime /tmp/.bestie",
    "Model openai/gpt-4o-mini",
    "[BOT] Bea with [YOU] Andy",
    "Commands /help  /status  /providers  /memory  /pending  /exit",
    "----------------------------",
  ]);
});
