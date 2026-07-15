import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { SqliteMemoryStore, type CronSchedule } from "../memory/sqlite-store.js";
import { TelegramHttpClient } from "../channels/telegram.js";
import { ZaloHttpClient } from "../channels/zalo.js";
import { parseCronReportDestination } from "./channel-commands.js";
import { loadEnvFile } from "../runtime/env.js";
import { appendLog } from "../runtime/logger.js";
import { runIsolatedChat } from "./isolated-chat.js";
import { computeNextRun } from "./scheduler.js";

const DEFAULT_TICK_INTERVAL_MS = 30_000;

const OUTPUT_TRUNCATE_MAX = 2_000;

export interface CronExecutorOptions {
  config: AppConfig;
  paths: RuntimePaths;
  apiKey?: string;
  tickIntervalMs?: number;
  notifier?: CronJobNotifier;
}

export interface CronJobNotification {
  job: CronSchedule;
  status: "ok" | "error";
  output?: string;
  error?: string;
}

export type CronJobNotifier = (notification: CronJobNotification) => Promise<void>;

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
      const nextRunAt = job.scheduleType === "once" ? "" : computeNextRun(job.scheduleType, job.scheduleValue);
      store.updateCronNextRun(job.id, nextRunAt);

      const output = await runIsolatedChat({
        config: this.options.config,
        paths: this.options.paths,
        apiKey: this.options.apiKey,
        prompt: job.prompt,
      });

      const truncatedOutput = output.length > OUTPUT_TRUNCATE_MAX ? output.slice(0, OUTPUT_TRUNCATE_MAX) + "..." : output;
      store.finishCronLog(logId, "ok", truncatedOutput);
      store.updateCronRunResult(job.id, "ok");
      await this.notifyJobResult({ job, status: "ok", output: truncatedOutput });

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
        sends.push(new TelegramHttpClient(token).sendMessage(chatId, message).then(() => undefined));
      }
    } else {
      const zalo = config.channels?.zalo;
      const token = zalo ? process.env[zalo.botTokenEnv] ?? envValues[zalo.botTokenEnv] : undefined;
      if (zalo?.enabled && token) {
        sends.push(new ZaloHttpClient(token).sendMessage(destination.userId, message).then(() => undefined));
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
      sends.push(new TelegramHttpClient(token).sendMessage(chatId, message).then(() => undefined));
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
      sends.push(new ZaloHttpClient(token).sendMessage(zalo.ownerUserId, message).then(() => undefined));
    }
  }

  await Promise.all(sends);
}

function formatCronJobNotification(config: AppConfig, notification: CronJobNotification): string {
  const header = notification.status === "ok" ? "Cron job succeeded" : "Cron job failed";
  const body = notification.status === "ok" ? notification.output?.trim() || "No output." : notification.error ?? "unknown error";
  return [`${config.agent.name}: ${header}`, `Job: ${notification.job.name}`, body].join("\n\n");
}
