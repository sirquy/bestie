import { access } from "node:fs/promises";

import { CHANNELS } from "../../channels/registry.js";
import { hasConfiguredOwner, type OwnerUserIdConfig } from "../../channels/owner-policy.js";
import { getDaemonChannelStatus, runDaemonCommand, type DaemonChannel } from "../../cli/commands/daemon.js";
import { CronExecutor } from "../../cron/executor.js";
import { computeNextRun } from "../../cron/scheduler.js";
import { SqliteMemoryStore, type CronLog, type CronSchedule } from "../../memory/sqlite-store.js";
import { loadConfig, writeConfig, type AgentChannelBinding, type AppConfig } from "../../runtime/config.js";
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
    logs: UiCronLog[];
  };
  service: {
    supported: boolean;
    statusCommand: string;
  };
}

export type UiChannelActionOptions = UiDaemonActionOptions | UiCronToggleActionOptions | UiCronAddActionOptions | UiCronUpdateActionOptions | UiCronDeleteActionOptions | UiCronTriggerActionOptions | UiChannelAccessUpdateOptions;

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

interface UiCronAddActionOptions {
  action: "cron_add";
  name: string;
  scheduleType: CronSchedule["scheduleType"];
  scheduleValue: string;
  prompt: string;
  channel?: string;
  enabled: boolean;
  confirm: boolean;
  paths?: RuntimePaths;
}

interface UiCronUpdateActionOptions {
  action: "cron_update";
  id: number;
  name: string;
  scheduleType: CronSchedule["scheduleType"];
  scheduleValue: string;
  prompt: string;
  channel?: string;
  enabled: boolean;
  confirm: boolean;
  paths?: RuntimePaths;
}

interface UiCronDeleteActionOptions {
  action: "cron_delete";
  id: number;
  confirm: boolean;
  paths?: RuntimePaths;
}

interface UiCronTriggerActionOptions {
  action: "cron_trigger";
  id: number;
  confirm: boolean;
  paths?: RuntimePaths;
}

export type UiChannelId = "telegram" | "zalo" | "zalo-personal";

export interface UiChannelConfig {
  id: UiChannelId;
  configured: boolean;
  enabled: boolean;
  ownerUserIds: string[];
  adminUserIds: string[];
  credentialEnv: string;
  credentialLabel: "Bot token env" | "Session env";
  pollingTimeoutSeconds?: number;
  voiceReplyPolicy?: "deny" | "voice-input-only";
  voiceReplyMaxChars?: number;
  voiceReplyCooldownMs?: number;
  reconnect?: { initialDelayMs?: number; maxDelayMs?: number };
  attachments: {
    downloadPolicy?: "allow" | "deny";
    maxBytes?: number;
    previewMaxBytes?: number;
    parseMaxBytes?: number;
    visionPolicy?: "allow" | "deny";
    visionMaxBytes?: number;
    transcriptionPolicy?: "allow" | "deny";
    transcriptionMaxBytes?: number;
    deleteAfterProcessingKinds?: string[];
    allowedMimeTypes?: string[];
  };
}

export interface UiChannelConfigSummary { ok: true; channels: UiChannelConfig[]; }

interface UiChannelAccessUpdateOptions {
  action: "update_access";
  channel: AgentChannelBinding;
  ownerUserIds: string[];
  adminUserIds?: string[];
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
  ownerUserIds?: string[];
  adminUserIds?: string[];
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
  prompt: string;
  channel?: string;
  enabled: boolean;
  nextRunAt: string;
  lastResult?: string;
  runCount: number;
}

interface UiCronLog {
  id: number;
  scheduleId: number;
  startedAt: string;
  finishedAt?: string;
  result?: string;
  output?: string;
  error?: string;
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
      ownerConfigured: hasConfiguredOwner(channelConfig?.ownerUserId),
      ...(channelConfig?.ownerUserId === undefined ? {} : { ownerUserIds: Array.isArray(channelConfig.ownerUserId) ? channelConfig.ownerUserId : [channelConfig.ownerUserId] }),
      ...(channelConfig?.adminUserIds ? { adminUserIds: channelConfig.adminUserIds } : {}),
      ...(channelConfig?.botTokenEnv ?? channelConfig?.sessionEnv ? { tokenEnv: channelConfig.botTokenEnv ?? channelConfig.sessionEnv } : {}),
      secretPresent: channelConfig?.botTokenEnv ?? channelConfig?.sessionEnv ? Boolean(process.env[channelConfig.botTokenEnv ?? channelConfig.sessionEnv!] ?? envValues[channelConfig.botTokenEnv ?? channelConfig.sessionEnv!]) : false,
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
  if (options.action === "update_access") {
    await updateChannelAccess(paths, options, messages);
  } else if (options.action === "cron_toggle") {
    if (!Number.isInteger(options.id) || options.id <= 0) {
      throw new Error("Cron toggle requires numeric id and boolean enabled.");
    }
    await setCronEnabled(paths, options.id, options.enabled, messages);
  } else if (options.action === "cron_add") {
    await addCronSchedule(paths, options, messages);
  } else if (options.action === "cron_update") {
    await updateCronSchedule(paths, options, messages);
  } else if (options.action === "cron_delete") {
    await deleteCronSchedule(paths, options.id, messages);
  } else if (options.action === "cron_trigger") {
    await triggerCronSchedule(paths, options.id, messages);
  } else {
    await runDaemonCommand({
      argv: ["node", "bestie", "daemon", toDaemonSubcommand(options.action), "--channel", options.channel],
      paths,
      manageUi: false,
      writeLine: (message) => messages.push(message),
    });
  }

  return {
    ...(await getUiChannelSummary(paths)),
    action: options.action,
    ...toActionMetadata(options),
    messages,
  };
}

function toActionMetadata(options: UiChannelActionOptions): { id?: number; enabled?: boolean; channel?: DaemonChannel } {
  if (options.action === "update_access") return {};
  if (options.action === "cron_add") {
    return { enabled: options.enabled };
  }
  if (options.action === "cron_toggle" || options.action === "cron_update") {
    return { id: options.id, enabled: options.enabled };
  }
  if (options.action === "cron_delete" || options.action === "cron_trigger") {
    return { id: options.id };
  }
  return { channel: options.channel };
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

async function addCronSchedule(paths: RuntimePaths, options: UiCronAddActionOptions, messages: string[]): Promise<void> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    const nextRunAt = computeNextRun(options.scheduleType, options.scheduleValue);
    const schedule = store.addCronSchedule({
      name: options.name,
      scheduleType: options.scheduleType,
      scheduleValue: options.scheduleValue,
      prompt: options.prompt,
      channel: options.channel?.trim() || undefined,
      enabled: options.enabled,
      nextRunAt,
    });
    messages.push(`Cron schedule ${schedule.id} created.`);
  } finally {
    store.close();
  }
}

async function updateCronSchedule(paths: RuntimePaths, options: UiCronUpdateActionOptions, messages: string[]): Promise<void> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    store.getCronSchedule(options.id);
    const nextRunAt = computeNextRun(options.scheduleType, options.scheduleValue);
    store.updateCronSchedule(options.id, {
      name: options.name,
      scheduleType: options.scheduleType,
      scheduleValue: options.scheduleValue,
      prompt: options.prompt,
      channel: options.channel?.trim() || undefined,
      enabled: options.enabled,
      nextRunAt,
    });
    messages.push(`Cron schedule ${options.id} updated.`);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : `Cron schedule not found: ${options.id}`);
  } finally {
    store.close();
  }
}

async function deleteCronSchedule(paths: RuntimePaths, id: number, messages: string[]): Promise<void> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    const removed = store.removeCronSchedule(id);
    if (!removed) throw new Error(`Cron schedule not found: ${id}`);
    messages.push(`Cron schedule ${id} deleted.`);
  } finally {
    store.close();
  }
}

async function triggerCronSchedule(paths: RuntimePaths, id: number, messages: string[]): Promise<void> {
  const config = await loadConfig(paths);
  const executor = new CronExecutor({ config, paths });
  await executor.runScheduleNow(id);
  messages.push(`Cron schedule ${id} triggered.`);
}

async function updateChannelAccess(paths: RuntimePaths, options: UiChannelAccessUpdateOptions, messages: string[]): Promise<void> {
  const config = await loadConfig(paths);
  const channelKey = options.channel === "zalo-personal" ? "zaloPersonal" : options.channel;
  const existing = config.channels?.[channelKey];
  if (!existing) throw new Error(`Channel ${options.channel} is not configured.`);
  const updated = {
    ...existing,
    ownerUserId: options.ownerUserIds,
    ...(options.adminUserIds?.length ? { adminUserIds: options.adminUserIds } : {}),
  };
  if (!options.adminUserIds?.length) delete updated.adminUserIds;
  await writeConfig({ ...config, channels: { ...config.channels, [channelKey]: updated } }, paths);
  messages.push(`Access roles for ${options.channel} updated.`);
}

export async function getUiChannelConfigSummary(paths: RuntimePaths = getRuntimePaths()): Promise<UiChannelConfigSummary> {
  const config = await loadConfig(paths);
  return { ok: true, channels: (["telegram", "zalo", "zalo-personal"] as const).map((id) => toUiChannelConfig(config, id)) };
}

export async function updateUiChannelConfig(options: { channel: UiChannelId; config: Record<string, unknown>; confirm: true; paths?: RuntimePaths }): Promise<UiChannelConfigSummary> {
  const paths = options.paths ?? getRuntimePaths();
  const config = await loadConfig(paths);
  const key = options.channel === "zalo-personal" ? "zaloPersonal" : options.channel;
  const existing = config.channels?.[key];
  const defaults = options.channel === "zalo-personal"
    ? { enabled: false, sessionEnv: "BESTIE_ZALO_PERSONAL_SESSION", ownerUserId: [] }
    : { enabled: false, botTokenEnv: options.channel === "telegram" ? "BESTIE_TELEGRAM_BOT_TOKEN" : "BESTIE_ZALO_BOT_TOKEN", ownerUserId: [] };
  const updated = mergeUiChannelConfig(existing ?? defaults, options.config);
  await writeConfig({ ...config, channels: { ...config.channels, [key]: updated } }, paths);
  return getUiChannelConfigSummary(paths);
}

function getChannelConfig(config: AppConfig, configKey: string): { enabled: boolean; ownerUserId: OwnerUserIdConfig; adminUserIds?: string[]; botTokenEnv?: string; sessionEnv?: string } | undefined {
  return config.channels?.[configKey as keyof NonNullable<AppConfig["channels"]>];
}

function toUiChannelConfig(config: AppConfig, id: UiChannelId): UiChannelConfig {
  const key = id === "zalo-personal" ? "zaloPersonal" : id;
  const channel = config.channels?.[key];
  const details = channel as (typeof channel & {
    pollingTimeoutSeconds?: number;
    voiceReplyPolicy?: "deny" | "voice-input-only";
    voiceReplyMaxChars?: number;
    voiceReplyCooldownMs?: number;
    reconnect?: { initialDelayMs?: number; maxDelayMs?: number };
  }) | undefined;
  const isPersonal = id === "zalo-personal";
  return {
    id,
    configured: Boolean(channel),
    enabled: channel?.enabled ?? false,
    ownerUserIds: channel ? (Array.isArray(channel.ownerUserId) ? channel.ownerUserId : [channel.ownerUserId]) : [],
    adminUserIds: channel?.adminUserIds ?? [],
    credentialEnv: channel ? ("sessionEnv" in channel ? channel.sessionEnv : channel.botTokenEnv) : (isPersonal ? "BESTIE_ZALO_PERSONAL_SESSION" : id === "telegram" ? "BESTIE_TELEGRAM_BOT_TOKEN" : "BESTIE_ZALO_BOT_TOKEN"),
    credentialLabel: isPersonal ? "Session env" : "Bot token env",
    ...(!isPersonal && id === "zalo" && details?.pollingTimeoutSeconds !== undefined ? { pollingTimeoutSeconds: details.pollingTimeoutSeconds } : {}),
    ...(!isPersonal && id === "telegram" && details?.voiceReplyPolicy !== undefined ? { voiceReplyPolicy: details.voiceReplyPolicy } : {}),
    ...(!isPersonal && id === "telegram" && details?.voiceReplyMaxChars !== undefined ? { voiceReplyMaxChars: details.voiceReplyMaxChars } : {}),
    ...(!isPersonal && id === "telegram" && details?.voiceReplyCooldownMs !== undefined ? { voiceReplyCooldownMs: details.voiceReplyCooldownMs } : {}),
    ...(isPersonal && details?.reconnect ? { reconnect: details.reconnect } : {}),
    attachments: channel?.attachments ?? {},
  };
}

function mergeUiChannelConfig(existing: Record<string, unknown>, update: Record<string, unknown>): Record<string, unknown> {
  const allowed = ["enabled", "ownerUserId", "adminUserIds", "botTokenEnv", "sessionEnv", "pollingTimeoutSeconds", "voiceReplyPolicy", "voiceReplyMaxChars", "voiceReplyCooldownMs"];
  const result: Record<string, unknown> = { ...existing };
  for (const key of allowed) {
    if (!(key in update)) continue;
    const value = update[key];
    if (value === null || value === "") delete result[key];
    else result[key] = value;
  }
  for (const nestedKey of ["reconnect", "attachments"] as const) {
    if (!update[nestedKey] || typeof update[nestedKey] !== "object" || Array.isArray(update[nestedKey])) continue;
    const current = result[nestedKey] && typeof result[nestedKey] === "object" && !Array.isArray(result[nestedKey]) ? result[nestedKey] as Record<string, unknown> : {};
    const nested = { ...current, ...(update[nestedKey] as Record<string, unknown>) };
    for (const [key, value] of Object.entries(nested)) if (value === null || value === "") delete nested[key];
    if (Object.keys(nested).length) result[nestedKey] = nested;
    else delete result[nestedKey];
  }
  return result;
}

async function getCronSummary(paths: RuntimePaths): Promise<UiChannelSummary["cron"]> {
  const databaseExists = await pathExists(paths.memoryDbPath);
  if (!databaseExists) {
    return { databaseExists: false, counts: { total: 0, enabled: 0, disabled: 0 }, schedules: [], logs: [] };
  }

  const store = await SqliteMemoryStore.open(paths);
  try {
    const schedules = store.listCronSchedules(20);
    const logs = store.listCronLogs(undefined, 20);
    const enabled = schedules.filter((schedule) => schedule.enabled).length;
    return {
      databaseExists: true,
      counts: { total: schedules.length, enabled, disabled: schedules.length - enabled },
      schedules: schedules.map(toUiCronSchedule),
      logs: logs.map(toUiCronLog),
    };
  } finally {
    store.close();
  }
}

function toUiCronLog(log: CronLog): UiCronLog {
  return {
    id: log.id,
    scheduleId: log.scheduleId,
    startedAt: log.startedAt,
    ...(log.finishedAt ? { finishedAt: log.finishedAt } : {}),
    ...(log.result ? { result: log.result } : {}),
    ...(log.output ? { output: log.output } : {}),
    ...(log.error ? { error: log.error } : {}),
  };
}

function toUiCronSchedule(schedule: CronSchedule): UiCronSchedule {
  return {
    id: schedule.id,
    name: schedule.name,
    scheduleType: schedule.scheduleType,
    scheduleValue: schedule.scheduleValue,
    prompt: schedule.prompt,
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
