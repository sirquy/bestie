import assert from "node:assert/strict";
import test from "node:test";

import { ProviderAuthError, ProviderResponseError } from "../errors.js";
import { buildClaudeCliArgs, buildClaudeCliPromptParts, parseClaudeCliOutput } from "./claude-cli.js";

test("buildClaudeCliArgs runs Claude print in safe answer-only mode", () => {
  assert.deepEqual(buildClaudeCliArgs({}), [
    "--safe-mode",
    "--print",
    "--output-format",
    "json",
    "--permission-mode",
    "dontAsk",
    "--tools=",
  ]);
});

test("buildClaudeCliArgs passes model and system prompt when provided", () => {
  assert.deepEqual(buildClaudeCliArgs({ model: "sonnet", systemPrompt: "You are Bestie." }), [
    "--safe-mode",
    "--print",
    "--output-format",
    "json",
    "--permission-mode",
    "dontAsk",
    "--tools=",
    "--model",
    "sonnet",
    "--system-prompt",
    "You are Bestie.",
  ]);
});

test("buildClaudeCliPromptParts separates system prompt from dialogue", () => {
  const parts = buildClaudeCliPromptParts([
    { role: "system", content: "You are Bestie." },
    { role: "user", content: [{ type: "text", text: "Hi" }, { type: "image_url", image_url: { url: "data:image/png;base64,abc" } }] },
    { role: "assistant", content: "Hello" },
  ]);

  assert.equal(parts.systemPrompt, "You are Bestie.");
  assert.match(parts.prompt, /<user>\nHi\n\[image omitted: data:image\/png;base64,abc\]\n<\/user>/);
  assert.match(parts.prompt, /<assistant>\nHello\n<\/assistant>/);
  assert.match(parts.prompt, /Respond only with the assistant's final message/);
});

test("parseClaudeCliOutput returns result text", () => {
  assert.equal(parseClaudeCliOutput(JSON.stringify({ type: "result", result: "PONG", is_error: false }), "", 0), "PONG");
});

test("parseClaudeCliOutput maps login failures to ProviderAuthError", () => {
  assert.throws(
    () => parseClaudeCliOutput(JSON.stringify({ type: "result", result: "Not logged in · Please run /login", is_error: true, terminal_reason: "api_error", api_error_status: null }), "", 1),
    ProviderAuthError,
  );
});

test("parseClaudeCliOutput rejects invalid JSON", () => {
  assert.throws(() => parseClaudeCliOutput("not json", "", 0), ProviderResponseError);
});
