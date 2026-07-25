import { getRecentMessageLimit } from "../chat/message-builder.js";
import type { ChatCompletionOptions, ChatMessage } from "../llm/types.js";
import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { SqliteMemoryStore, type StoredMessage, type UiChatMessage } from "./sqlite-store.js";

export type ConversationSummaryChannel = "terminal" | "telegram" | "zalo" | "ui";
export type ConversationSummaryChatCompletion = (config: AppConfig, apiKey: string, options: ChatCompletionOptions) => Promise<string>;
export type ConversationSummaryRefreshStatus = "refreshed" | "skipped" | "failed";

export interface ConversationSummaryRefreshItem {
  channel: ConversationSummaryChannel;
  userId?: string;
  status: ConversationSummaryRefreshStatus;
  messageCount: number;
  summarizedMessageId?: number;
  reason?: string;
}

export interface ConversationSummaryRefreshReport {
  paused: boolean;
  recentMessageLimit: number;
  checked: number;
  refreshed: number;
  skipped: number;
  failed: number;
  items: ConversationSummaryRefreshItem[];
}

const SUMMARY_CONTEXT_PREFIX = "Rolling summary of earlier conversation for continuity. Use it only as context; prefer the verbatim recent turns when they conflict. Do not claim perfect memory.";
const SUMMARY_MAX_CHARS = 4_000;

export async function loadConversationSummaryContext(paths: RuntimePaths, channel: ConversationSummaryChannel, userId?: string): Promise<ChatMessage[]> {
  const store = await SqliteMemoryStore.open(paths);

  try {
    if (store.getMemoryState().paused) {
      return [];
    }

    const summary = store.getConversationSummary(channel, userId);
    return summary?.content ? [{ role: "system", content: `${SUMMARY_CONTEXT_PREFIX}\n${summary.content}` }] : [];
  } finally {
    store.close();
  }
}

export async function refreshConversationSummary(options: {
  config: AppConfig;
  paths: RuntimePaths;
  apiKey: string;
  channel: ConversationSummaryChannel;
  userId?: string;
  chatCompletion: ConversationSummaryChatCompletion;
}): Promise<ConversationSummaryRefreshItem> {
  const store = await SqliteMemoryStore.open(options.paths);

  try {
    if (store.getMemoryState().paused) {
      return { channel: options.channel, userId: options.userId, status: "skipped", messageCount: 0, reason: "memory_paused" };
    }

    const recentMessageLimit = getRecentMessageLimit(options.config);
    const messages = store.listMessagesForChannel(options.channel, options.userId);
    if (messages.length <= recentMessageLimit) {
      return { channel: options.channel, userId: options.userId, status: "skipped", messageCount: messages.length, reason: "below_recent_window" };
    }

    return await refreshConversationSummaryFromMessages({
      store,
      config: options.config,
      apiKey: options.apiKey,
      channel: options.channel,
      userId: options.userId,
      messages,
      recentMessageLimit,
      chatCompletion: options.chatCompletion,
    });
  } finally {
    store.close();
  }
}

export async function refreshAllConversationSummaries(options: {
  config: AppConfig;
  paths: RuntimePaths;
  apiKey: string;
  channel?: ConversationSummaryChannel;
  userId?: string;
  limit?: number;
  chatCompletion: ConversationSummaryChatCompletion;
}): Promise<ConversationSummaryRefreshReport> {
  const store = await SqliteMemoryStore.open(options.paths);
  const recentMessageLimit = getRecentMessageLimit(options.config);

  try {
    if (store.getMemoryState().paused) {
      return emptyRefreshReport({ paused: true, recentMessageLimit });
    }

    const candidates = buildConversationSummaryRefreshCandidates(store, options.channel, options.userId, recentMessageLimit).slice(0, options.limit ?? 20);
    const items: ConversationSummaryRefreshItem[] = [];
    for (const candidate of candidates) {
      try {
        items.push(await refreshConversationSummaryFromMessages({
          store,
          config: options.config,
          apiKey: options.apiKey,
          channel: candidate.channel,
          userId: candidate.userId,
          messages: candidate.messages,
          recentMessageLimit,
          chatCompletion: options.chatCompletion,
        }));
      } catch (error) {
        items.push({
          channel: candidate.channel,
          userId: candidate.userId,
          status: "failed",
          messageCount: candidate.messages.length,
          reason: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }

    return summarizeRefreshItems({ paused: false, recentMessageLimit, items });
  } finally {
    store.close();
  }
}

export async function loadUiConversationSummaryContext(paths: RuntimePaths, sessionId: number): Promise<ChatMessage[]> {
  return loadConversationSummaryContext(paths, "ui", uiConversationSummaryUserId(sessionId));
}

export async function refreshUiConversationSummary(options: {
  config: AppConfig;
  paths: RuntimePaths;
  apiKey: string;
  sessionId: number;
  chatCompletion: ConversationSummaryChatCompletion;
}): Promise<ConversationSummaryRefreshItem> {
  const store = await SqliteMemoryStore.open(options.paths);

  try {
    if (store.getMemoryState().paused) {
      return { channel: "ui", userId: uiConversationSummaryUserId(options.sessionId), status: "skipped", messageCount: 0, reason: "memory_paused" };
    }

    const userId = uiConversationSummaryUserId(options.sessionId);
    const recentMessageLimit = getRecentMessageLimit(options.config);
    const messages = store.listUiChatMessages(options.sessionId, Number.MAX_SAFE_INTEGER).map(uiChatMessageToStoredMessage);
    if (messages.length <= recentMessageLimit) {
      return { channel: "ui", userId, status: "skipped", messageCount: messages.length, reason: "below_recent_window" };
    }

    return await refreshConversationSummaryFromMessages({
      store,
      config: options.config,
      apiKey: options.apiKey,
      channel: "ui",
      userId,
      messages,
      recentMessageLimit,
      chatCompletion: options.chatCompletion,
    });
  } finally {
    store.close();
  }
}

async function refreshConversationSummaryFromMessages(options: {
  store: SqliteMemoryStore;
  config: AppConfig;
  apiKey: string;
  channel: ConversationSummaryChannel;
  userId?: string;
  messages: StoredMessage[];
  recentMessageLimit: number;
  chatCompletion: ConversationSummaryChatCompletion;
}): Promise<ConversationSummaryRefreshItem> {
  const summarizedMessages = options.messages.slice(0, -options.recentMessageLimit);
  const lastSummarizedMessageId = summarizedMessages.at(-1)?.id;
  if (lastSummarizedMessageId === undefined) {
    return { channel: options.channel, userId: options.userId, status: "skipped", messageCount: options.messages.length, reason: "nothing_to_summarize" };
  }

  const existing = options.store.getConversationSummary(options.channel, options.userId);
  const newMessages = summarizedMessages.filter((message) => message.id > (existing?.summarizedMessageId ?? 0));
  if (newMessages.length === 0) {
    return { channel: options.channel, userId: options.userId, status: "skipped", messageCount: options.messages.length, summarizedMessageId: existing?.summarizedMessageId, reason: "up_to_date" };
  }

  const response = await options.chatCompletion(options.config, options.apiKey, {
    messages: buildConversationSummaryMessages({ existingSummary: existing?.content, messages: newMessages }),
  });
  const summary = normalizeSummary(parseSummaryResponse(response));
  if (!summary) {
    return { channel: options.channel, userId: options.userId, status: "skipped", messageCount: options.messages.length, summarizedMessageId: existing?.summarizedMessageId, reason: "empty_summary" };
  }

  options.store.upsertConversationSummary({ channel: options.channel, userId: options.userId, content: summary, summarizedMessageId: lastSummarizedMessageId });
  return { channel: options.channel, userId: options.userId, status: "refreshed", messageCount: options.messages.length, summarizedMessageId: lastSummarizedMessageId };
}

function buildConversationSummaryRefreshCandidates(store: SqliteMemoryStore, channel: ConversationSummaryChannel | undefined, userId: string | undefined, recentMessageLimit: number): Array<{ channel: ConversationSummaryChannel; userId?: string; messages: StoredMessage[]; summarizeThrough: number }> {
  const candidates = [
    ...buildStoredMessageRefreshCandidates(store, channel, userId, recentMessageLimit),
    ...buildUiRefreshCandidates(store, channel, userId, recentMessageLimit),
  ];

  return candidates.sort((left, right) => right.messages.length - left.messages.length || left.summarizeThrough - right.summarizeThrough);
}

function buildStoredMessageRefreshCandidates(store: SqliteMemoryStore, channel: ConversationSummaryChannel | undefined, userId: string | undefined, recentMessageLimit: number): Array<{ channel: ConversationSummaryChannel; userId?: string; messages: StoredMessage[]; summarizeThrough: number }> {
  const allowedChannels = new Set<ConversationSummaryChannel>(["terminal", "telegram", "zalo"]);
  const groups = new Map<string, { channel: ConversationSummaryChannel; userId?: string; messages: StoredMessage[] }>();

  for (const message of store.listAllMessages()) {
    if (!message.channel || !allowedChannels.has(message.channel as ConversationSummaryChannel)) {
      continue;
    }
    const messageChannel = message.channel as ConversationSummaryChannel;
    if (channel !== undefined && messageChannel !== channel) {
      continue;
    }
    if (userId !== undefined && (message.userId ?? "") !== userId) {
      continue;
    }
    const key = `${messageChannel}:${message.userId ?? ""}`;
    const group = groups.get(key) ?? { channel: messageChannel, userId: message.userId, messages: [] };
    group.messages.push(message);
    groups.set(key, group);
  }

  return [...groups.values()].flatMap((group) => refreshCandidateForMessages(store, group.channel, group.userId, group.messages, recentMessageLimit));
}

function buildUiRefreshCandidates(store: SqliteMemoryStore, channel: ConversationSummaryChannel | undefined, userId: string | undefined, recentMessageLimit: number): Array<{ channel: ConversationSummaryChannel; userId?: string; messages: StoredMessage[]; summarizeThrough: number }> {
  if (channel !== undefined && channel !== "ui") {
    return [];
  }

  return store.listUiChatSessions(10_000).flatMap((session) => {
    const summaryUserId = uiConversationSummaryUserId(session.id);
    if (userId !== undefined && userId !== summaryUserId) {
      return [];
    }
    const messages = store.listUiChatMessages(session.id, Number.MAX_SAFE_INTEGER).map(uiChatMessageToStoredMessage);
    return refreshCandidateForMessages(store, "ui", summaryUserId, messages, recentMessageLimit);
  });
}

function refreshCandidateForMessages(store: SqliteMemoryStore, channel: ConversationSummaryChannel, userId: string | undefined, messages: StoredMessage[], recentMessageLimit: number): Array<{ channel: ConversationSummaryChannel; userId?: string; messages: StoredMessage[]; summarizeThrough: number }> {
  if (messages.length <= recentMessageLimit) {
    return [];
  }

  const summarizeThrough = messages.at(-recentMessageLimit - 1)?.id ?? 0;
  const existing = store.getConversationSummary(channel, userId);
  if (summarizeThrough <= 0 || (existing && existing.summarizedMessageId >= summarizeThrough)) {
    return [];
  }

  return [{ channel, userId, messages, summarizeThrough }];
}

function emptyRefreshReport(input: { paused: boolean; recentMessageLimit: number }): ConversationSummaryRefreshReport {
  return { paused: input.paused, recentMessageLimit: input.recentMessageLimit, checked: 0, refreshed: 0, skipped: 0, failed: 0, items: [] };
}

function summarizeRefreshItems(input: { paused: boolean; recentMessageLimit: number; items: ConversationSummaryRefreshItem[] }): ConversationSummaryRefreshReport {
  return {
    paused: input.paused,
    recentMessageLimit: input.recentMessageLimit,
    checked: input.items.length,
    refreshed: input.items.filter((item) => item.status === "refreshed").length,
    skipped: input.items.filter((item) => item.status === "skipped").length,
    failed: input.items.filter((item) => item.status === "failed").length,
    items: input.items,
  };
}

function buildConversationSummaryMessages(input: { existingSummary?: string; messages: StoredMessage[] }): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are Bestie's conversation summary pass.",
        "Update the rolling summary of earlier conversation for continuity across long chats.",
        "Keep stable context, unresolved threads, user preferences, decisions, names, and references needed to understand later messages.",
        "Do not store secrets, tokens, passwords, payment data, or raw private credentials; mention only that sensitive data was shared if needed.",
        `Keep the summary under ${SUMMARY_MAX_CHARS} characters.`,
        "Return only JSON: {\"summary\":\"...\"}.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        input.existingSummary ? `Existing summary:\n${input.existingSummary}` : "Existing summary: (none)",
        "New older turns to fold in:",
        ...input.messages.map((message) => `${message.role}: ${message.content}`),
      ].join("\n\n"),
    },
  ];
}

function uiConversationSummaryUserId(sessionId: number): string {
  return `session:${sessionId}`;
}

function uiChatMessageToStoredMessage(message: UiChatMessage): StoredMessage {
  return {
    id: message.id,
    channel: "ui",
    userId: uiConversationSummaryUserId(message.sessionId),
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  };
}

function parseSummaryResponse(text: string): string {
  const rawJson = extractJsonObject(text.trim());
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      if (isRecord(parsed) && typeof parsed.summary === "string") {
        return parsed.summary;
      }
    } catch {
      // Fall through to using the raw text; summary refresh is best-effort.
    }
  }

  return text;
}

function normalizeSummary(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, SUMMARY_MAX_CHARS).trim();
}

function extractJsonObject(text: string): string | undefined {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const value = fenced?.[1]?.trim() ?? text;
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  return start === -1 || end === -1 || end <= start ? undefined : value.slice(start, end + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
