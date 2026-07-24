import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { SqliteMemoryStore, type CronSchedule } from "../memory/sqlite-store.js";
import { splitTelegramMessageText, TelegramHttpClient } from "../channels/telegram.js";
import { splitZaloMessageText, ZaloHttpClient } from "../channels/zalo.js";
import { parseCronReportDestination } from "./channel-commands.js";
import { loadEnvFile } from "../runtime/env.js";
import { appendLog } from "../runtime/logger.js";
import { runIsolatedChat } from "./isolated-chat.js";
import { computeNextRun } from "./scheduler.js";

const DEFAULT_TICK_INTERVAL_MS = 30_000;

const MEMORY_HYGIENE_ALERT_STATE_KEY = "memory_hygiene_regression_alert_snapshot_id";
const MEMORY_HYGIENE_SCORE_ALERT_THRESHOLD = 60;

export interface CronExecutorOptions {
  config: AppConfig;
  paths: RuntimePaths;
  apiKey?: string;
  tickIntervalMs?: number;
  notifier?: CronJobNotifier;
  alertNotifier?: CronAlertNotifier;
  isolatedChatRunner?: typeof runIsolatedChat;
}

export interface CronJobNotification {
  job: CronSchedule;
  status: "ok" | "error";
  output?: string;
  error?: string;
}

export type CronJobNotifier = (notification: CronJobNotification) => Promise<void>;

export interface CronAlertNotification {
  kind: "memory_hygiene_regression";
  message: string;
  latestSnapshotId: number;
}

export type CronAlertNotifier = (notification: CronAlertNotification) => Promise<void>;

export class CronExecutor {
  private timer?: ReturnType<typeof setInterval>;
  private running = new Set<number>();
  private readonly tickIntervalMs: number;

  constructor(private readonly options: CronExecutorOptions) {
    this.tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  }

  start(): void {
    this.tick();
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        appendLog(
          { event: "cron_tick_error", detail: { message: error instanceof Error ? error.message : "unknown error" } },
          { paths: this.options.paths },
        );
      });
    }, this.tickIntervalMs);
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  isRunning(): boolean {
    return this.timer !== undefined;
  }

  async tick(): Promise<void> {
    const store = await SqliteMemoryStore.open(this.options.paths);

    try {
      await this.checkMemoryHygieneRegression(store);
      const now = new Date().toISOString();
      const dueJobs = store.listDueCronJobs(now);

      const pendingJobs: Promise<void>[] = [];

      for (const job of dueJobs) {
        if (this.running.has(job.id)) {
          continue;
        }

        this.running.add(job.id);
        const jobPromise = this.executeJob(job).finally(() => this.running.delete(job.id));
        pendingJobs.push(jobPromise);
      }

      await Promise.allSettled(pendingJobs);
    } finally {
      store.close();
    }
  }

  async runScheduleNow(id: number): Promise<void> {
    const store = await SqliteMemoryStore.open(this.options.paths);
    let job: CronSchedule;

    try {
      job = store.getCronSchedule(id);
    } finally {
      store.close();
    }

    await this.executeJob(job);
  }

  private async executeJob(job: CronSchedule): Promise<void> {
    const store = await SqliteMemoryStore.open(this.options.paths);
    let logId: number | undefined;

    try {
      const log = store.createCronLog(job.id);
      logId = log.id;

      appendLog(
        { event: "cron_job_start", detail: { scheduleId: job.id, name: job.name, prompt: job.prompt.slice(0, 100) } },
        { paths: this.options.paths },
      );

      // Compute next run before execution (handles one-shot by setting empty)
      const nextRunAt = job.scheduleType === "once" ? "" : computeNextRun(job.scheduleType, job.scheduleValue, undefined, this.options.config.agent.timeZone);
      store.updateCronNextRun(job.id, nextRunAt);

      const output = await (this.options.isolatedChatRunner ?? runIsolatedChat)({
        config: this.options.config,
        paths: this.options.paths,
        apiKey: this.options.apiKey,
        prompt: job.prompt,
      });

      store.finishCronLog(logId, "ok", output);
      store.updateCronRunResult(job.id, "ok");
      await this.notifyJobResult({ job, status: "ok", output });

      appendLog(
        { event: "cron_job_success", detail: { scheduleId: job.id, name: job.name, outputLength: output.length } },
        { paths: this.options.paths },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      if (logId !== undefined) {
        store.finishCronLog(logId, "error", undefined, message);
      }
      store.updateCronRunResult(job.id, "error", message);
      await this.notifyJobResult({ job, status: "error", error: message });

      appendLog(
        { event: "cron_job_failure", detail: { scheduleId: job.id, name: job.name, error: message } },
        { paths: this.options.paths },
      );
    } finally {
      store.close();
    }
  }

  private async notifyJobResult(notification: CronJobNotification): Promise<void> {
    const notifier = this.options.notifier ?? ((result) => notifyConfiguredChannels(this.options.config, this.options.paths, result));
    try {
      await notifier(notification);
    } catch (error) {
      appendLog(
        { event: "cron_notification_failure", detail: { scheduleId: notification.job.id, name: notification.job.name, error: error instanceof Error ? error.message : "unknown error" } },
        { paths: this.options.paths },
      );
    }
  }

  private async checkMemoryHygieneRegression(store: SqliteMemoryStore): Promise<void> {
    const snapshots = store.listMemoryHygieneSnapshots(3);
    const latest = snapshots[0];
    if (!latest) {
      return;
    }

    if (store.getMemoryStateValue(MEMORY_HYGIENE_ALERT_STATE_KEY) === String(latest.id)) {
      return;
    }

    const previous = snapshots[1];
    const earlier = snapshots[2];
    const belowThreshold = latest.score < MEMORY_HYGIENE_SCORE_ALERT_THRESHOLD;
    const consecutiveDrop = Boolean(previous && earlier && latest.score < previous.score && previous.score < earlier.score);
    if (!belowThreshold && !consecutiveDrop) {
      return;
    }

    const reason = belowThreshold
      ? `score is ${latest.score}/100 (${latest.label})`
      : `score dropped consecutively: ${earlier?.score}/100 -> ${previous?.score}/100 -> ${latest.score}/100`;
    const message = [
      `${this.options.config.agent.name}: Memory hygiene regression alert`,
      reason,
      "Run `bestie memory hygiene status` or `/memory hygiene status` to inspect the cleanup plan.",
    ].join("\n\n");

    await this.notifyAlert({ kind: "memory_hygiene_regression", message, latestSnapshotId: latest.id });
    store.setMemoryStateValue(MEMORY_HYGIENE_ALERT_STATE_KEY, String(latest.id));
  }

  private async notifyAlert(notification: CronAlertNotification): Promise<void> {
    const notifier = this.options.alertNotifier ?? ((alert) => notifyConfiguredAlertChannels(this.options.config, this.options.paths, alert));
    try {
      await notifier(notification);
    } catch (error) {
      appendLog(
        { event: "cron_alert_failure", detail: { kind: notification.kind, error: error instanceof Error ? error.message : "unknown error" } },
        { paths: this.options.paths },
      );
    }
  }
}

async function notifyConfiguredAlertChannels(config: AppConfig, paths: RuntimePaths, notification: CronAlertNotification): Promise<void> {
  const envValues = await loadEnvFile(paths);
  const sends: Promise<void>[] = [];

  const telegram = config.channels?.telegram;
  if (telegram?.enabled && telegram.ownerUserId.trim()) {
    const token = process.env[telegram.botTokenEnv] ?? envValues[telegram.botTokenEnv];
    const chatId = Number(telegram.ownerUserId);
    if (token && Number.isSafeInteger(chatId)) {
      sends.push(new TelegramHttpClient(token).sendMessage(chatId, notification.message).then(() => undefined));
    }
  }

  const zalo = config.channels?.zalo;
  if (zalo?.enabled && zalo.ownerUserId.trim()) {
    const token = process.env[zalo.botTokenEnv] ?? envValues[zalo.botTokenEnv];
    if (token) {
      sends.push(new ZaloHttpClient(token).sendMessage(zalo.ownerUserId, notification.message).then(() => undefined));
    }
  }

  await Promise.all(sends);
  if (sends.length > 0) {
    await appendLog(
      { event: "cron_alert_success", detail: { kind: notification.kind, latestSnapshotId: notification.latestSnapshotId } },
      { paths },
    );
  }
}

async function notifyConfiguredChannels(config: AppConfig, paths: RuntimePaths, notification: CronJobNotification): Promise<void> {
  const envValues = await loadEnvFile(paths);
  const message = formatCronJobNotification(config, notification);
  const sends: Promise<void>[] = [];
  const destination = parseCronReportDestination(notification.job.channel);

  if (destination) {
    if (destination.channel === "telegram") {
      const telegram = config.channels?.telegram;
      const token = telegram ? process.env[telegram.botTokenEnv] ?? envValues[telegram.botTokenEnv] : undefined;
      const chatId = Number(destination.userId);
      if (telegram?.enabled && token && Number.isSafeInteger(chatId)) {
        sends.push(sendTelegramCronReport(new TelegramHttpClient(token), chatId, message));
      } else if (telegram?.enabled && token) {
        await appendLog(
          { event: "cron_notification_skipped", detail: { channel: "telegram", reason: "numeric_chat_id_required", scheduleId: notification.job.id, destination: notification.job.channel } },
          { paths },
        );
      }
    } else {
      const zalo = config.channels?.zalo;
      const token = zalo ? process.env[zalo.botTokenEnv] ?? envValues[zalo.botTokenEnv] : undefined;
      if (zalo?.enabled && token) {
        sends.push(sendZaloCronReport(new ZaloHttpClient(token), destination.userId, message));
      }
    }

    await Promise.all(sends);
    return;
  }

  const telegram = config.channels?.telegram;
  if (telegram?.enabled && telegram.ownerUserId.trim()) {
    const token = process.env[telegram.botTokenEnv] ?? envValues[telegram.botTokenEnv];
    const chatId = Number(telegram.ownerUserId);
    if (token && Number.isSafeInteger(chatId)) {
      sends.push(sendTelegramCronReport(new TelegramHttpClient(token), chatId, message));
    } else if (token) {
      await appendLog(
        { event: "cron_notification_skipped", detail: { channel: "telegram", reason: "numeric_chat_id_required", scheduleId: notification.job.id, ownerUserId: telegram.ownerUserId } },
        { paths },
      );
    }
  }

  const zalo = config.channels?.zalo;
  if (zalo?.enabled && zalo.ownerUserId.trim()) {
    const token = process.env[zalo.botTokenEnv] ?? envValues[zalo.botTokenEnv];
    if (token) {
      sends.push(sendZaloCronReport(new ZaloHttpClient(token), zalo.ownerUserId, message));
    }
  }

  await Promise.all(sends);
  if (sends.length > 0) {
    await appendLog(
      { event: "cron_notification_success", detail: { scheduleId: notification.job.id, name: notification.job.name, channel: notification.job.channel ?? "configured" } },
      { paths },
    );
  }
}

async function sendTelegramCronReport(client: TelegramHttpClient, chatId: number, message: string): Promise<void> {
  for (const chunk of splitTelegramMessageText(message)) {
    await client.sendMessage(chatId, chunk);
  }
}

async function sendZaloCronReport(client: ZaloHttpClient, chatId: string, message: string): Promise<void> {
  for (const chunk of splitZaloMessageText(message)) {
    await client.sendMessage(chatId, chunk);
  }
}

function formatCronJobNotification(config: AppConfig, notification: CronJobNotification): string {
  const header = notification.status === "ok" ? "Cron job succeeded" : "Cron job failed";
  const body = notification.status === "ok" ? notification.output?.trim() || "No output." : notification.error ?? "unknown error";
  return [`${config.agent.name}: ${header}`, `Job: ${notification.job.name}`, body].join("\n\n");
}
