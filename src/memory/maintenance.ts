import { isCronReportDestination } from "../cron/channel-commands.js";
import { computeNextRun, validateSchedule } from "../cron/scheduler.js";
import { runIsolatedChat, type IsolatedChatOptions } from "../cron/isolated-chat.js";
import { sendChatCompletionWithFallbacks } from "../llm/chat-completion.js";
import { loadLlmCandidateSecret, resolvePrimaryLlmCandidate } from "../llm/resolve-config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { refreshAllConversationSummaries, type ConversationSummaryChatCompletion, type ConversationSummaryRefreshReport } from "./conversation-summary.js";
import { SqliteMemoryStore, type CronSchedule } from "./sqlite-store.js";

export const MEMORY_MAINTENANCE_CRON_NAME = "Bestie memory maintenance report";
export const MEMORY_MAINTENANCE_DEFAULT_SCHEDULE = "0 9 * * 1";
export const MEMORY_MAINTENANCE_PROMPT = [
  "Run a read-only weekly memory hygiene digest and a memory tier rebalance check.",
  "Use internal.plan_memory_hygiene.",
  "Use internal.memory_hygiene_trend with limit 8 to report the recent score trend and whether the latest score improved, regressed, or stayed flat.",
  "Use internal.plan_memory_rebalance to check whether active memories are in the correct core/project/session scopes.",
  "Report deleteIds, reviewOnlyIds, duplicate groups, stale memories, conflicts, and rebalance recommendations as a concise maintenance plan.",
  "If memory.deletePolicy is allow and there are actionable rebalance recommendations (not review-only), apply them using internal.move_memory or by reporting that a manual /memory rebalance apply confirm is needed.",
  "Tell the owner to run bestie memory hygiene --apply --yes from CLI, or /memory hygiene apply confirm from Telegram/Zalo, only if they want to apply the planned deletion candidates.",
  "Tell the owner to run bestie memory rebalance --apply --yes from CLI, or /memory rebalance apply confirm from Telegram/Zalo, only if they want to apply the planned scope moves.",
  "Do not delete, edit, save, or supersede memories during this report.",
].join(" ");

export interface MemoryMaintenanceInstallOptions {
  paths?: RuntimePaths;
  channel?: string;
  scheduleValue?: string;
  timeZone?: string;
}

export type MemoryMaintenanceInstallResult =
  | { ok: true; schedule: CronSchedule }
  | { ok: false; reason: string };

export async function installMemoryMaintenanceReport(options: MemoryMaintenanceInstallOptions = {}): Promise<MemoryMaintenanceInstallResult> {
  const scheduleValue = options.scheduleValue ?? MEMORY_MAINTENANCE_DEFAULT_SCHEDULE;
  const timeZone = options.timeZone ?? "UTC";
  const scheduleError = validateSchedule("cron_expr", scheduleValue, timeZone);

  if (scheduleError) {
    return { ok: false, reason: `Invalid maintenance schedule: ${scheduleError}` };
  }

  if (options.channel !== undefined && !isCronReportDestination(options.channel)) {
    return { ok: false, reason: "Channel must be telegram:<userId> or zalo:<userId>." };
  }

  const store = await SqliteMemoryStore.open(options.paths);

  try {
    const existing = findMemoryMaintenanceSchedule(store.listCronSchedules());
    if (existing) {
      store.removeCronSchedule(existing.id);
    }

    const schedule = store.addCronSchedule({
      name: MEMORY_MAINTENANCE_CRON_NAME,
      scheduleType: "cron_expr",
      scheduleValue,
      prompt: MEMORY_MAINTENANCE_PROMPT,
      channel: options.channel,
      nextRunAt: computeNextRun("cron_expr", scheduleValue, undefined, timeZone),
    });

    return { ok: true, schedule };
  } finally {
    store.close();
  }
}

export async function getMemoryMaintenanceReportStatus(paths?: RuntimePaths): Promise<CronSchedule | undefined> {
  const store = await SqliteMemoryStore.open(paths);

  try {
    return findMemoryMaintenanceSchedule(store.listCronSchedules());
  } finally {
    store.close();
  }
}

export async function removeMemoryMaintenanceReport(paths?: RuntimePaths): Promise<CronSchedule | undefined> {
  const store = await SqliteMemoryStore.open(paths);

  try {
    const schedule = findMemoryMaintenanceSchedule(store.listCronSchedules());
    if (!schedule) {
      return undefined;
    }

    store.removeCronSchedule(schedule.id);
    return schedule;
  } finally {
    store.close();
  }
}

function findMemoryMaintenanceSchedule(schedules: CronSchedule[]): CronSchedule | undefined {
  return schedules.find((schedule) => schedule.name === MEMORY_MAINTENANCE_CRON_NAME);
}

export interface MemoryMaintenanceDigestResult {
  ok: boolean;
  output: string;
  reason?: string;
  conversationSummaryRefresh?: ConversationSummaryRefreshReport;
}

export async function runMemoryMaintenanceDigest(options: {
  config: IsolatedChatOptions["config"];
  paths: RuntimePaths;
  apiKey?: string;
  isolatedChat?: typeof runIsolatedChat;
  summaryChatCompletion?: ConversationSummaryChatCompletion;
  summaryRefreshLimit?: number;
}): Promise<MemoryMaintenanceDigestResult> {
  try {
    const apiKey = options.apiKey ?? await loadLlmCandidateSecret(resolvePrimaryLlmCandidate(options.config), options.paths);
    const conversationSummaryRefresh = await refreshMaintenanceConversationSummaries({
      config: options.config,
      paths: options.paths,
      apiKey,
      limit: options.summaryRefreshLimit,
      chatCompletion: options.summaryChatCompletion,
    });
    const output = await (options.isolatedChat ?? runIsolatedChat)({
      config: options.config,
      paths: options.paths,
      apiKey,
      prompt: MEMORY_MAINTENANCE_PROMPT,
    });

    return { ok: true, output: prependConversationSummaryRefresh(output, conversationSummaryRefresh), conversationSummaryRefresh };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { ok: false, output: "", reason: message };
  }
}

async function refreshMaintenanceConversationSummaries(options: {
  config: IsolatedChatOptions["config"];
  paths: RuntimePaths;
  apiKey: string;
  limit?: number;
  chatCompletion?: ConversationSummaryChatCompletion;
}): Promise<ConversationSummaryRefreshReport> {
  try {
    return await refreshAllConversationSummaries({
      config: options.config,
      paths: options.paths,
      apiKey: options.apiKey,
      limit: options.limit ?? 10,
      chatCompletion: options.chatCompletion ?? ((config, _apiKey, requestOptions) => sendChatCompletionWithFallbacks(config, requestOptions, { paths: options.paths })),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    return { paused: false, recentMessageLimit: 0, checked: 1, refreshed: 0, skipped: 0, failed: 1, items: [{ channel: "terminal", status: "failed", messageCount: 0, reason }] };
  }
}

function prependConversationSummaryRefresh(output: string, report: ConversationSummaryRefreshReport): string {
  const prefix = `Conversation summary refresh: checked ${report.checked}, refreshed ${report.refreshed}, skipped ${report.skipped}, failed ${report.failed}.`;
  return `${prefix}\n\n${output}`;
}
