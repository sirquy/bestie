/**
 * Interval parsing and next-run computation for cron schedules.
 */

const INTERVAL_PATTERN = /^(\d+)(s|m|h|d)$/;

const MAX_INTERVAL_DAYS = 365;

export function parseInterval(value: string): number {
  const match = INTERVAL_PATTERN.exec(value);

  if (!match) {
    throw new Error(`Invalid interval format: "${value}". Use formats like "30s", "5m", "1h", "2d".`);
  }

  const amount = Number(match[1]);
  const unit = match[2];

  if (amount <= 0) {
    throw new Error(`Interval amount must be positive: ${amount}`);
  }

  const multiplier = unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  const ms = amount * multiplier;
  const maxMs = MAX_INTERVAL_DAYS * 86_400_000;

  if (ms > maxMs) {
    throw new Error(`Interval must not exceed ${MAX_INTERVAL_DAYS} days.`);
  }

  return ms;
}

/**
 * Simple 5-field cron expression parser.
 * Fields: minute hour day-of-month month day-of-week
 * Supports: asterisk (any), number, ranges (1-5), steps (slash-n).
 * Month/day-of-week are NOT expanded (kept simple for MVP).
 */
export function computeCronNextRun(expression: string, from?: Date, timeZone = "UTC"): string {
  const fromDate = from !== undefined ? from : new Date();
  const fields = expression.trim().split(/\s+/);

  if (fields.length !== 5) {
    throw new Error(`Cron expression must have 5 fields: "${expression}"`);
  }

  const [minuteField, hourField, domField, monthField, dowField] = fields;

  // Check up to 366 days ahead (covers yearly patterns)
  const maxCheckMs = 366 * 86_400_000;
  const stepMs = 60_000; // check every minute
  const fromMs = Math.floor(fromDate.getTime() / stepMs) * stepMs;

  for (let offset = stepMs; offset <= maxCheckMs; offset += stepMs) {
    const candidate = new Date(fromMs + offset);
    const { minute, hour, day, month, weekday } = getTimeZoneParts(candidate, timeZone);

    if (
      matchCronField(minuteField, minute, 0, 59) &&
      matchCronField(hourField, hour, 0, 23) &&
      matchCronField(domField, day, 1, 31) &&
      matchCronField(monthField, month, 1, 12) &&
      matchCronField(dowField, weekday, 0, 6)
    ) {
      return candidate.toISOString();
    }
  }

  throw new Error(`Could not find matching cron run within 366 days: "${expression}"`);
}

function getTimeZoneParts(date: Date, timeZone: string): { minute: number; hour: number; day: number; month: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    minute: "numeric",
    hour: "numeric",
    hourCycle: "h23",
    day: "numeric",
    month: "numeric",
    weekday: "short",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    day: Number(parts.day),
    month: Number(parts.month),
    weekday: weekdayMap[parts.weekday ?? ""] ?? date.getUTCDay(),
  };
}

function matchCronField(field: string, value: number, min: number, max: number): boolean {
  if (field === "*") {
    return true;
  }

  // Step: */n
  if (field.startsWith("*/")) {
    const step = Number(field.slice(2));

    if (!Number.isFinite(step) || step <= 0) {
      return false;
    }

    return (value - min) % step === 0;
  }

  // Range: a-b
  if (field.includes("-")) {
    const [lo, hi] = field.split("-").map(Number);

    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      return false;
    }

    return value >= lo && value <= hi;
  }

  // List: a,b,c
  if (field.includes(",")) {
    return field.split(",").some((item) => Number(item.trim()) === value);
  }

  // Single value
  return Number(field) === value;
}

/**
 * Parse a schedule (type + value) and compute the next run time.
 */
export function computeNextRun(scheduleType: string, scheduleValue: string, from?: Date, timeZone = "UTC"): string {
  const fromDate = from !== undefined ? from : new Date();
  switch (scheduleType) {
    case "interval": {
      const ms = parseInterval(scheduleValue);
      return new Date(fromDate.getTime() + ms).toISOString();
    }
    case "cron_expr":
      return computeCronNextRun(scheduleValue, fromDate, timeZone);
    case "once": {
      const date = new Date(scheduleValue);

      if (Number.isNaN(date.getTime())) {
        throw new Error(`Invalid once timestamp: "${scheduleValue}". Use ISO 8601 format.`);
      }

      if (date.getTime() <= fromDate.getTime()) {
        throw new Error(`Once timestamp must be in the future: "${scheduleValue}".`);
      }

      return date.toISOString();
    }
    default:
      throw new Error(`Unknown schedule type: "${scheduleType}"`);
  }
}

/**
 * Validate a schedule configuration without persisting.
 */
export function validateSchedule(scheduleType: string, scheduleValue: string, timeZone = "UTC"): string | undefined {
  try {
    computeNextRun(scheduleType, scheduleValue, undefined, timeZone);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid schedule";
  }
}
