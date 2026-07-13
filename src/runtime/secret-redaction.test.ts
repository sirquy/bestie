import assert from "node:assert/strict";
import test from "node:test";

import { containsSecretLikeValue, redactSecretLikeValues } from "./secret-redaction.js";

test("containsSecretLikeValue detects shared secret-like patterns", () => {
  assert.equal(containsSecretLikeValue("provider returned sk-secret-value-123456"), true);
  assert.equal(containsSecretLikeValue("Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890"), true);
  assert.equal(containsSecretLikeValue("api key = test-key"), true);
  assert.equal(containsSecretLikeValue("ordinary diagnostic text"), false);
});

test("redactSecretLikeValues redacts known and pattern-based secrets", () => {
  const output = redactSecretLikeValues(
    "api key = sk-secret-value-123456, bearer Bearer abcdefghijklmnopqrstuvwxyz1234567890, known custom-secret",
    ["custom-secret"],
  );

  assert.match(output, /\[REDACTED]/);
  assert.doesNotMatch(output, /sk-secret-value-123456/);
  assert.doesNotMatch(output, /abcdefghijklmnopqrstuvwxyz1234567890/);
  assert.doesNotMatch(output, /custom-secret/);
});
