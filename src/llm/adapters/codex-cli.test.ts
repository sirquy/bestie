import assert from "node:assert/strict";
import test from "node:test";

import { buildCodexCliArgs, buildCodexCliPrompt } from "./codex-cli.js";

test("buildCodexCliArgs runs Codex exec in safe non-interactive mode", () => {
  assert.deepEqual(buildCodexCliArgs({ outputPath: "out.txt" }), [
    "--ask-for-approval",
    "never",
    "exec",
    "--json",
    "--color",
    "never",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-rules",
    "--output-last-message",
    "out.txt",
    "-",
  ]);
});

test("buildCodexCliArgs passes explicit non-default model before exec", () => {
  assert.deepEqual(buildCodexCliArgs({ outputPath: "out.txt", model: "gpt-5" }).slice(0, 5), [
    "--ask-for-approval",
    "never",
    "--model",
    "gpt-5",
    "exec",
  ]);
});

test("buildCodexCliPrompt serializes chat messages as an answer-only request", () => {
  const prompt = buildCodexCliPrompt([
    { role: "system", content: "You are Bestie." },
    { role: "user", content: [{ type: "text", text: "Hi" }, { type: "image_url", image_url: { url: "data:image/png;base64,abc" } }] },
  ]);

  assert.match(prompt, /<system>\nYou are Bestie\.\n<\/system>/);
  assert.match(prompt, /<user>\nHi\n\[image omitted: data:image\/png;base64,abc\]\n<\/user>/);
  assert.match(prompt, /Respond only with the assistant's final message/);
});
