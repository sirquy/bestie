import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { SqliteMemoryStore, type CronSchedule } from "../memory/sqlite-store.js";
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
}

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

      appendLog(
        { event: "cron_job_failure", detail: { scheduleId: job.id, name: job.name, error: message } },
        { paths: this.options.paths },
      );
    } finally {
      store.close();
    }
  }
}
