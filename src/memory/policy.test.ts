import assert from "node:assert/strict";
import test from "node:test";

import { evaluateMemoryCandidate } from "./policy.js";

test("evaluateMemoryCandidate stores durable non-sensitive preferences", () => {
  assert.deepEqual(evaluateMemoryCandidate({ type: "communication_preference", content: "User prefers concise replies." }), {
    decision: "store",
    sensitivity: "normal",
    reason: "Durable non-sensitive memory is allowed by the MVP policy.",
  });
});

test("evaluateMemoryCandidate requires approval for sensitive personal details", () => {
  const result = evaluateMemoryCandidate({ type: "sensitive_personal", content: "User shared family conflict." });

  assert.equal(result.decision, "pending");
  assert.equal(result.sensitivity, "sensitive");
});

test("evaluateMemoryCandidate allows sensitive details with explicit consent", () => {
  const result = evaluateMemoryCandidate({
    type: "sensitive_personal",
    content: "User wants this health context remembered.",
    explicitConsent: true,
  });

  assert.equal(result.decision, "store");
  assert.equal(result.sensitivity, "sensitive");
});

test("evaluateMemoryCandidate never stores secrets or token-like content", () => {
  assert.equal(evaluateMemoryCandidate({ type: "secret", content: "password: hunter2" }).decision, "never");
  assert.equal(evaluateMemoryCandidate({ type: "project_context", content: "api key = sk-testsecret123456" }).decision, "never");
});

test("evaluateMemoryCandidate ignores one-off venting", () => {
  const result = evaluateMemoryCandidate({ type: "one_off", content: "Today was annoying." });

  assert.equal(result.decision, "never");
  assert.equal(result.sensitivity, "normal");
});
