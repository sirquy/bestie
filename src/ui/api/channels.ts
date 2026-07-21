import { access } from "node:fs/promises";

import { CHANNELS } from "../../channels/registry.js";
import { getDaemonChannelStatus, runDaemonCommand, type DaemonChannel } from "../../cli/commands/daemon.js";
import { SqliteMemoryStore, type CronSchedule } from "../../memory/sqlite-store.js";
import { loadConfig, type AppConfig } from "../../runtime/config.js";
import { loadEnvFile } from "../../runtime/env.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

export interface UiChannelSummary {
  ok: true;
  channels: UiConfiguredChannel[];
  cron: {
    databaseExists: boolean;
    counts: {
      total: number;
      enabled: number;
      disabled: number;
    };
    schedules: UiCronSchedule[];
  };
  service: {
    supported: boolean;
    statusCommand: string;
  };
}

export type UiChannelActionOptions = UiDaemonActionOptions | UiCronToggleActionOptions;

interface UiDaemonActionOptions {
  action: "daemon_start" | "daemon_stop" | "daemon_restart";
  channel: DaemonChannel;
  confirm: boolean;
  paths?: RuntimePaths;
}

interface UiCronToggleActionOptions {
  action: "cron_toggle";
  id: number;
  enabled: boolean;
  confirm: boolean;
  paths?: RuntimePaths;
}

export interface UiChannelActionResult extends UiChannelSummary {
  action: UiChannelActionOptions["action"];
  channel?: DaemonChannel;
  id?: number;
  enabled?: boolean;
  messages: string[];
}

interface UiConfiguredChannel {
  id: string;
  displayName: string;
  enabled: boolean;
  ownerConfigured: boolean;
  tokenEnv?: string;
  secretPresent: boolean;
  daemon: {
    state: "running" | "stale" | "stopped";
    pid?: number;
    logPath?: string;
  };
  capabilities: Record<string, boolean>;
}

interface UiCronSchedule {
  id: number;
  name: string;
  scheduleType: CronSchedule["scheduleType"];
  scheduleValue: string;
  channel?: string;
  enabled: boolean;
  nextRunAt: string;
  lastResult?: string;
  runCount: number;
}

export async function getUiChannelSummary(paths: RuntimePaths = getRuntimePaths()): Promise<UiChannelSummary> {
  const [config, envValues] = await Promise.all([loadConfig(paths), loadEnvFile(paths)]);
  const channels = await Promise.all(CHANNELS.map(async (channel) => {
    const channelConfig = getChannelConfig(config, channel.configKey);
    const daemon = await getDaemonChannelStatus(paths, channel.id as DaemonChannel);
    return {
      id: channel.id,
      displayName: channel.displayName,
      enabled: channelConfig?.enabled === true,
      ownerConfigured: Boolean(channelConfig?.ownerUserId?.trim()),
      ...(channelConfig?.botTokenEnv ? { tokenEnv: channelConfig.botTokenEnv } : {}),
      secretPresent: channelConfig?.botTokenEnv ? Boolean(process.env[channelConfig.botTokenEnv] ?? envValues[channelConfig.botTokenEnv]) : false,
      daemon: {
        state: daemon.state,
        ...(daemon.pid !== undefined ? { pid: daemon.pid } : {}),
        ...(daemon.logPath ? { logPath: daemon.logPath } : {}),
      },
      capabilities: channel.capabilities,
    };
  }));

  return {
    ok: true,
    channels,
    cron: await getCronSummary(paths),
    service: {
      supported: process.platform === "linux",
      statusCommand: "systemctl --user status bestie.service",
    },
  };
}

export async function runUiChannelAction(options: UiChannelActionOptions): Promise<UiChannelActionResult> {
  if (!options.confirm) {
    throw new Error("Channel actions require confirm=true.");
  }

  const paths = options.paths ?? getRuntimePaths();
  const messages: string[] = [];
  if (options.action === "cron_toggle") {
    if (!Number.isInteger(options.id) || options.id <= 0) {
      throw new Error("Cron toggle requires numeric id and boolean enabled.");
    }
    await setCronEnabled(paths, options.id, options.enabled, messages);
  } else {
    await runDaemonCommand({
      argv: ["node", "bestie", "daemon", toDaemonSubcommand(options.action), "--channel", options.channel],
      paths,
      writeLine: (message) => messages.push(message),
    });
  }

  return {
    ...(await getUiChannelSummary(paths)),
    action: options.action,
    ...(options.action === "cron_toggle" ? { id: options.id, enabled: options.enabled } : { channel: options.channel }),
    messages,
  };
}

function toDaemonSubcommand(action: Exclude<UiChannelActionOptions["action"], "cron_toggle">): "start" | "stop" | "restart" {
  if (action === "daemon_start") return "start";
  if (action === "daemon_stop") return "stop";
  return "restart";
}

async function setCronEnabled(paths: RuntimePaths, id: number, enabled: boolean, messages: string[]): Promise<void> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    const schedule = store.getCronSchedule(id);
    if (schedule.enabled !== enabled) {
      store.toggleCronSchedule(id, enabled);
    }
    messages.push(`Cron schedule ${id} ${enabled ? "enabled" : "disabled"}.`);
  } catch {
    throw new Error(`Cron schedule not found: ${id}`);
  } finally {
    store.close();
  }
}

function getChannelConfig(config: AppConfig, configKey: string): { enabled: boolean; ownerUserId: string; botTokenEnv: string } | undefined {
  return config.channels?.[configKey as keyof NonNullable<AppConfig["channels"]>];
}

async function getCronSummary(paths: RuntimePaths): Promise<UiChannelSummary["cron"]> {
  const databaseExists = await pathExists(paths.memoryDbPath);
  if (!databaseExists) {
    return { databaseExists: false, counts: { total: 0, enabled: 0, disabled: 0 }, schedules: [] };
  }

  const store = await SqliteMemoryStore.open(paths);
  try {
    const schedules = store.listCronSchedules(20);
    const enabled = schedules.filter((schedule) => schedule.enabled).length;
    return {
      databaseExists: true,
      counts: { total: schedules.length, enabled, disabled: schedules.length - enabled },
      schedules: schedules.map(toUiCronSchedule),
    };
  } finally {
    store.close();
  }
}

function toUiCronSchedule(schedule: CronSchedule): UiCronSchedule {
  return {
    id: schedule.id,
    name: schedule.name,
    scheduleType: schedule.scheduleType,
    scheduleValue: schedule.scheduleValue,
    ...(schedule.channel ? { channel: schedule.channel } : {}),
    enabled: schedule.enabled,
    nextRunAt: schedule.nextRunAt,
    ...(schedule.lastResult ? { lastResult: schedule.lastResult } : {}),
    runCount: schedule.runCount,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}