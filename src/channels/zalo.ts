import { loadSystemPrompt } from "../character/prompt-loader.js";
import { buildChatMessages } from "../chat/message-builder.js";
import { buildMcpToolSystemPrompt, completeWithAgentTools, runAgentToolRequest, type AgentToolActivity } from "../chat/mcp-tool-use.js";
import { fallbackLogDetail, formatProviderFallbackDiagnostics, formatProviderFallbackHealth } from "../llm/fallbacks.js";
import { ProviderAuthError, ProviderFallbackError, ProviderNetworkError, ProviderRateLimitError, ProviderResponseError, ProviderTimeoutError } from "../llm/errors.js";
import { sendChatCompletionWithFallbacks } from "../llm/openai-compatible.js";
import type { ChatCompletionOptions, ChatMessage } from "../llm/types.js";
import { runMemoryReasoningPass, type MemoryReasoningResult } from "../memory/reasoning.js";
import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import type { AppConfig } from "../runtime/config.js";
import { loadRequiredSecret } from "../runtime/env.js";
import { appendLog, redactSecrets } from "../runtime/logger.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { executeApprovedAction } from "../safety/approval-executor.js";
import { handleCronChannelCommand } from "../cron/channel-commands.js";
import type { PermissionApprover, PermissionPolicy } from "../safety/permission-policy.js";
import type { ChannelIncomingMessage, ChannelOutboundAdapter, ChannelRuntimeAdapter } from "./adapter.js";
import { createChannelActivityController } from "./activity.js";
import { ZALO_CHANNEL, formatChannelHelpCommands } from "./registry.js";
import { createChannelResponseController } from "./response-controller.js";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";
const ZALO_MESSAGE_MAX_CHARS = 2_000;
const ZALO_POLLING_TIMEOUT_SECONDS = 25;
const ZALO_TOOL_PROGRESS_EVERY = 3;
const ZALO_ACTION_APPROVAL_TTL_MS = 30 * 60 * 1000;
const ZALO_PERMISSION_POLICY: PermissionPolicy = {
  allowTrustedRead: true,
  allowLocalWrite: false,
};

export type ZaloUpdateResult = "ignored" | "replied";
export type ZaloChatCompletionRunner = (config: AppConfig, apiKeyValue: string, options: ChatCompletionOptions) => Promise<string>;

export interface ZaloUser {
  id: string;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface ZaloChat {
  id: string;
  type?: string;
}

export interface ZaloMessage {
  message_id?: string | number;
  messageId?: string | number;
  from?: ZaloUser;
  sender?: ZaloUser;
  user?: ZaloUser;
  chat?: ZaloChat;
  recipient?: ZaloChat;
  conversation?: ZaloChat;
  user_id?: string | number;
  uid?: string | number;
  sender_id?: string | number;
  from_id?: string | number;
  chat_id?: string | number;
  text?: string | { text?: string };
  caption?: string;
  [key: string]: unknown;
}

export interface ZaloUpdate {
  update_id: number;
  message?: ZaloMessage;
  [key: string]: unknown;
}

export interface ZaloClient {
  getMe?(): Promise<ZaloUser>;
  getUpdates(offset: number | undefined, timeoutSeconds: number): Promise<ZaloUpdate[]>;
  sendMessage(chatId: string, text: string): Promise<ZaloSentMessage | void>;
  sendChatAction(chatId: string, action: "typing"): Promise<void>;
}

export interface ZaloSentMessage {
  messageId?: string | number;
}

export interface ZaloHttpClientOptions {
  captureGetUpdatesShape?: (shape: Record<string, unknown>) => Promise<void> | void;
}

export interface ZaloPollingOptions extends ZaloUpdateHandlerOptions {
  once?: boolean;
  shouldStop?: () => boolean;
  onIdle?: () => Promise<void> | void;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
}

export interface ZaloUpdateHandlerOptions {
  config: AppConfig;
  paths: RuntimePaths;
  client: ZaloClient;
  chatCompletion?: ZaloChatCompletionRunner;
}

export class ZaloHttpClient implements ZaloClient {
  constructor(private readonly botToken: string, private readonly fetchImpl: typeof fetch = fetch, private readonly options: ZaloHttpClientOptions = {}) {}

  async getMe(): Promise<ZaloUser> {
    return this.call<ZaloUser>("getMe", {});
  }

  async getUpdates(offset: number | undefined, timeoutSeconds: number): Promise<ZaloUpdate[]> {
    const result = await this.call<unknown>("getUpdates", { ...(offset === undefined ? {} : { offset }), timeout: timeoutSeconds });
    await this.options.captureGetUpdatesShape?.(summarizeZaloPayloadShape(result));
    return normalizeZaloUpdatesResult(result);
  }

  async sendMessage(chatId: string, text: string): Promise<ZaloSentMessage | void> {
    return this.call<ZaloSentMessage | void>("sendMessage", { chat_id: chatId, text });
  }

  async sendChatAction(chatId: string, action: "typing"): Promise<void> {
    await this.call<void>("sendChatAction", { chat_id: chatId, action });
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(`${ZALO_API_BASE_URL}/bot${this.botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await readJsonResponse(response);

    if (method === "getUpdates" && payload.ok === false && Number(payload.error_code) === 408) {
      return [] as T;
    }

    if (!response.ok || payload.ok === false) {
      const detail = typeof payload.description === "string" ? payload.description : response.statusText;
      const code = typeof payload.error_code === "number" ? ` (${payload.error_code})` : "";
      throw new Error(`Zalo ${method} failed${code}: ${redactSecrets(detail)}`);
    }

    return payload.result as T;
  }
}

export function summarizeZaloPayloadShape(value: unknown, depth = 0): Record<string, unknown> {
  if (value === null) {
    return { type: "null" };
  }

  if (Array.isArray(value)) {
    return { type: "array", length: value.length, sample: value.length > 0 && depth < 3 ? summarizeZaloPayloadShape(value[0], depth + 1) : undefined };
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return {
      type: "object",
      keys: entries.map(([key]) => key).slice(0, 50),
      fields: depth < 3 ? Object.fromEntries(entries.slice(0, 20).map(([key, fieldValue]) => [key, summarizeZaloPayloadShape(fieldValue, depth + 1)])) : undefined,
    };
  }

  if (typeof value === "string") {
    return { type: "string", length: value.length };
  }

  return { type: typeof value };
}

export async function runZaloPollingLoop(options: ZaloPollingOptions): Promise<void> {
  let offset: number | undefined;
  let consecutiveFailures = 0;
  const retryDelayMs = options.retryDelayMs ?? 1_000;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 30_000;
  const timeoutSeconds = options.config.channels?.zalo?.pollingTimeoutSeconds ?? ZALO_POLLING_TIMEOUT_SECONDS;

  do {
    let updates: ZaloUpdate[];

    try {
      updates = await options.client.getUpdates(offset, timeoutSeconds);
    } catch (error) {
      consecutiveFailures += 1;
      const delayMs = Math.min(retryDelayMs * 2 ** (consecutiveFailures - 1), maxRetryDelayMs);
      const message = error instanceof Error ? error.message : "Unknown Zalo polling error.";
      await appendLog({ event: "zalo_polling_failure", detail: { message, consecutiveFailures, retryDelayMs: delayMs } }, { paths: options.paths });

      if (options.once) {
        throw error;
      }

      await sleep(delayMs);
      await options.onIdle?.();
      continue;
    }

    if (consecutiveFailures > 0) {
      await appendLog({ event: "zalo_polling_recovered", detail: { consecutiveFailures } }, { paths: options.paths });
      consecutiveFailures = 0;
    }

    for (const update of updates) {
      await handleZaloUpdate(update, options);
      offset = update.update_id + 1;
    }

    if (options.once) {
      return;
    }

    await options.onIdle?.();
  } while (!options.shouldStop?.());
}

export async function handleZaloUpdate(update: ZaloUpdate, options: ZaloUpdateHandlerOptions): Promise<ZaloUpdateResult> {
  const zaloConfig = options.config.channels?.zalo;
  const message = update.message;
  const incoming = message ? mapZaloIncomingMessage(message) : undefined;
  const text = (incoming?.text ?? incoming?.caption ?? "").trim();

  if (!zaloConfig?.enabled || !incoming || !zaloConfig.ownerUserId || incoming.senderId !== zaloConfig.ownerUserId) {
    return "ignored";
  }

  await sendZaloChatActionBestEffort(options.client, incoming.chatId, "typing");

  if (!text) {
    await options.client.sendMessage(incoming.chatId, `${options.config.agent.name} received this Zalo message type, but this first version only supports text.`);
    return "replied";
  }

  if (text === "/help") {
    await options.client.sendMessage(incoming.chatId, formatChannelHelpCommands(ZALO_CHANNEL));
    return "replied";
  }

  if (await handleZaloSlashCommand(text, incoming.chatId, options)) {
    return "replied";
  }

  if (text.startsWith("/")) {
    await options.client.sendMessage(incoming.chatId, `Unknown command: ${text}. Try /help.`);
    return "replied";
  }

  const chatCompletion = options.chatCompletion ?? ((config, _apiKeyValue, requestOptions) => sendChatCompletionWithFallbacks(config, { ...requestOptions, stream: requestOptions.stream ?? true }, { paths: options.paths }));
  const apiKey = await loadRequiredSecret(options.config.llm.apiKeyEnv, options.paths);
  const adapter = createZaloRuntimeAdapter(options.client);
  const typing = createChannelActivityController(adapter.outbound.createActivityOptions(incoming.chatId, "typing"));
  typing.start();

  try {
    const systemPrompt = await loadSystemPrompt(options.paths);
    const memories = await loadActiveMemories(options.paths);
    const recentTurns = await loadRecentZaloTurns(options.paths, zaloConfig.ownerUserId);
    const runtimeContext = buildZaloRuntimeToolContext(incoming, zaloConfig.ownerUserId);
    const messages = buildChatMessages(buildMcpToolSystemPrompt(systemPrompt, options.config, runtimeContext), recentTurns, text, memories);
    const response = createChannelResponseController(adapter.outbound.createResponseAdapter(incoming.chatId));
    const assistantText = await completeWithAgentTools({
      config: options.config,
      paths: options.paths,
      apiKey,
      messages,
      chatCompletion,
      toolRunner: runAgentToolRequest,
      approver: createZaloPermissionApprover(options.client, incoming.chatId, options.paths),
      policy: ZALO_PERMISSION_POLICY,
      streamFinalResponse: true,
      onToolActivity: async (activity) => handleZaloToolActivity(response, activity, options.config.agent.name),
      runtimeContext,
    });
    typing.stop();
    await response.replyFinal(assistantText);
    await persistZaloConversationTurn(options.paths, zaloConfig.ownerUserId, text, assistantText);
    const memoryReasoning = await runZaloMemoryReasoningPass({ config: options.config, paths: options.paths, apiKey, turn: { channel: "zalo", userId: zaloConfig.ownerUserId, userInput: text, assistantText }, chatCompletion });
    await sendZaloMemoryReasoningApprovalsIfNeeded(options.client, incoming.chatId, options.paths, zaloConfig.ownerUserId, memoryReasoning);
    await appendLog({ event: "zalo_chat_success", detail: { model: options.config.llm.model } }, { paths: options.paths });
    return "replied";
  } catch (error) {
    typing.stop();
    const errorMessage = error instanceof Error ? error.message : "Unknown Zalo chat error.";
    await appendLog({ event: "zalo_chat_failure", detail: { message: errorMessage, ...fallbackLogDetail(error) } }, { paths: options.paths, knownSecrets: [apiKey] });
    await options.client.sendMessage(incoming.chatId, zaloChatFailureMessage(options.config, error));
    return "replied";
  }
}

export function mapZaloIncomingMessage(message: ZaloMessage): ChannelIncomingMessage<string, string | number | undefined, ZaloMessage> {
  const senderId = extractZaloSenderId(message);
  return {
    chatId: extractZaloChatId(message) ?? senderId,
    messageId: message.message_id ?? message.messageId,
    senderId,
    text: typeof message.text === "string" ? message.text : message.text?.text,
    caption: message.caption,
    raw: message,
  };
}

function extractZaloSenderId(message: ZaloMessage): string {
  return String(message.from?.id ?? message.sender?.id ?? message.user?.id ?? message.user_id ?? message.uid ?? message.sender_id ?? message.from_id ?? "");
}

function extractZaloChatId(message: ZaloMessage): string | undefined {
  const chatId = message.chat?.id ?? message.recipient?.id ?? message.conversation?.id ?? message.chat_id;
  return chatId === undefined ? undefined : String(chatId);
}

export function createZaloRuntimeAdapter(client: ZaloClient): ChannelRuntimeAdapter<never, string, "typing"> {
  return { descriptor: ZALO_CHANNEL, outbound: createZaloOutboundAdapter(client) };
}

export function createZaloOutboundAdapter(client: ZaloClient): ChannelOutboundAdapter<string, "typing"> {
  return {
    createResponseAdapter: (chatId) => ({
      sendMessage: async (text) => normalizeZaloSentMessage(await client.sendMessage(chatId, text)),
      editMessage: async (_messageId, text) => {
        await client.sendMessage(chatId, text);
      },
      splitMessage: splitZaloMessage,
      isNoopEditError: () => true,
    }),
    createActivityOptions: (chatId, action) => ({ client, chatId, action, refreshMs: 4_000 }),
  };
}

async function handleZaloSlashCommand(text: string, chatId: string, options: ZaloUpdateHandlerOptions): Promise<boolean> {
  if (await handleCronChannelCommand({ text, paths: options.paths, channel: "zalo", userId: chatId, sendMessage: (message) => options.client.sendMessage(chatId, message).then(() => undefined) })) {
    return true;
  }

  if (text === "/status") {
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const state = store.getMemoryState();
      const activeCount = store.listActiveMemories().length;
      const pendingCount = store.listPendingMemories().length;
      const providerHealth = await formatProviderFallbackHealth(options.paths);
      await options.client.sendMessage(chatId, [`Status -> memory ${state.paused ? "paused" : "active"}; active ${activeCount}; pending ${pendingCount}`, providerHealth].filter(Boolean).join("; "));
      return true;
    } finally {
      store.close();
    }
  }

  if (text === "/providers") {
    await options.client.sendMessage(chatId, await formatProviderFallbackDiagnostics(options.paths));
    return true;
  }

  if (text === "/approvals") {
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const approvals = store.listPendingActionApprovals("zalo", undefined, 5);
      await options.client.sendMessage(chatId, approvals.length === 0 ? "No pending action approvals." : `Pending approvals:\n${approvals.map(formatPendingApprovalSummary).join("\n\n")}`);
      return true;
    } finally {
      store.close();
    }
  }

  const approvalDecision = parseZaloApprovalDecision(text);
  if (approvalDecision) {
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const approval = approvalDecision.decision === "approve" ? store.approvePendingActionApproval(approvalDecision.id) : store.denyPendingActionApproval(approvalDecision.id);
      if (!approval) {
        await options.client.sendMessage(chatId, `Approval request ${approvalDecision.id} is no longer pending. It may have already been handled or expired.`);
        return true;
      }
      const actionResult = await executeApprovedAction(store, approval, approvalDecision.decision, { config: options.config, paths: options.paths });
      await options.client.sendMessage(chatId, actionResult.message);
      return true;
    } finally {
      store.close();
    }
  }

  const memoryCommand = parseZaloMemoryCommand(text);
  if (memoryCommand === "list") {
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const memories = store.listActiveMemories();
      if (memories.length === 0) {
        await options.client.sendMessage(chatId, "No active memories.");
        return true;
      }

      await sendZaloTextChunks(options.client, chatId, `Active memories (${memories.length}):\n${formatMemoryList(memories)}`);
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand === "pending") {
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const memories = store.listPendingMemories(5);
      await options.client.sendMessage(chatId, memories.length === 0 ? "No pending memories." : `Pending memories:\n${memories.map((memory) => `${memory.id}. [${memory.type}] ${memory.content}\n   Reason: ${memory.reason || "needs review"}`).join("\n")}`);
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand === "pause" || memoryCommand === "resume") {
    const paused = memoryCommand === "pause";
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      store.setMemoryPaused(paused);
      await options.client.sendMessage(chatId, `Memory ${paused ? "paused" : "resumed"}.`);
      return true;
    } finally {
      store.close();
    }
  }

  return false;
}

function createZaloPermissionApprover(client: ZaloClient, chatId: string, paths: RuntimePaths): PermissionApprover {
  return async (request, proposed) => {
      const store = await SqliteMemoryStore.open(paths);
      try {
        const approval = store.addPendingActionApproval({ channel: "zalo", category: request.category, action: request.action, target: request.target, reason: request.reason, proposedReason: proposed.reason, payloadJson: request.payloadJson, ttlMs: ZALO_ACTION_APPROVAL_TTL_MS });
        await client.sendMessage(chatId, [`Approval needed. Request: ${approval.id}`, `Action: ${request.action}`, `Category: ${request.category}`, request.target ? `Target: ${request.target}` : undefined, request.reason ? `Reason: ${request.reason}` : undefined, `Reply /approve ${approval.id} or /deny ${approval.id}.`].filter(Boolean).join("\n"));
        return { approved: false, reason: `Approval request ${approval.id} is pending in Zalo.` };
      } finally {
        store.close();
      }
  };
}

async function handleZaloToolActivity(response: ReturnType<typeof createChannelResponseController>, activity: AgentToolActivity, agentName: string): Promise<void> {
  if (activity.phase !== "start") {
    return;
  }
  if (activity.callIndex !== 1 && activity.callIndex % ZALO_TOOL_PROGRESS_EVERY !== 0) {
    return;
  }
  await response.showProgress(formatZaloToolActivity(activity, agentName));
}

async function runZaloMemoryReasoningPass(options: Parameters<typeof runMemoryReasoningPass>[0]): Promise<MemoryReasoningResult> {
  try {
    return await runMemoryReasoningPass(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown memory reasoning error.";
    await appendLog({ event: "memory_reasoning_failure", detail: { channel: "zalo", message } }, { paths: options.paths, knownSecrets: [options.apiKey] });
    return { stored: [], pending: [], skipped: [] };
  }
}

async function sendZaloMemoryReasoningApprovalsIfNeeded(
  client: ZaloClient,
  chatId: string,
  paths: RuntimePaths,
  ownerUserId: string,
  result: MemoryReasoningResult,
): Promise<void> {
  for (const pending of result.pending) {
    const store = await SqliteMemoryStore.open(paths);
    let approvalId: number;

    try {
      approvalId = store.addPendingActionApproval({
        channel: "zalo",
        userId: ownerUserId,
        category: "local_write",
        action: "memory_approve",
        target: `pending-memory:${pending.id}`,
        reason: "Approve or deny a memory inferred from the latest conversation.",
        proposedReason: pending.reason ?? "Memory reasoning proposed this candidate.",
      }).id;
    } finally {
      store.close();
    }

    await client.sendMessage(
      chatId,
      redactSecrets([
        `Memory approval needed. Request: ${approvalId}`,
        `Type: ${pending.type}`,
        `Content: ${pending.content}`,
        pending.reason ? `Reason: ${pending.reason}` : undefined,
        `Reply /approve ${approvalId} to save it or /deny ${approvalId} to reject it.`,
      ].filter(Boolean).join("\n")),
    );
  }
}

function formatZaloToolActivity(activity: AgentToolActivity, agentName: string): string {
  const target = activity.label.trim();
  const suffix = target ? ` ${target}` : "";

  if (activity.toolName === "internal.list_files") return `${agentName} is listing files in${suffix}`;
  if (activity.toolName === "internal.read_file") return `${agentName} is reading file${suffix}`;
  if (activity.toolName === "internal.read_many_files") return `${agentName} is reading files${suffix}`;
  if (activity.toolName === "internal.read_markdown_bundle") return `${agentName} is collecting Markdown docs from${suffix}`;
  if (activity.toolName === "internal.search_files") return `${agentName} is searching files for${suffix}`;
  if (activity.toolName === "internal.read_logs") return `${agentName} is reading recent logs`;
  if (activity.toolName === "internal.list_memories") return `${agentName} is listing saved memories`;
  if (activity.toolName === "internal.search_memories") return `${agentName} is searching memories for${suffix}`;
  if (activity.toolName === "internal.remember_memory") return `${agentName} is preparing a memory approval`;
  if (activity.toolName === "internal.delete_memory") return `${agentName} is deleting memory${suffix}`;
  if (activity.toolName === "internal.cleanup_memories") return `${agentName} is cleaning saved memories`;
  if (activity.toolName.startsWith("mcp.") || activity.toolName.includes("/")) return `${agentName} is using read tool${suffix}`;
  return `${agentName} is working${suffix}`;
}

async function sendZaloTextChunks(client: ZaloClient, chatId: string, text: string): Promise<void> {
  for (const chunk of splitZaloMessageText(text)) {
    await client.sendMessage(chatId, chunk);
  }
}

function splitZaloMessageText(text: string): string[] {
  if (text.length <= ZALO_MESSAGE_MAX_CHARS) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > ZALO_MESSAGE_MAX_CHARS) {
    const boundary = remaining.lastIndexOf("\n", ZALO_MESSAGE_MAX_CHARS);
    const end = boundary > 0 ? boundary : ZALO_MESSAGE_MAX_CHARS;
    chunks.push(remaining.slice(0, end).trimEnd());
    remaining = remaining.slice(end).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

function formatMemoryList(memories: Array<{ id: number; type: string; content: string }>): string {
  return memories.map((memory) => `${memory.id}. [${memory.type}] ${memory.content}`).join("\n");
}

async function loadRecentZaloTurns(paths: RuntimePaths, userId: string): Promise<ChatMessage[]> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    if (store.getMemoryState().paused) {
      return [];
    }
    return store.listRecentMessagesForChannel("zalo", userId, 12).map((message) => ({ role: message.role, content: message.content }));
  } finally {
    store.close();
  }
}

async function persistZaloConversationTurn(paths: RuntimePaths, userId: string, userInput: string, assistantText: string): Promise<void> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    if (store.getMemoryState().paused) {
      return;
    }
    store.addMessage({ channel: "zalo", userId, role: "user", content: userInput });
    store.addMessage({ channel: "zalo", userId, role: "assistant", content: assistantText });
  } finally {
    store.close();
  }
}

async function loadActiveMemories(paths: RuntimePaths): Promise<import("../memory/sqlite-store.js").StoredMemory[]> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    if (store.getMemoryState().paused) {
      return [];
    }
    return store.listActiveMemories();
  } finally {
    store.close();
  }
}

function zaloChatFailureMessage(config: AppConfig, error: unknown): string {
  if (error instanceof ProviderTimeoutError || (error instanceof ProviderFallbackError && error.finalError instanceof ProviderTimeoutError)) {
    return `${config.agent.name} timed out while handling this Zalo message. Try again, ask a narrower question, or raise llm.timeoutMs in .bestie/config.json.`;
  }

  const providerError = formatProviderChatFailure(error);
  if (providerError) {
    return `${config.agent.name} could not get a provider response for this Zalo message: ${providerError}`;
  }

  return `${config.agent.name} hit an error while handling this Zalo message. Try again or ask a narrower question.`;
}

function buildZaloRuntimeToolContext(incoming: ChannelIncomingMessage<string, string | number | undefined, ZaloMessage>, ownerUserId: string): string {
  return `Current channel: zalo. Current Zalo chat id: ${incoming.chatId}. Current owner/user id: ${ownerUserId}. For internal.add_cron_schedule reports back to this chat, set arguments.channel to "zalo:${incoming.chatId}".`;
}

function formatProviderChatFailure(error: unknown): string | undefined {
  if (error instanceof ProviderFallbackError) {
    return error.message;
  }

  if (error instanceof ProviderAuthError || error instanceof ProviderNetworkError || error instanceof ProviderRateLimitError || error instanceof ProviderResponseError) {
    return error.message;
  }

  return undefined;
}

function splitZaloMessage(text: string): string[] {
  if (text.length <= ZALO_MESSAGE_MAX_CHARS) {
    return [text];
  }
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += ZALO_MESSAGE_MAX_CHARS) {
    chunks.push(text.slice(index, index + ZALO_MESSAGE_MAX_CHARS));
  }
  return chunks;
}

function normalizeZaloSentMessage(message: ZaloSentMessage | void): { messageId?: number } | void {
  if (!message || message.messageId === undefined) {
    return undefined;
  }

  const messageId = typeof message.messageId === "number" ? message.messageId : Number(message.messageId);
  return Number.isFinite(messageId) ? { messageId } : undefined;
}

function normalizeZaloUpdatesResult(result: unknown): ZaloUpdate[] {
  if (result === undefined || result === null) {
    return [];
  }

  if (Array.isArray(result)) {
    return result as ZaloUpdate[];
  }

  if (typeof result === "object" && result !== null) {
    const keys = Object.keys(result);
    for (const key of ["updates", "data", "items", "messages"]) {
      const value = (result as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        return value as ZaloUpdate[];
      }
    }

    if ("message" in result || "event_name" in result || "update_id" in result) {
      return [normalizeSingleZaloUpdate(result as Record<string, unknown>)];
    }

    if (["count", "total", "total_count"].some((key) => (result as Record<string, unknown>)[key] === 0)) {
      return [];
    }

    if (keys.length === 0 || keys.every((key) => ["count", "total", "total_count", "offset", "next_offset", "has_more"].includes(key))) {
      return [];
    }

    throw new Error(`Zalo getUpdates returned an unexpected response shape with result keys: ${keys.join(", ") || "none"}.`);
  }

  throw new Error(`Zalo getUpdates returned an unexpected response shape: ${typeof result}.`);
}

function normalizeSingleZaloUpdate(result: Record<string, unknown>): ZaloUpdate {
  const updateId = typeof result.update_id === "number" ? result.update_id : Date.now();
  return {
    ...result,
    update_id: updateId,
    ...(typeof result.message === "object" && result.message !== null ? { message: result.message as ZaloMessage } : {}),
  };
}

async function sendZaloChatActionBestEffort(client: ZaloClient, chatId: string, action: "typing"): Promise<void> {
  try {
    await client.sendChatAction(chatId, action);
  } catch {
    // Typing indicators are best-effort; message delivery should continue.
  }
}

function formatPendingApprovalSummary(approval: { id: number; category: string; action: string; target?: string | null; reason?: string | null }): string {
  return redactSecrets([`Request ${approval.id}`, `Action: ${approval.action}`, `Category: ${approval.category}`, approval.target ? `Target: ${approval.target}` : undefined, approval.reason ? `Reason: ${approval.reason}` : undefined, `Reply with /approve ${approval.id} or /deny ${approval.id}.`].filter(Boolean).join("\n"));
}

function parseZaloApprovalDecision(text: string): { decision: "approve" | "deny"; id: number } | undefined {
  const match = text.match(/^\/(approve|deny) (\d+)$/);
  return match ? { decision: match[1] as "approve" | "deny", id: Number(match[2]) } : undefined;
}

function parseZaloMemoryCommand(text: string): "list" | "pending" | "pause" | "resume" | undefined {
  if (text === "/memory" || text === "/memory list" || text === "/memory status") {
    return "list";
  }
  if (text === "/memory pending") {
    return "pending";
  }
  if (text === "/memory pause" || text === "/pause_memory" || text === "/pause-memory") {
    return "pause";
  }
  if (text === "/memory resume" || text === "/resume_memory" || text === "/resume-memory") {
    return "resume";
  }
  return undefined;
}

async function readJsonResponse(response: Response): Promise<{ ok?: boolean; result?: unknown; description?: unknown; error_code?: unknown }> {
  try {
    return await response.json() as { ok?: boolean; result?: unknown; description?: unknown; error_code?: unknown };
  } catch {
    return { ok: response.ok, description: response.statusText };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}