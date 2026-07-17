import { isCronReportDestination } from "../cron/channel-commands.js";
import { computeNextRun, validateSchedule } from "../cron/scheduler.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { SqliteMemoryStore, type CronSchedule } from "./sqlite-store.js";

export const MEMORY_MAINTENANCE_CRON_NAME = "Bestie memory maintenance report";
export const MEMORY_MAINTENANCE_DEFAULT_SCHEDULE = "0 9 * * 1";
export const MEMORY_MAINTENANCE_PROMPT = [
  "Run a read-only weekly memory hygiene digest.",
  "Use internal.plan_memory_hygiene.",
  "Use internal.memory_hygiene_trend with limit 8 to report the recent score trend and whether the latest score improved, regressed, or stayed flat.",
  "Report deleteIds, reviewOnlyIds, duplicate groups, stale memories, and conflicts as a concise cleanup plan.",
  "Tell the owner to run bestie memory hygiene --apply --yes from CLI, or /memory hygiene apply confirm from Telegram/Zalo, only if they want to apply the planned deletion candidates.",
  "Do not delete, edit, save, or supersede memories during this report.",
].join(" ");

export interface MemoryMaintenanceInstallOptions {
  paths?: RuntimePaths;
  channel?: string;
  scheduleValue?: string;
}

export type MemoryMaintenanceInstallResult =
  | { ok: true; schedule: CronSchedule }
  | { ok: false; reason: string };

export async function installMemoryMaintenanceReport(options: MemoryMaintenanceInstallOptions = {}): Promise<MemoryMaintenanceInstallResult> {
  const scheduleValue = options.scheduleValue ?? MEMORY_MAINTENANCE_DEFAULT_SCHEDULE;
  const scheduleError = validateSchedule("cron_expr", scheduleValue);

  if (scheduleError) {
    return { ok: false, reason: `Invalid maintenance schedule: ${scheduleError}` };
  }

  if (options.channel !== undefined && !isCronReportDestination(options.channel)) {
    return { ok: false, reason: "Channel must be telegram:<userId> or zalo:<userId>." };
  }

  const store = await SqliteMemoryStore.open(options.paths);

  try {
    const existing = findMemoryMaintenanceSchedule(store.listCronSchedules());
    if (existing) {
      store.removeCronSchedule(existing.id);
    }

    const schedule = store.addCronSchedule({
      name: MEMORY_MAINTENANCE_CRON_NAME,
      scheduleType: "cron_expr",
      scheduleValue,
      prompt: MEMORY_MAINTENANCE_PROMPT,
      channel: options.channel,
      nextRunAt: computeNextRun("cron_expr", scheduleValue),
    });

    return { ok: true, schedule };
  } finally {
    store.close();
  }
}

export async function getMemoryMaintenanceReportStatus(paths?: RuntimePaths): Promise<CronSchedule | undefined> {
  const store = await SqliteMemoryStore.open(paths);

  try {
    return findMemoryMaintenanceSchedule(store.listCronSchedules());
  } finally {
    store.close();
  }
}

export async function removeMemoryMaintenanceReport(paths?: RuntimePaths): Promise<CronSchedule | undefined> {
  const store = await SqliteMemoryStore.open(paths);

  try {
    const schedule = findMemoryMaintenanceSchedule(store.listCronSchedules());
    if (!schedule) {
      return undefined;
    }

    store.removeCronSchedule(schedule.id);
    return schedule;
  } finally {
    store.close();
  }
}

function findMemoryMaintenanceSchedule(schedules: CronSchedule[]): CronSchedule | undefined {
  return schedules.find((schedule) => schedule.name === MEMORY_MAINTENANCE_CRON_NAME);
}