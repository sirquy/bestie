import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import type { McpToolCallResult } from "../mcp/connection.js";
import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import { isCronReportDestination } from "../cron/channel-commands.js";
import { computeNextRun, validateSchedule } from "../cron/scheduler.js";

// --- Tool argument types ---

export interface AddCronScheduleArgs {
  name?: string;
  schedule_type?: string;
  schedule_value?: string;
  prompt?: string;
  channel?: string;
}

export interface RemoveCronScheduleArgs {
  schedule_id?: number;
}

export interface ToggleCronScheduleArgs {
  schedule_id?: number;
  enabled?: boolean;
}

// --- Tool result type (matches existing pattern) ---

export interface CronToolResult {
  allowed: boolean;
  reason: string;
  [key: string]: unknown;
}

// --- Tool functions ---

export async function addCronScheduleTool(
  args: AddCronScheduleArgs,
  options: { config: AppConfig; paths: RuntimePaths },
): Promise<McpToolCallResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const scheduleType = typeof args.schedule_type === "string" ? args.schedule_type.trim() : "";
  const scheduleValue = typeof args.schedule_value === "string" ? args.schedule_value.trim() : "";
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  const channel = typeof args.channel === "string" ? args.channel.trim() : undefined;

  if (!name) {
    return { ok: false, status: "fail", message: "internal.add_cron_schedule requires arguments.name." };
  }

  if (!scheduleType || !["interval", "cron_expr", "once"].includes(scheduleType)) {
    return { ok: false, status: "fail", message: "internal.add_cron_schedule requires arguments.schedule_type to be 'interval', 'cron_expr', or 'once'." };
  }

  if (!scheduleValue) {
    return { ok: false, status: "fail", message: "internal.add_cron_schedule requires arguments.schedule_value." };
  }

  if (!prompt) {
    return { ok: false, status: "fail", message: "internal.add_cron_schedule requires arguments.prompt." };
  }

  if (channel !== undefined && !isCronReportDestination(channel)) {
    return { ok: false, status: "fail", message: "internal.add_cron_schedule arguments.channel must be 'telegram:<userId>' or 'zalo:<userId>'." };
  }

  const validationError = validateSchedule(scheduleType, scheduleValue);
  if (validationError) {
    return { ok: false, status: "fail", message: `Invalid schedule: ${validationError}` };
  }

  const nextRunAt = computeNextRun(scheduleType, scheduleValue);
  const store = await SqliteMemoryStore.open(options.paths);

  try {
    const schedule = store.addCronSchedule({
      name,
      scheduleType: scheduleType as "interval" | "cron_expr" | "once",
      scheduleValue,
      prompt,
      channel,
      nextRunAt,
    });

    return {
      ok: true,
      status: "pass",
      message: `Cron schedule created: ${name} (ID: ${schedule.id}). Next run: ${nextRunAt}`,
      result: {
        scheduleId: schedule.id,
        name: schedule.name,
        scheduleType: schedule.scheduleType,
        scheduleValue: schedule.scheduleValue,
        channel: schedule.channel,
        nextRunAt: schedule.nextRunAt,
      },
    };
  } finally {
    store.close();
  }
}

export async function listCronSchedulesTool(
  options: { config: AppConfig; paths: RuntimePaths },
): Promise<McpToolCallResult> {
  const store = await SqliteMemoryStore.open(options.paths);

  try {
    const schedules = store.listCronSchedules();

    return {
      ok: true,
      status: "pass",
      message: `Found ${schedules.length} cron schedule(s).`,
      result: {
        schedules: schedules.map((s) => ({
          id: s.id,
          name: s.name,
          scheduleType: s.scheduleType,
          scheduleValue: s.scheduleValue,
          prompt: s.prompt.length > 80 ? s.prompt.slice(0, 77) + "..." : s.prompt,
          channel: s.channel,
          enabled: s.enabled,
          nextRunAt: s.nextRunAt,
          lastRunAt: s.lastRunAt,
          runCount: s.runCount,
          lastResult: s.lastResult,
        })),
      },
    };
  } finally {
    store.close();
  }
}

export async function removeCronScheduleTool(
  args: RemoveCronScheduleArgs,
  options: { config: AppConfig; paths: RuntimePaths },
): Promise<McpToolCallResult> {
  const scheduleId = typeof args.schedule_id === "number" ? args.schedule_id : undefined;

  if (scheduleId === undefined) {
    return { ok: false, status: "fail", message: "internal.remove_cron_schedule requires arguments.schedule_id." };
  }

  const store = await SqliteMemoryStore.open(options.paths);

  try {
    const removed = store.removeCronSchedule(scheduleId);

    return removed
      ? { ok: true, status: "pass", message: `Cron schedule ${scheduleId} removed.` }
      : { ok: false, status: "fail", message: `Cron schedule ${scheduleId} not found.` };
  } finally {
    store.close();
  }
}

export async function toggleCronScheduleTool(
  args: ToggleCronScheduleArgs,
  options: { config: AppConfig; paths: RuntimePaths },
): Promise<McpToolCallResult> {
  const scheduleId = typeof args.schedule_id === "number" ? args.schedule_id : undefined;
  const enabled = typeof args.enabled === "boolean" ? args.enabled : undefined;

  if (scheduleId === undefined) {
    return { ok: false, status: "fail", message: "internal.toggle_cron_schedule requires arguments.schedule_id." };
  }

  if (enabled === undefined) {
    return { ok: false, status: "fail", message: "internal.toggle_cron_schedule requires arguments.enabled (true or false)." };
  }

  const store = await SqliteMemoryStore.open(options.paths);

  try {
    const schedule = store.toggleCronSchedule(scheduleId, enabled);

    return {
      ok: true,
      status: "pass",
      message: `Cron schedule ${scheduleId} ${enabled ? "enabled" : "disabled"}.`,
      result: {
        id: schedule.id,
        name: schedule.name,
        enabled: schedule.enabled,
      },
    };
  } catch {
    return { ok: false, status: "fail", message: `Cron schedule ${scheduleId} not found.` };
  } finally {
    store.close();
  }
}
