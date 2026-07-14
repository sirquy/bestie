import assert from "node:assert/strict";
import test from "node:test";

import { containsSecretLikeValue, redactSecretLikeValues } from "./secret-redaction.js";

test("containsSecretLikeValue detects shared secret-like patterns", () => {
  assert.equal(containsSecretLikeValue("provider returned sk-secret-value-123456"), true);
  assert.equal(containsSecretLikeValue("provider returned sk_a94cd664f4ff9557a9d38bd59d864e994a0c743e15bbcb9f"), true);
  assert.equal(containsSecretLikeValue("quota key qc_3abfb56d945c3467787f6c0b4646681337e9317224370654"), true);
  assert.equal(containsSecretLikeValue("consumer key ck_ZsDfucC0UmaSqRxLcwR3"), true);
  assert.equal(containsSecretLikeValue("bot token 8933391784:AAHnD58utPOBr8RNTJHVDO6X-1LctjKsVBQ"), true);
  assert.equal(containsSecretLikeValue("Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890"), true);
  assert.equal(containsSecretLikeValue("api key = test-key"), true);
  assert.equal(containsSecretLikeValue("ordinary diagnostic text"), false);
});

test("redactSecretLikeValues redacts known and pattern-based secrets", () => {
  const output = redactSecretLikeValues(
    "api key = sk-secret-value-123456, sk_a94cd664f4ff9557a9d38bd59d864e994a0c743e15bbcb9f, qc_3abfb56d945c3467787f6c0b4646681337e9317224370654, ck_ZsDfucC0UmaSqRxLcwR3, 8933391784:AAHnD58utPOBr8RNTJHVDO6X-1LctjKsVBQ, bearer Bearer abcdefghijklmnopqrstuvwxyz1234567890, known custom-secret",
    ["custom-secret"],
  );

  assert.match(output, /\[REDACTED]/);
  assert.doesNotMatch(output, /sk-secret-value-123456/);
  assert.doesNotMatch(output, /sk_a94cd664f4ff9557a9d38bd59d864e994a0c743e15bbcb9f/);
  assert.doesNotMatch(output, /qc_3abfb56d945c3467787f6c0b4646681337e9317224370654/);
  assert.doesNotMatch(output, /ck_ZsDfucC0UmaSqRxLcwR3/);
  assert.doesNotMatch(output, /8933391784:AAHnD58utPOBr8RNTJHVDO6X-1LctjKsVBQ/);
  assert.doesNotMatch(output, /abcdefghijklmnopqrstuvwxyz1234567890/);
  assert.doesNotMatch(output, /custom-secret/);
});
