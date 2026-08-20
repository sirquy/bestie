export type DaemonChannel = "telegram" | "zalo" | "cron";
export type ChannelAction = "daemon_start" | "daemon_stop" | "daemon_restart" | "cron_toggle" | "cron_add" | "cron_update" | "cron_delete" | "cron_trigger" | "update_access";
export type CronScheduleType = "interval" | "cron_expr" | "once";

export interface ChannelSummary {
  ok: true;
  channels: ConfiguredChannel[];
  cron: {
    databaseExists: boolean;
    counts: {
      total: number;
      enabled: number;
      disabled: number;
    };
    schedules: CronSchedule[];
    logs: CronLog[];
  };
  service: {
    supported: boolean;
    statusCommand: string;
  };
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
  daemon: {
    state: "running" | "stale" | "stopped";
    pid?: number;
    logPath?: string;
  };
  capabilities: Record<string, boolean>;
}

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

export interface ChannelActionResult extends ChannelSummary {
  action: ChannelAction;
  channel?: DaemonChannel;
  id?: number;
  enabled?: boolean;
  messages: string[];
}
