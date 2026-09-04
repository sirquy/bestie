import assert from "node:assert/strict";
import test from "node:test";

import { formatChatFailureContext } from "./error-context.js";

test("formatChatFailureContext includes nested runtime causes without leaking known secrets", () => {
  const cause = new Error("download failed for https://example.test/file?token=super-secret");
  const error = new Error("Attachment processing failed", { cause });

  const context = formatChatFailureContext(error, ["super-secret"]);

  assert.match(context, /Attachment processing failed/);
  assert.match(context, /download failed/);
  assert.doesNotMatch(context, /super-secret/);
});
