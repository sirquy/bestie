import assert from "node:assert/strict";
import test from "node:test";

import { ProviderAuthError, ProviderResponseError } from "../errors.js";
import { buildGeminiCliArgs, buildGeminiCliPrompt, parseGeminiCliOutput } from "./gemini-cli.js";

test("buildGeminiCliArgs runs Gemini headless in trusted read-only plan mode", () => {
  assert.deepEqual(buildGeminiCliArgs(), [
    "--skip-trust",
    "--prompt=",
    "--output-format",
    "json",
    "--approval-mode",
    "plan",
  ]);
});

test("buildGeminiCliArgs passes explicit non-default model", () => {
  assert.deepEqual(buildGeminiCliArgs({ model: "gemini-2.5-pro" }), [
    "--skip-trust",
    "--prompt=",
    "--output-format",
    "json",
    "--approval-mode",
    "plan",
    "--model",
    "gemini-2.5-pro",
  ]);
});

test("buildGeminiCliPrompt serializes chat messages as an answer-only request", () => {
  const prompt = buildGeminiCliPrompt([
    { role: "system", content: "You are Bestie." },
    { role: "user", content: [{ type: "text", text: "Hi" }, { type: "image_url", image_url: { url: "data:image/png;base64,abc" } }] },
  ]);

  assert.match(prompt, /<system>\nYou are Bestie\.\n<\/system>/);
  assert.match(prompt, /<user>\nHi\n\[image omitted: data:image\/png;base64,abc\]\n<\/user>/);
  assert.match(prompt, /Respond only with the assistant's final message/);
});

test("parseGeminiCliOutput returns response text", () => {
  assert.equal(parseGeminiCliOutput(JSON.stringify({ response: "PONG" }), "", 0), "PONG");
});

test("parseGeminiCliOutput maps auth failures to ProviderAuthError", () => {
  assert.throws(
    () => parseGeminiCliOutput("", "Please set GEMINI_API_KEY or login.", 1),
    ProviderAuthError,
  );
});

test("parseGeminiCliOutput rejects invalid JSON", () => {
  assert.throws(() => parseGeminiCliOutput("not json", "", 0), ProviderResponseError);
});
