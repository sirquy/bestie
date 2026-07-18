import assert from "node:assert/strict";
import test from "node:test";

import { computeCronNextRun, computeNextRun, parseInterval, validateSchedule } from "./scheduler.js";

// --- parseInterval ---

test("parseInterval parses seconds", () => {
  assert.equal(parseInterval("30s"), 30_000);
});

test("parseInterval parses minutes", () => {
  assert.equal(parseInterval("5m"), 300_000);
});

test("parseInterval parses hours", () => {
  assert.equal(parseInterval("2h"), 7_200_000);
});

test("parseInterval parses days", () => {
  assert.equal(parseInterval("1d"), 86_400_000);
});

test("parseInterval rejects invalid formats", () => {
  assert.throws(() => parseInterval("5x"), /Invalid interval format/);
  assert.throws(() => parseInterval("abc"), /Invalid interval format/);
  assert.throws(() => parseInterval("0m"), /must be positive/);
  assert.throws(() => parseInterval("400d"), /must not exceed/);
});

// --- computeCronNextRun ---

test("computeCronNextRun returns next matching time", () => {
  // Every day at 08:00 UTC
  const from = new Date("2026-07-15T10:00:00Z");
  const next = computeCronNextRun("0 8 * * *", from);
  assert.equal(next, "2026-07-16T08:00:00.000Z");
});

test("computeCronNextRun handles same-day match", () => {
  // Every day at 08:00 UTC, starting at 06:00
  const from = new Date("2026-07-15T06:00:00Z");
  const next = computeCronNextRun("0 8 * * *", from);
  assert.equal(next, "2026-07-15T08:00:00.000Z");
});

test("computeCronNextRun handles every 30 minutes", () => {
  const from = new Date("2026-07-15T10:00:00Z");
  const next = computeCronNextRun("*/30 * * * *", from);
  assert.equal(next, "2026-07-15T10:30:00.000Z");
});

test("computeCronNextRun matches cron fields in the requested time zone", () => {
  const from = new Date("2026-07-15T00:30:00Z");
  const next = computeCronNextRun("0 8 * * *", from, "Asia/Bangkok");
  assert.equal(next, "2026-07-15T01:00:00.000Z");
});

test("computeCronNextRun rejects invalid expressions", () => {
  assert.throws(() => computeCronNextRun("0 8 *"), /5 fields/);
  assert.throws(() => computeCronNextRun("* * * *", new Date("2026-01-01T00:00:00Z")), /5 fields/);
});

// --- computeNextRun ---

test("computeNextRun for interval", () => {
  const from = new Date("2026-07-15T10:00:00Z");
  const next = computeNextRun("interval", "30m", from);
  assert.equal(next, "2026-07-15T10:30:00.000Z");
});

test("computeNextRun for cron_expr", () => {
  const from = new Date("2026-07-15T10:00:00Z");
  const next = computeNextRun("cron_expr", "0 8 * * *", from);
  assert.equal(next, "2026-07-16T08:00:00.000Z");
});

test("computeNextRun for cron_expr accepts an agent time zone", () => {
  const from = new Date("2026-07-15T00:30:00Z");
  const next = computeNextRun("cron_expr", "0 8 * * *", from, "Asia/Bangkok");
  assert.equal(next, "2026-07-15T01:00:00.000Z");
});

test("computeNextRun for once", () => {
  const future = new Date("2026-12-25T00:00:00Z");
  const next = computeNextRun("once", "2026-12-25T00:00:00Z");
  assert.equal(next, future.toISOString());
});

test("computeNextRun for once rejects past timestamps", () => {
  assert.throws(() => computeNextRun("once", "2020-01-01T00:00:00Z"), /must be in the future/);
});

test("computeNextRun rejects unknown types", () => {
  assert.throws(() => computeNextRun("unknown", "value"), /Unknown schedule type/);
});

// --- validateSchedule ---

test("validateSchedule returns undefined for valid schedules", () => {
  assert.equal(validateSchedule("interval", "30m"), undefined);
  assert.equal(validateSchedule("cron_expr", "0 8 * * *"), undefined);
  assert.equal(validateSchedule("once", "2099-12-31T00:00:00Z"), undefined);
});

test("validateSchedule returns error message for invalid schedules", () => {
  const error = validateSchedule("interval", "invalid");
  assert.ok(typeof error === "string");
  assert.ok(error.length > 0);
});
