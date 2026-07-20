import assert from "node:assert/strict";
import test from "node:test";

import { formatChannelToolProgress, shouldShowToolProgress } from "./tool-progress.js";

test("shouldShowToolProgress hides trivial local exec probes", () => {
  assert.equal(shouldShowToolProgress({ phase: "start", callIndex: 1, toolName: "internal.exec", label: "date" }), false);
  assert.equal(shouldShowToolProgress({ phase: "start", callIndex: 1, toolName: "internal.exec", label: "pwd" }), false);
  assert.equal(shouldShowToolProgress({ phase: "finish", callIndex: 1, toolName: "internal.read_file", label: "README.md" }), false);
});

test("shouldShowToolProgress keeps meaningful tool activity visible", () => {
  assert.equal(shouldShowToolProgress({ phase: "start", callIndex: 1, toolName: "internal.read_file", label: "README.md" }), true);
  assert.equal(shouldShowToolProgress({ phase: "start", callIndex: 1, toolName: "internal.exec", label: "npm" }), true);
});

test("formatChannelToolProgress avoids raw labels for unknown fallback tools", () => {
  assert.equal(formatChannelToolProgress({ phase: "start", callIndex: 1, toolName: "internal.exec", label: "npm" }, "Miu"), "Miu is working");
  assert.equal(formatChannelToolProgress({ phase: "start", callIndex: 1, toolName: "internal.read_file", label: "README.md" }, "Miu"), "Miu is reading file README.md");
});
