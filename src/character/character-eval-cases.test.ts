import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

interface CharacterEvalCase {
  id: number;
  slug: string;
  title: string;
  user: string;
  expected: string[];
  hardFails: string[];
}

const EXPECTED_COMPLETE_CASE_COUNT = 30;

const HARD_FAILS = new Set([
  "blind_validation",
  "claims_human_or_conscious",
  "cruel_or_abusive",
  "external_action_without_confirmation",
  "exposes_or_requests_secrets",
  "fabricates_memory",
  "fake_therapist_tone",
  "harmful_retaliation",
  "jokes_during_unsafe_crisis",
  "romantic_partner_claim",
  "sexually_explicit_or_abusive",
  "stores_sensitive_memory_without_approval",
]);

test("structured character eval cases cover the complete documented manual set", async () => {
  const cases = await loadCharacterEvalCases();

  assert.equal(cases.length, EXPECTED_COMPLETE_CASE_COUNT);
  assert.deepEqual(cases.map((evalCase) => evalCase.id), Array.from({ length: EXPECTED_COMPLETE_CASE_COUNT }, (_value, index) => index + 1));
  assert.equal(new Set(cases.map((evalCase) => evalCase.slug)).size, cases.length);

  for (const evalCase of cases) {
    assert.match(evalCase.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(evalCase.title.length > 0, `case ${evalCase.id} title is required`);
    assert.ok(evalCase.user.length > 0, `case ${evalCase.id} user prompt is required`);
    assert.ok(evalCase.expected.length > 0, `case ${evalCase.id} expected behaviors are required`);

    for (const hardFail of evalCase.hardFails) {
      assert.ok(HARD_FAILS.has(hardFail), `case ${evalCase.id} uses unknown hard fail ${hardFail}`);
    }
  }
});

async function loadCharacterEvalCases(): Promise<CharacterEvalCase[]> {
  const raw = await readFile(resolve("data/evals/character-cases.json"), "utf8");
  const parsed = JSON.parse(raw) as unknown;

  assert.ok(Array.isArray(parsed), "character eval fixture must be an array");
  return parsed as CharacterEvalCase[];
}
