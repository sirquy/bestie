import { SqliteMemoryStore, type CronSchedule } from "../memory/sqlite-store.js";
import type { RuntimePaths } from "../runtime/paths.js";

export type CronReportChannel = "telegram" | "zalo";

export interface CronReportDestination {
  channel: CronReportChannel;
  userId: string;
}

const CRON_DESTINATION_PATTERN = /^(telegram|zalo):([^\s:]+)$/;

export function parseCronReportDestination(value: string | undefined): CronReportDestination | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const match = CRON_DESTINATION_PATTERN.exec(trimmed);
  if (!match) {
    return undefined;
  }

  return { channel: match[1] as CronReportChannel, userId: match[2] };
}

export function formatCronReportDestination(destination: CronReportDestination): string {
  return `${destination.channel}:${destination.userId}`;
}

export function isCronReportDestination(value: string | undefined): boolean {
  return parseCronReportDestination(value) !== undefined;
}

export async function handleCronChannelCommand(options: {
  text: string;
  paths: RuntimePaths;
  channel: CronReportChannel;
  userId: string;
  sendMessage: (message: string) => Promise<void>;
}): Promise<boolean> {
  const parts = options.text.trim().split(/\s+/);
  if (parts[0] !== "/cron") {
    return false;
  }

  const destination = formatCronReportDestination({ channel: options.channel, userId: options.userId });
  const action = parts[1] ?? "list";

  if (action === "list") {
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const schedules = store.listCronSchedules().filter((schedule) => schedule.channel === destination);
      await options.sendMessage(formatCronScheduleList(schedules, destination));
      return true;
    } finally {
      store.close();
    }
  }

  if (action === "delete" || action === "remove") {
    const id = Number(parts[2]);
    if (!Number.isSafeInteger(id) || id <= 0) {
      await options.sendMessage("Usage: /cron delete <id>");
      return true;
    }

    const store = await SqliteMemoryStore.open(options.paths);
    try {
      let schedule: CronSchedule | undefined;
      try {
        schedule = store.getCronSchedule(id);
      } catch {
        schedule = undefined;
      }

      if (!schedule || schedule.channel !== destination) {
        await options.sendMessage(`Cron schedule ${id} not found for ${destination}.`);
        return true;
      }

      store.removeCronSchedule(id);
      await options.sendMessage(`Cron schedule ${id} deleted.`);
      return true;
    } finally {
      store.close();
    }
  }

  await options.sendMessage("Usage: /cron list or /cron delete <id>");
  return true;
}

function formatCronScheduleList(schedules: CronSchedule[], destination: string): string {
  if (schedules.length === 0) {
    return `No cron schedules for ${destination}.`;
  }

  return [
    `Cron schedules for ${destination}:`,
    ...schedules.map((schedule) => {
      const state = schedule.enabled ? "on" : "off";
      const last = schedule.lastResult ? ` last=${schedule.lastResult}` : "";
      return `#${schedule.id} ${schedule.name} [${state}] next=${schedule.nextRunAt || "none"}${last}`;
    }),
  ].join("\n");
}
