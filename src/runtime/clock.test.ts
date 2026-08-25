import assert from "node:assert/strict";
import test from "node:test";

import { formatRuntimeClock, getRuntimeClock } from "./clock.js";

test("getRuntimeClock formats a fixed instant in the configured timezone", () => {
  const clock = getRuntimeClock("Asia/Ho_Chi_Minh", new Date("2026-08-25T08:30:45.000Z"));

  assert.equal(clock.nowIso, "2026-08-25T08:30:45.000Z");
  assert.equal(clock.timeZone, "Asia/Ho_Chi_Minh");
  assert.equal(clock.date, "2026-08-25");
  assert.equal(clock.time, "15:30:45");
  assert.equal(clock.dayOfWeek, "Tuesday");
  assert.match(formatRuntimeClock(clock), /Current runtime time/);
  assert.match(formatRuntimeClock(clock), /Local date\/time: 2026-08-25 15:30:45/);
});
