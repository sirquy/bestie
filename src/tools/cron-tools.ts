import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import type { McpToolCallResult } from "../mcp/connection.js";
import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import { isCronReportDestination } from "../cron/channel-commands.js";
import { CronExecutor } from "../cron/executor.js";
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

export interface UpdateCronScheduleArgs {
  schedule_id?: number;
  name?: string;
  schedule_type?: string;
  schedule_value?: string;
  prompt?: string;
  channel?: string | null;
  enabled?: boolean;
}

export interface TriggerCronScheduleArgs {
  schedule_id?: number;
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

  const validationError = validateSchedule(scheduleType, scheduleValue, options.config.agent.timeZone);
  if (validationError) {
    return { ok: false, status: "fail", message: `Invalid schedule: ${validationError}` };
  }

  const nextRunAt = computeNextRun(scheduleType, scheduleValue, undefined, options.config.agent.timeZone);
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

export async function updateCronScheduleTool(
  args: UpdateCronScheduleArgs,
  options: { config: AppConfig; paths: RuntimePaths },
): Promise<McpToolCallResult> {
  const scheduleId = typeof args.schedule_id === "number" ? args.schedule_id : undefined;
  if (scheduleId === undefined) {
    return { ok: false, status: "fail", message: "internal.update_cron_schedule requires arguments.schedule_id." };
  }

  const store = await SqliteMemoryStore.open(options.paths);
  try {
    const existing = store.getCronSchedule(scheduleId);
    const name = args.name === undefined ? existing.name : typeof args.name === "string" ? args.name.trim() : "";
    const scheduleType = args.schedule_type === undefined ? existing.scheduleType : typeof args.schedule_type === "string" ? args.schedule_type.trim() : "";
    const scheduleValue = args.schedule_value === undefined ? existing.scheduleValue : typeof args.schedule_value === "string" ? args.schedule_value.trim() : "";
    const prompt = args.prompt === undefined ? existing.prompt : typeof args.prompt === "string" ? args.prompt.trim() : "";
    const channel = args.channel === undefined ? existing.channel : typeof args.channel === "string" ? args.channel.trim() || undefined : undefined;
    const enabled = args.enabled === undefined ? existing.enabled : args.enabled;

    if (!name) {
      return { ok: false, status: "fail", message: "internal.update_cron_schedule arguments.name must be non-empty when provided." };
    }
    if (!scheduleType || !["interval", "cron_expr", "once"].includes(scheduleType)) {
      return { ok: false, status: "fail", message: "internal.update_cron_schedule arguments.schedule_type must be 'interval', 'cron_expr', or 'once' when provided." };
    }
    if (!scheduleValue) {
      return { ok: false, status: "fail", message: "internal.update_cron_schedule arguments.schedule_value must be non-empty when provided." };
    }
    if (!prompt) {
      return { ok: false, status: "fail", message: "internal.update_cron_schedule arguments.prompt must be non-empty when provided." };
    }
    if (channel !== undefined && !isCronReportDestination(channel)) {
      return { ok: false, status: "fail", message: "internal.update_cron_schedule arguments.channel must be 'telegram:<userId>', 'zalo:<userId>', null, or an empty string." };
    }

    const scheduleChanged = scheduleType !== existing.scheduleType || scheduleValue !== existing.scheduleValue;
    const validationError = scheduleChanged ? validateSchedule(scheduleType, scheduleValue, options.config.agent.timeZone) : undefined;
    if (validationError) {
      return { ok: false, status: "fail", message: `Invalid schedule: ${validationError}` };
    }

    const nextRunAt = scheduleChanged ? computeNextRun(scheduleType, scheduleValue, undefined, options.config.agent.timeZone) : existing.nextRunAt;
    const schedule = store.updateCronSchedule(scheduleId, {
      name,
      scheduleType: scheduleType as "interval" | "cron_expr" | "once",
      scheduleValue,
      prompt,
      channel,
      enabled,
      nextRunAt,
    });

    return {
      ok: true,
      status: "pass",
      message: `Cron schedule ${scheduleId} updated.` + (scheduleChanged ? ` Next run: ${nextRunAt}` : ""),
      result: {
        scheduleId: schedule.id,
        name: schedule.name,
        scheduleType: schedule.scheduleType,
        scheduleValue: schedule.scheduleValue,
        prompt: schedule.prompt,
        channel: schedule.channel,
        enabled: schedule.enabled,
        nextRunAt: schedule.nextRunAt,
      },
    };
  } catch (error) {
    return { ok: false, status: "fail", message: error instanceof Error ? error.message : `Cron schedule ${scheduleId} not found.` };
  } finally {
    store.close();
  }
}

export async function triggerCronScheduleTool(
  args: TriggerCronScheduleArgs,
  options: { config: AppConfig; paths: RuntimePaths; apiKey?: string; runScheduleNow?: (scheduleId: number) => Promise<void> },
): Promise<McpToolCallResult> {
  const scheduleId = typeof args.schedule_id === "number" ? args.schedule_id : undefined;
  if (scheduleId === undefined) {
    return { ok: false, status: "fail", message: "internal.trigger_cron_schedule requires arguments.schedule_id." };
  }

  try {
    if (options.runScheduleNow) {
      await options.runScheduleNow(scheduleId);
    } else {
      const executor = new CronExecutor({ config: options.config, paths: options.paths, apiKey: options.apiKey });
      await executor.runScheduleNow(scheduleId);
    }
    return { ok: true, status: "pass", message: `Cron schedule ${scheduleId} triggered.` };
  } catch (error) {
    return { ok: false, status: "fail", message: error instanceof Error ? error.message : `Cron schedule ${scheduleId} could not be triggered.` };
  }
}
