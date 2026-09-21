import assert from "node:assert/strict";
import test from "node:test";

import { getPromptFrameRowCount, removeLastGrapheme, renderPromptFrame } from "./terminal-chat-input.js";

test("terminal prompt frame counts wrapped prompt rows and suggestions", () => {
  assert.equal(getPromptFrameRowCount("you> ", "a very long message", [{ command: "/help", description: "Help" }], 10), 4);
  assert.match(renderPromptFrame("you> ", "message", [], 0, 4), /^\x1b\[3A\r\x1b\[J/);
});

test("terminal prompt backspace removes a complete grapheme", () => {
  assert.equal(removeLastGrapheme("hello 👋"), "hello ");
  assert.equal(removeLastGrapheme("cafe\u0301"), "caf");
});