import assert from "node:assert/strict";
import test from "node:test";

import { containsSecretLikeValue, redactSecretLikeValues } from "./secret-redaction.js";

test("containsSecretLikeValue detects shared secret-like patterns", () => {
  assert.equal(containsSecretLikeValue("provider returned sk-secret-value-123456"), true);
  assert.equal(containsSecretLikeValue("provider returned sk_a94cd664f4ff9557a9d3xxxxxxxxxxxxxxxxxxxxxx"), true);
  assert.equal(containsSecretLikeValue("quota key qc_3abfb56d945c3467787f6c0xxxxxxxxxxxxxxxxx"), true);
  assert.equal(containsSecretLikeValue("consumer key ck_ZsDfucC0UmaSqxxxxxx"), true);
  assert.equal(containsSecretLikeValue("bot token 8933391784:AAHnD58utPOBr8RNTJHVDO6X-xxxxxxxxxxxxx"), true);
  assert.equal(containsSecretLikeValue("Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890"), true);
  assert.equal(containsSecretLikeValue("api key = test-key"), true);
  assert.equal(containsSecretLikeValue("ordinary diagnostic text"), false);
});

test("redactSecretLikeValues redacts known and pattern-based secrets", () => {
  const output = redactSecretLikeValues(
    "api key = sk-secret-value-123456, sk_a94cd664f4ff9557axxxxxxxxxxxxxxxx, qc_3abfb56d945c3467787f6xxxxxxxxxxxxxxxxxxx, ck_ZsDfucC0UmaSqxxxxxx, 8933391784:AAHnD58utPOBr8RNTJHVDO6X-xxxxxxxxxxxxx, bearer Bearer abcdefghijklmnopqrstuvwxyz1234567890, known custom-secret",
    ["custom-secret"],
  );

  assert.match(output, /\[REDACTED]/);
  assert.doesNotMatch(output, /sk-secret-value-123456/);
  assert.doesNotMatch(output, /sk_a94cd664f4ff9557a9d38bd59d864e994axxxxxxxx/);
  assert.doesNotMatch(output, /qc_3abfb56d945c3467787f6c0b4646681337exxxxxxxxxx/);
  assert.doesNotMatch(output, /ck_ZsDfucC0UmaSqxxxxxx/);
  assert.doesNotMatch(output, /8933391784:AAHnD58utPOBr8RNTJHVDO6X-xxxxxxxxxxxxx/);
  assert.doesNotMatch(output, /abcdefghijklmnopqrstuvwxyz1234567890/);
  assert.doesNotMatch(output, /custom-secret/);
});
