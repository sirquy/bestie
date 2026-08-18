import { loadConfig } from "../runtime/config.js";
import { SqliteMemoryStore, type CronSchedule } from "../memory/sqlite-store.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { computeNextRun, validateSchedule } from "./scheduler.js";

export type CronReportChannel = "telegram" | "zalo" | "zalo-personal";

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
  triggerSchedule?: (scheduleId: number) => Promise<void>;
}): Promise<boolean> {
  const parts = parseCommandParts(options.text);
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

  if (action === "update" || action === "edit") {
    const id = Number(parts[2]);
    if (!Number.isSafeInteger(id) || id <= 0) {
      await options.sendMessage("Usage: /cron update <id> [--name text] [--type interval|cron_expr|once] [--schedule value] [--prompt text] [--channel current|none] [--enable|--disable]");
      return true;
    }

    const args = parseNamedArgs(parts.slice(3));
    const config = await loadConfig(options.paths);
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

      const update = buildScheduleUpdate(schedule, args, destination, config.agent.timeZone);
      if (update.kind === "invalid") {
        await options.sendMessage(update.message);
        return true;
      }

      const updated = store.updateCronSchedule(id, update.schedule);
      await options.sendMessage(formatCronScheduleUpdated(updated, update.scheduleChanged));
      return true;
    } finally {
      store.close();
    }
  }

  if (action === "trigger" || action === "run-now") {
    const id = Number(parts[2]);
    if (!Number.isSafeInteger(id) || id <= 0) {
      await options.sendMessage("Usage: /cron trigger <id>");
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
    } finally {
      store.close();
    }

    await options.sendMessage(`Triggering cron schedule ${id} now...`);
    try {
      await options.triggerSchedule?.(id);
      if (!options.triggerSchedule) {
        const { CronExecutor } = await import("./executor.js");
        const config = await loadConfig(options.paths);
        await new CronExecutor({ config, paths: options.paths }).runScheduleNow(id);
      }
      await options.sendMessage(`Cron schedule ${id} triggered.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      await options.sendMessage(`Cron schedule ${id} failed to trigger: ${message}`);
    }
    return true;
  }

  await options.sendMessage("Usage: /cron list, /cron update <id> ..., /cron trigger <id>, or /cron delete <id>");
  return true;
}

interface ParsedCronArgs {
  name?: string;
  type?: string;
  schedule?: string;
  prompt?: string;
  channel?: string;
  enabled?: boolean;
}

type ScheduleUpdateResult =
  | { kind: "valid"; schedule: Parameters<SqliteMemoryStore["updateCronSchedule"]>[1]; scheduleChanged: boolean }
  | { kind: "invalid"; message: string };

function buildScheduleUpdate(existing: CronSchedule, args: ParsedCronArgs, currentDestination: string, timeZone?: string): ScheduleUpdateResult {
  const name = args.name === undefined ? existing.name : args.name.trim();
  const scheduleType = args.type === undefined ? existing.scheduleType : args.type.trim();
  const scheduleValue = args.schedule === undefined ? existing.scheduleValue : args.schedule.trim();
  const prompt = args.prompt === undefined ? existing.prompt : args.prompt.trim();
  const channel = args.channel === undefined ? existing.channel : normalizeChannelArg(args.channel, currentDestination);
  const enabled = args.enabled === undefined ? existing.enabled : args.enabled;

  if (!name) return { kind: "invalid", message: "--name must be non-empty." };
  if (!scheduleType || !["interval", "cron_expr", "once"].includes(scheduleType)) return { kind: "invalid", message: "--type must be interval, cron_expr, or once." };
  if (!scheduleValue) return { kind: "invalid", message: "--schedule must be non-empty." };
  if (!prompt) return { kind: "invalid", message: "--prompt must be non-empty." };
  if (channel !== undefined && !isCronReportDestination(channel)) return { kind: "invalid", message: "--channel must be current, none, telegram:<userId>, or zalo:<userId>." };

  const scheduleChanged = scheduleType !== existing.scheduleType || scheduleValue !== existing.scheduleValue;
  const validationError = scheduleChanged ? validateSchedule(scheduleType, scheduleValue, timeZone) : undefined;
  if (validationError) return { kind: "invalid", message: `Invalid schedule: ${validationError}` };

  return {
    kind: "valid",
    scheduleChanged,
    schedule: {
      name,
      scheduleType: scheduleType as "interval" | "cron_expr" | "once",
      scheduleValue,
      prompt,
      channel,
      enabled,
      nextRunAt: scheduleChanged ? computeNextRun(scheduleType, scheduleValue, undefined, timeZone) : existing.nextRunAt,
    },
  };
}

function normalizeChannelArg(value: string, currentDestination: string): string | undefined {
  const normalized = value.trim();
  if (!normalized || normalized === "none" || normalized === "clear") return undefined;
  if (normalized === "current") return currentDestination;
  return normalized;
}

function parseNamedArgs(parts: string[]): ParsedCronArgs {
  const args: ParsedCronArgs = {};
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const assignment = part.match(/^--?([^=]+)=(.*)$/);
    const key = assignment?.[1] ?? (part.startsWith("--") ? part.slice(2) : part.includes("=") ? part.slice(0, part.indexOf("=")) : undefined);
    const inlineValue = assignment?.[2] ?? (!part.startsWith("--") && part.includes("=") ? part.slice(part.indexOf("=") + 1) : undefined);

    if (!key) continue;
    if (key === "enable") args.enabled = true;
    else if (key === "disable") args.enabled = false;
    else {
      const value = inlineValue ?? parts[index + 1];
      if (inlineValue === undefined) index++;
      if (value === undefined) continue;
      if (key === "name") args.name = value;
      if (key === "type") args.type = value;
      if (key === "schedule") args.schedule = value;
      if (key === "prompt") args.prompt = value;
      if (key === "channel") args.channel = value;
    }
  }
  return args;
}

function parseCommandParts(text: string): string[] {
  const parts: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  for (const match of text.matchAll(pattern)) {
    parts.push((match[1] ?? match[2] ?? match[3]).replace(/\\(["'\\])/g, "$1"));
  }
  return parts;
}

function formatCronScheduleUpdated(schedule: CronSchedule, scheduleChanged: boolean): string {
  return [
    `Cron schedule ${schedule.id} updated.`,
    `Name: ${schedule.name}`,
    `Schedule: ${schedule.scheduleType} ${schedule.scheduleValue}`,
    `Enabled: ${schedule.enabled ? "on" : "off"}`,
    `Channel: ${schedule.channel ?? "none"}`,
    `Next: ${schedule.nextRunAt || "none"}${scheduleChanged ? " (recomputed)" : ""}`,
  ].join("\n");
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
