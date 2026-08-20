export type DaemonChannel = "telegram" | "zalo" | "zalo-personal" | "cron";
export type ChannelId = "telegram" | "zalo" | "zalo-personal";
export type ChannelAction = "daemon_start" | "daemon_stop" | "daemon_restart" | "cron_toggle" | "cron_add" | "cron_update" | "cron_delete" | "cron_trigger" | "update_access";
export type CronScheduleType = "interval" | "cron_expr" | "once";

export interface ChannelSummary {
  ok: true;
  channels: ConfiguredChannel[];
  cron: { databaseExists: boolean; counts: { total: number; enabled: number; disabled: number }; schedules: CronSchedule[]; logs: CronLog[] };
  service: { supported: boolean; statusCommand: string };
}

export interface ConfiguredChannel {
  id: string;
  displayName: string;
  enabled: boolean;
  ownerConfigured: boolean;
  ownerUserIds?: string[];
  adminUserIds?: string[];
  tokenEnv?: string;
  secretPresent: boolean;
  daemon: { state: "running" | "stale" | "stopped"; pid?: number; logPath?: string };
  capabilities: Record<string, boolean>;
}

export interface AttachmentConfig {
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
}

export interface ChannelConfig {
  id: ChannelId;
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
  attachments: AttachmentConfig;
}

export interface ChannelConfigSummary { ok: true; channels: ChannelConfig[]; }

export interface CronSchedule {
  id: number;
  name: string;
  scheduleType: CronScheduleType;
  scheduleValue: string;
  prompt: string;
  channel?: string;
  enabled: boolean;
  nextRunAt: string;
  lastResult?: string;
  runCount: number;
}

export interface CronLog {
  id: number;
  scheduleId: number;
  startedAt: string;
  finishedAt?: string;
  result?: string;
  output?: string;
  error?: string;
}

export interface ChannelActionResult extends ChannelSummary { action: ChannelAction; channel?: DaemonChannel; id?: number; enabled?: boolean; messages: string[]; }
