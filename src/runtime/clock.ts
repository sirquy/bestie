export interface RuntimeClock {
  nowIso: string;
  timeZone: string;
  local: string;
  date: string;
  time: string;
  dayOfWeek: string;
  offset: string;
}

export function getRuntimeClock(timeZone: string, now: Date = new Date()): RuntimeClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "long",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const time = `${values.hour}:${values.minute}:${values.second}`;
  const offset = values.timeZoneName ?? "unknown";

  return {
    nowIso: now.toISOString(),
    timeZone,
    local: `${date} ${time} ${offset}`,
    date,
    time,
    dayOfWeek: values.weekday ?? "unknown",
    offset,
  };
}

export function formatRuntimeClock(clock: RuntimeClock): string {
  return [
    "Current runtime time (read from the Bestie host clock):",
    `- UTC: ${clock.nowIso}`,
    `- Timezone: ${clock.timeZone}`,
    `- Local date/time: ${clock.local}`,
    `- Date: ${clock.date}`,
    `- Time: ${clock.time}`,
    `- Day of week: ${clock.dayOfWeek}`,
  ].join("\n");
}
