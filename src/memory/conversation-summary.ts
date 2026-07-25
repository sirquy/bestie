import { MAX_RECENT_TURNS } from "../chat/message-builder.js";
import type { ChatCompletionOptions, ChatMessage } from "../llm/types.js";
import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { SqliteMemoryStore, type StoredMessage } from "./sqlite-store.js";

export type ConversationSummaryChannel = "terminal" | "telegram" | "zalo";
export type ConversationSummaryChatCompletion = (config: AppConfig, apiKey: string, options: ChatCompletionOptions) => Promise<string>;

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
}): Promise<void> {
  const store = await SqliteMemoryStore.open(options.paths);

  try {
    if (store.getMemoryState().paused) {
      return;
    }

    const messages = store.listMessagesForChannel(options.channel, options.userId);
    if (messages.length <= MAX_RECENT_TURNS) {
      return;
    }

    const summarizedMessages = messages.slice(0, -MAX_RECENT_TURNS);
    const lastSummarizedMessageId = summarizedMessages.at(-1)?.id;
    if (lastSummarizedMessageId === undefined) {
      return;
    }

    const existing = store.getConversationSummary(options.channel, options.userId);
    const newMessages = summarizedMessages.filter((message) => message.id > (existing?.summarizedMessageId ?? 0));
    if (newMessages.length === 0) {
      return;
    }

    const response = await options.chatCompletion(options.config, options.apiKey, {
      messages: buildConversationSummaryMessages({ existingSummary: existing?.content, messages: newMessages }),
    });
    const summary = normalizeSummary(parseSummaryResponse(response));
    if (!summary) {
      return;
    }

    store.upsertConversationSummary({ channel: options.channel, userId: options.userId, content: summary, summarizedMessageId: lastSummarizedMessageId });
  } finally {
    store.close();
  }
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
