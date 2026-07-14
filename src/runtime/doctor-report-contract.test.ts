import assert from "node:assert/strict";
import test from "node:test";

import { validateDoctorReportContract, validateDoctorReportJsonContract } from "./doctor-report-contract.js";

test("validateDoctorReportContract accepts a valid Doctor report", () => {
  const result = validateDoctorReportContract({
    checks: [
      { name: "Node.js", status: "pass", message: "Node.js is supported." },
      { name: "Config file", status: "fail", message: "Config missing.", fix: "Run onboard." },
    ],
    issueCount: 1,
    fixes: [{ name: "Data directory", status: "fixed", message: "Created data directory." }],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validateDoctorReportContract rejects invalid check and fix statuses", () => {
  const result = validateDoctorReportContract({
    checks: [{ name: "Node.js", status: "ok", message: "Node.js is supported." }],
    issueCount: 0,
    fixes: [{ name: "Data directory", status: "done", message: "Created data directory." }],
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /checks\[0\]\.status/);
  assert.match(result.errors.join("\n"), /fixes\[0\]\.status/);
});

test("validateDoctorReportContract rejects mismatched issue counts", () => {
  const result = validateDoctorReportContract({
    checks: [{ name: "Config file", status: "fail", message: "Config missing." }],
    issueCount: 0,
    fixes: [],
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /issueCount/);
});

test("validateDoctorReportJsonContract rejects secret-like values before parsing report shape", () => {
  const result = validateDoctorReportJsonContract(JSON.stringify({
    checks: [{ name: "LLM API key", status: "pass", message: "qc_3abfb56d945c3467787f6c0b4646681337e9317224370654" }],
    issueCount: 0,
    fixes: [],
  }));

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ["report JSON must not contain secret-like values"]);
});

test("validateDoctorReportJsonContract reports invalid JSON", () => {
  const result = validateDoctorReportJsonContract("not json");

  assert.equal(result.valid, false);
  assert.match(result.errors[0] ?? "", /report JSON must parse/);
});
