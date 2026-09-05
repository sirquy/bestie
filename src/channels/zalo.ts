import { loadSystemPrompt } from "../character/prompt-loader.js";
import { buildPublicChannelAgentToolRunner, resolveChannelAgentRuntime } from "../agents/channel-binding.js";
import { buildChatMessages, getRecentMessageLimit } from "../chat/message-builder.js";
import { formatReasoningCommandHelp, formatReasoningLevel, parseReasoningLevel } from "../chat/reasoning.js";
import { formatChatFailureContext } from "../chat/error-context.js";
import { buildMcpToolSystemPrompt, completeWithAgentTools, runAgentToolRequest, type AgentToolActivity } from "../chat/mcp-tool-use.js";
import { fallbackLogDetail, formatProviderFallbackDiagnostics, formatProviderFallbackHealth } from "../llm/fallbacks.js";
import { ProviderAuthError, ProviderFallbackError, ProviderNetworkError, ProviderRateLimitError, ProviderResponseError, ProviderTimeoutError } from "../llm/errors.js";
import { sendChatCompletionWithFallbacks } from "../llm/chat-completion.js";
import type { ChatCompletionOptions, ChatMessage, ChatMessageContent, ReasoningLevel } from "../llm/types.js";
import { isMemoryRetrievalPolicy, setMemoryRetrievalPolicy } from "../memory/governance.js";
import { buildMemoryHygieneDoctorReport, formatMemoryHygieneDoctorReport } from "../memory/hygiene-doctor.js";
import { calculateMemoryHygieneScore } from "../memory/hygiene-score.js";
import { formatMemoryHygieneStatus } from "../memory/hygiene-status.js";
import { formatMemoryHygieneTrendReport, recordMemoryHygieneSnapshot } from "../memory/hygiene-trend.js";
import { getMemoryMaintenanceReportStatus, installMemoryMaintenanceReport, removeMemoryMaintenanceReport, runMemoryMaintenanceDigest } from "../memory/maintenance.js";
import { runKnowledgeReasoningPass, type KnowledgeReasoningResult } from "../memory/knowledge-reasoning.js";
import { loadConversationSummaryContext, refreshConversationSummary } from "../memory/conversation-summary.js";
import { loadRelevantMemories } from "../memory/context.js";
import { loadRelevantKnowledgeGraph } from "../memory/knowledge-context.js";
import { runMemoryReasoningPass, type MemoryReasoningResult } from "../memory/reasoning.js";
import { isMemoryScope, SqliteMemoryStore } from "../memory/sqlite-store.js";
import { applyMemoryRebalancePlan, formatMemoryRebalanceApplyResult, formatMemoryRebalancePlan, planMemoryRebalance } from "../memory/rebalance.js";
import { formatMemorySummary } from "../memory/summary.js";
import { formatMemoryTiersReport } from "../memory/tiers.js";
import type { AppConfig } from "../runtime/config.js";
import { loadLlmCandidateSecret, resolvePrimaryLlmCandidate } from "../llm/resolve-config.js";
import { appendLog, redactSecrets } from "../runtime/logger.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { executeApprovedAction } from "../safety/approval-executor.js";
import { handleCronChannelCommand } from "../cron/channel-commands.js";
import { analyzeMemoriesTool, planMemoryHygieneTool, readMemoryHygieneTrendTool } from "../tools/local-read-tools.js";
import type { PermissionApprover, PermissionPolicy } from "../safety/permission-policy.js";
import type { ChannelIncomingMessage, ChannelOutboundAdapter, ChannelRuntimeAdapter } from "./adapter.js";
import { matchesOwnerId, type OwnerUserIdConfig } from "./owner-policy.js";
import { createChannelActivityController } from "./activity.js";
import { createChannelActionPermissionApprover } from "./action-approval.js";
import { buildChannelAttachmentPreview, type AttachmentContentParser } from "./attachment-preview.js";
import { buildChannelAttachmentPrompt } from "./attachment-prompt.js";
import { resolveChannelVisionPolicy } from "./attachment-policy.js";
import { processChannelAttachment } from "./attachment-pipeline.js";
import { buildChannelVisionAttachment, type ChannelVisionAttachment } from "./attachment-vision.js";
import { buildChannelProvidedAudioTranscriptResult, type ChannelAudioTranscriptResult } from "./audio-transcription.js";
import {
  ChannelAttachmentHandlingError,
  applyChannelAttachmentRetention,
  buildChannelAttachmentPath,
  downloadChannelAttachmentBytes,
  isAudioAttachmentKind,
  persistChannelAttachmentFile,
  type ChannelAttachmentKind,
  type ChannelDownloadedAttachment,
  type ChannelTranscript,
} from "./attachments.js";
import { applyMemoryHygienePlanForChannel, formatMemoryAnalysisReport, formatMemoryCleanupDryRunReport, formatMemoryGovernanceStatus, formatMemoryHygieneReport, formatMemoryInspect, formatMemoryMaintenanceInstalled, formatMemoryMaintenanceRemoved, formatMemoryMaintenanceStatus, formatMemoryRetrievalPolicyUpdated, formatPendingKnowledgeSanitizeResult } from "./memory-commands.js";
import { ZALO_CHANNEL, ZALO_PERSONAL_CHANNEL, formatChannelHelpCommands } from "./registry.js";
import { createChannelResponseController } from "./response-controller.js";
import { formatChannelToolProgress, shouldShowToolProgress } from "./tool-progress.js";
import { createChannelVoiceTranscriber, type ChannelVoiceTranscriber } from "./voice.js";
import type { AgentOutboundFileSender } from "../tools/channel-send-tools.js";
import { basename, extname } from "node:path";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";
const ZALO_MESSAGE_MAX_CHARS = 2_000;
const ZALO_POLLING_TIMEOUT_SECONDS = 25;
const ZALO_TOOL_PROGRESS_EVERY = 3;
const ZALO_ACTION_APPROVAL_TTL_MS = 30 * 60 * 1000;
const zaloReasoningLevels = new Map<string, ReasoningLevel>();
const ZALO_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const ZALO_ATTACHMENT_PREVIEW_MAX_BYTES = 16 * 1024;
const ZALO_ATTACHMENT_PARSE_MAX_BYTES = 5 * 1024 * 1024;
const ZALO_ATTACHMENT_VISION_MAX_BYTES = 4 * 1024 * 1024;
const ZALO_ATTACHMENT_TRANSCRIPTION_MAX_BYTES = 10 * 1024 * 1024;
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
  display_name?: string;
  displayName?: string;
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

export type ZaloAttachmentKind = ChannelAttachmentKind;

export interface ZaloFileInfo {
  fileId?: string;
  filePath?: string;
  fileSize?: number;
}

interface ZaloAttachmentSummary {
  kind: ZaloAttachmentKind;
  fileId: string;
  filePath?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  duration?: number;
  emoji?: string;
  providedTranscript?: ChannelTranscript;
}

interface SavedZaloAttachment extends ZaloAttachmentSummary {
  localPath: string;
  localPathRetained: boolean;
  bytes: number;
  textPreview?: string;
  textPreviewTruncated?: boolean;
  contentParser?: AttachmentContentParser;
  parseWarning?: string;
  visionImage?: ChannelVisionAttachment;
  audioTranscript?: string;
  audioTranscriptTruncated?: boolean;
  audioTranscriptSource?: ChannelTranscript["source"];
  transcriptionWarning?: string;
}

type ZaloAttachmentPipelineInput = { localPath: string; bytes: Uint8Array };

interface ZaloAttachmentPolicy {
  downloadPolicy: "allow" | "deny";
  maxBytes: number;
  previewMaxBytes: number;
  parseMaxBytes: number;
  visionPolicy: "allow" | "deny";
  visionMaxBytes: number;
  transcriptionPolicy: "allow" | "deny";
  transcriptionMaxBytes: number;
  deleteAfterProcessingKinds: ZaloAttachmentKind[];
}

export interface ZaloUpdate {
  update_id: number;
  message?: ZaloMessage;
  [key: string]: unknown;
}

export interface ZaloClient {
  getMe?(): Promise<ZaloUser>;
  getUpdates(offset: number | undefined, timeoutSeconds: number): Promise<ZaloUpdate[]>;
  getFile?(fileId: string): Promise<ZaloFileInfo>;
  downloadFile?(filePath: string): Promise<Uint8Array>;
  sendMessage(chatId: string, text: string, options?: ZaloSendMessageOptions): Promise<ZaloSentMessage | void>;
  sendPhoto?(chatId: string, photo: Uint8Array, options?: ZaloSendFileOptions): Promise<ZaloSentMessage | void>;
  sendDocument?(chatId: string, document: Uint8Array, options?: ZaloSendFileOptions): Promise<ZaloSentMessage | void>;
  sendChatAction(chatId: string, action: "typing", threadType?: 0 | 1): Promise<void>;
}

export interface ZaloSendMessageOptions {
  parseMode?: "Markdown";
  threadType?: 0 | 1;
  quote?: unknown;
}

export interface ZaloSendFileOptions {
  fileName?: string;
  mimeType?: string;
  caption?: string;
  threadType?: 0 | 1;
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
  channel?: ZaloRuntimeChannel;
}

export type ZaloRuntimeChannel = "zalo" | "zalo-personal";

type ZaloRuntimeConfig = {
  enabled: boolean;
  ownerUserId: OwnerUserIdConfig;
  adminUserIds?: string[];
  groupPolicy?: "disabled" | "allowlist" | "open";
  groups?: string[];
  groupAllowFrom?: string[];
  requireMention?: boolean;
  attachments?: NonNullable<NonNullable<AppConfig["channels"]>["zalo"]>["attachments"];
};

function getZaloRuntimeConfig(config: AppConfig, channel: ZaloRuntimeChannel): ZaloRuntimeConfig | undefined {
  return channel === "zalo" ? config.channels?.zalo : config.channels?.zaloPersonal;
}

function getZaloRuntimeDescriptor(channel: ZaloRuntimeChannel) {
  return channel === "zalo" ? ZALO_CHANNEL : ZALO_PERSONAL_CHANNEL;
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

  async getFile(fileId: string): Promise<ZaloFileInfo> {
    const file = await this.call<unknown>("getFile", { file_id: fileId });
    return normalizeZaloFileInfo(file, fileId);
  }

  async downloadFile(filePath: string): Promise<Uint8Array> {
    if (/^https?:\/\//i.test(filePath)) {
      const response = await this.fetchImpl(filePath);
      if (!response.ok) {
        throw new Error(`Zalo file download failed: ${response.status} ${response.statusText}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    }

    const response = await this.fetchImpl(`${ZALO_API_BASE_URL}/bot${this.botToken}/downloadFile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_path: filePath }),
    });
    if (!response.ok) {
      throw new Error(`Zalo file download failed: ${response.status} ${response.statusText}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async sendMessage(chatId: string, text: string, options: ZaloSendMessageOptions = {}): Promise<ZaloSentMessage | void> {
    const parseMode = options.parseMode ?? "Markdown";
    return this.call<ZaloSentMessage | void>("sendMessage", { chat_id: chatId, text, parse_mode: parseMode });
  }

  async sendPhoto(chatId: string, photo: Uint8Array, options: ZaloSendFileOptions = {}): Promise<ZaloSentMessage | void> {
    return this.call<ZaloSentMessage | void>("sendPhoto", { chat_id: chatId, photo: toZaloDataUrl(photo, options.mimeType ?? "image/jpeg"), ...(options.caption ? { caption: options.caption } : {}) });
  }

  async sendDocument(chatId: string, document: Uint8Array, options: ZaloSendFileOptions = {}): Promise<ZaloSentMessage | void> {
    return this.call<ZaloSentMessage | void>("sendMessage", {
      chat_id: chatId,
      ...(options.caption ? { text: options.caption } : {}),
      attachments: [{ type: "file", url: toZaloDataUrl(document, options.mimeType ?? "application/octet-stream"), file_name: options.fileName ?? "bestie-file.bin", mime_type: options.mimeType ?? "application/octet-stream", size: document.byteLength }],
    });
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
  const channel = options.channel ?? "zalo";
  const zaloConfig = getZaloRuntimeConfig(options.config, channel);
  const message = update.message;
  const adapter = createZaloRuntimeAdapter(options.client, update, options);
  const incoming = message ? mapZaloIncomingMessage(message) : undefined;
  const attachment = incoming ? adapter.attachments?.getAttachment(incoming) : undefined;
  const text = (incoming?.text ?? incoming?.caption ?? "").trim();

  if (!zaloConfig?.enabled || !incoming || !isZaloMessageAllowed(incoming, zaloConfig, channel, options.config.agent.name)) {
    return "ignored";
  }

  const threadType = getZaloThreadType(incoming, channel);

  if (!text && !attachment) {
    await options.client.sendMessage(incoming.chatId, `${options.config.agent.name} received this Zalo message type, but cannot save it yet. Please send a text description with it.`, { threadType });
    return "replied";
  }

  const isPublicChannel = Array.isArray(zaloConfig.ownerUserId) && zaloConfig.ownerUserId.length === 1 && zaloConfig.ownerUserId[0] === "*";
  if (!attachment && text.startsWith("/") && (isPublicChannel || threadType === 1)) {
    await options.client.sendMessage(incoming.chatId, "Commands are not available in this public support chat.", { threadType });
    return "replied";
  }

  if (!attachment && text === "/help") {
    await options.client.sendMessage(incoming.chatId, formatChannelHelpCommands(getZaloRuntimeDescriptor(channel)), { threadType });
    return "replied";
  }

  if (!attachment && await handleZaloSlashCommand(text, incoming.chatId, incoming.senderId, options, channel, threadType)) {
    return "replied";
  }

  if (!attachment && text.startsWith("/")) {
    await options.client.sendMessage(incoming.chatId, `Unknown command: ${text}. Try /help.`, { threadType });
    return "replied";
  }

  const reasoningLevel = zaloReasoningLevels.get(`${channel}:${incoming.chatId}:${incoming.senderId}`) ?? "off";
  const chatCompletion = options.chatCompletion ?? ((config, _apiKeyValue, requestOptions) => sendChatCompletionWithFallbacks(config, { ...requestOptions, stream: requestOptions.stream ?? true, reasoningLevel }, { paths: options.paths }));
  const typing = createChannelActivityController(adapter.outbound.createActivityOptions(incoming.chatId, "typing"));
  let apiKey = "";
  let conversationUserId = threadType === 1 ? `group:${incoming.chatId}` : incoming.senderId;
  let userInput = text;

  try {
    const channelAgent = await resolveChannelAgentRuntime(options.config, options.paths, channel, incoming.senderId, [incoming.senderId], threadType !== 1, threadType === 1 ? `group:${incoming.chatId}` : undefined);
    const effectiveConfig = channelAgent?.config ?? options.config;
    conversationUserId = channelAgent?.conversationUserId ?? conversationUserId;
    if (!channelAgent?.publicAccess) {
      await sendZaloChatActionBestEffort(options.client, incoming.chatId, "typing", threadType);
      typing.start();
    }
    apiKey = await loadLlmCandidateSecret(resolvePrimaryLlmCandidate(effectiveConfig), options.paths);
    const effectiveToolRunner = channelAgent ? buildPublicChannelAgentToolRunner(channelAgent, runAgentToolRequest) : runAgentToolRequest;
    const savedAttachment = attachment ? await adapter.attachments?.processAttachment(attachment, incoming) as SavedZaloAttachment | undefined : undefined;
    userInput = savedAttachment ? buildZaloAttachmentUserInput(text, savedAttachment) : text;
    const systemPrompt = channelAgent?.systemPrompt ?? await loadSystemPrompt(options.paths);
    const memories = await loadRelevantMemories(options.paths, { query: userInput, namespace: channelAgent?.publicAccess?.memoryNamespace });
    const recentMessageLimit = getRecentMessageLimit(effectiveConfig);
    const recentTurns = await loadRecentZaloTurns(options.paths, conversationUserId, recentMessageLimit, channel);
    const knowledgeGraph = channelAgent?.publicAccess?.knowledgeNamespace === undefined && channelAgent?.publicAccess
      ? undefined
      : await loadRelevantKnowledgeGraph(options.paths, userInput, { namespace: channelAgent?.publicAccess?.knowledgeNamespace });
    const runtimeContext = buildZaloRuntimeToolContext(incoming, incoming.senderId, channel);
    const conversationSummary = await loadConversationSummaryContext(options.paths, channel, conversationUserId);
    const messages = buildChatMessages(buildMcpToolSystemPrompt(systemPrompt, effectiveConfig, runtimeContext), recentTurns, userInput, memories, { memoryRetrievalPolicy: effectiveConfig.memory?.retrievalPolicy ?? "full", knowledgeGraph, conversationSummary, recentMessageLimit });
    if (savedAttachment?.visionImage) {
      attachZaloVisionImage(messages, userInput, savedAttachment.visionImage.dataUrl);
    }
    const response = createChannelResponseController(adapter.outbound.createResponseAdapter(incoming.chatId));
    const assistantText = await completeWithAgentTools({
      config: effectiveConfig,
      paths: options.paths,
      apiKey,
      messages,
      chatCompletion,
      toolRunner: async (toolOptions) => {
        const result = await effectiveToolRunner(toolOptions);
        if (!channelAgent?.publicAccess) {
          await sendZaloMemoryApprovalIfNeeded(options.client, incoming.chatId, options.paths, incoming.senderId, toolOptions.request.tool, result, channel, threadType);
          await sendZaloKnowledgeApprovalIfNeeded(options.client, incoming.chatId, options.paths, incoming.senderId, toolOptions.request.tool, result, channel, threadType);
        }
        return result;
      },
      approver: channelAgent?.publicAccess ? undefined : createZaloPermissionApprover(options.client, incoming.chatId, incoming.senderId, options.paths, channel, threadType),
      policy: channelAgent?.policy ?? ZALO_PERMISSION_POLICY,
      streamFinalResponse: true,
      onToolActivity: channelAgent?.publicAccess
        ? async () => undefined
        : async (activity) => handleZaloToolActivity(response, activity, channelAgent?.agent.displayName ?? options.config.agent.name),
      runtimeContext,
      currentCronDestination: `${channel === "zalo-personal" && incoming.raw.chat?.type === "group" ? "zalo-personal-group" : channel}:${incoming.chatId}`,
      outboundFileSender: createZaloOutboundFileSender(options.client, incoming.chatId, channel, threadType),
    });
    typing.stop();
    await response.replyFinal(assistantText);
    await persistZaloConversationTurn(options.paths, conversationUserId, userInput, assistantText, channel);
    await runZaloConversationSummaryPass({ config: effectiveConfig, paths: options.paths, apiKey, channel, userId: conversationUserId, chatCompletion });
    const memoryReasoning = await runZaloMemoryReasoningPass({ config: effectiveConfig, paths: options.paths, apiKey, turn: { channel, userId: conversationUserId, userInput, assistantText }, chatCompletion, namespace: channelAgent?.publicAccess?.memoryNamespace, writePolicyOverride: channelAgent?.publicAccess ? channelAgent.publicAccess.memoryWritePolicy === "pending" ? "ask" : channelAgent.publicAccess.memoryWritePolicy : undefined });
    const knowledgeReasoning = await runZaloKnowledgeReasoningPass({ config: effectiveConfig, paths: options.paths, apiKey, turn: { channel, userId: conversationUserId, userInput, assistantText }, chatCompletion, writePolicyOverride: channelAgent?.publicAccess ? "deny" : undefined });
    if (!channelAgent?.publicAccess) {
      await sendZaloMemoryReasoningApprovalsIfNeeded(options.client, incoming.chatId, options.paths, incoming.senderId, memoryReasoning, channel, threadType);
      await sendZaloKnowledgeReasoningApprovalsIfNeeded(options.client, incoming.chatId, options.paths, incoming.senderId, knowledgeReasoning, channel, threadType);
    }
    await appendLog({ event: "zalo_chat_success", detail: { model: options.config.llm.primary } }, { paths: options.paths });
    return "replied";
  } catch (error) {
    typing.stop();
    if (error instanceof ChannelAttachmentHandlingError) {
      await appendLog({ event: "zalo_attachment_failure", detail: { reason: error.reason, kind: attachment?.kind } }, { paths: options.paths, knownSecrets: [apiKey] });
      await persistZaloConversationTurn(options.paths, conversationUserId, userInput, formatChatFailureContext(error, apiKey ? [apiKey] : []), channel);
      await options.client.sendMessage(incoming.chatId, error.userMessage, { threadType });
      return "replied";
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown Zalo chat error.";
    await appendLog({ event: "zalo_chat_failure", detail: { message: errorMessage, ...fallbackLogDetail(error) } }, { paths: options.paths, knownSecrets: [apiKey] });
    await persistZaloConversationTurn(options.paths, conversationUserId, userInput, formatChatFailureContext(error, apiKey ? [apiKey] : []), channel);
    await options.client.sendMessage(incoming.chatId, zaloChatFailureMessage(options.config, error), { threadType });
    return "replied";
  }
}

export function mapZaloIncomingMessage(message: ZaloMessage): ChannelIncomingMessage<string, string | number | undefined, ZaloMessage> {
  const senderId = extractZaloSenderId(message);
  const text = typeof message.text === "string" ? message.text : message.text?.text;
  return {
    chatId: extractZaloChatId(message) ?? senderId,
    messageId: message.message_id ?? message.messageId,
    senderId,
    text: text || (isZaloStickerMessage(message) ? "[User sent a sticker.]" : undefined),
    caption: message.caption,
    raw: message,
  };
}

function getZaloThreadType(incoming: ChannelIncomingMessage<string, string | number | undefined, ZaloMessage>, channel: ZaloRuntimeChannel): 0 | 1 {
  return channel === "zalo-personal" && incoming.raw.chat?.type === "group" ? 1 : 0;
}

function isZaloMessageAllowed(incoming: ChannelIncomingMessage<string, string | number | undefined, ZaloMessage>, config: ZaloRuntimeConfig, channel: ZaloRuntimeChannel, agentName: string): boolean {
  if (channel !== "zalo-personal" || incoming.raw.chat?.type !== "group") {
    return matchesOwnerId(config.ownerUserId, [incoming.senderId]);
  }

  if ((config.groupPolicy ?? "disabled") === "disabled") return false;
  if (config.groupPolicy === "allowlist" && !config.groups?.includes(incoming.chatId)) return false;
  if (config.groupPolicy === "open" && config.groups?.length && !config.groups.includes("*") && !config.groups.includes(incoming.chatId)) return false;
  if (config.groupAllowFrom?.length && !config.groupAllowFrom.includes("*") && !config.groupAllowFrom.includes(incoming.senderId)) return false;
  if (config.requireMention !== false && !hasZaloPersonalMention(incoming, agentName)) return false;
  return true;
}

function hasZaloPersonalMention(incoming: ChannelIncomingMessage<string, string | number | undefined, ZaloMessage>, agentName: string): boolean {
  const raw = incoming.raw as ZaloMessage & { mentions?: unknown; mention?: unknown };
  if (hasZaloMentionValue(raw.mentions) || hasZaloMentionValue(raw.mention)) return true;
  const text = `${incoming.text ?? incoming.caption ?? ""}`.toLocaleLowerCase();
  const name = agentName.trim().toLocaleLowerCase().replace(/^@+/, "");
  return name.length > 0 && text.includes(`@${name}`);
}

function hasZaloMentionValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== undefined && value !== null;
}

function isZaloStickerMessage(message: ZaloMessage): boolean {
  if (message.sticker !== undefined) return true;
  if (inferZaloAttachmentKind(message) === "sticker") return true;
  return Array.isArray(message.attachments) && message.attachments.some((attachment) => inferZaloAttachmentKind(asRecord(attachment)) === "sticker");
}

function extractZaloSenderId(message: ZaloMessage): string {
  return String(message.from?.id ?? message.sender?.id ?? message.user?.id ?? message.user_id ?? message.uid ?? message.sender_id ?? message.from_id ?? "");
}

function extractZaloChatId(message: ZaloMessage): string | undefined {
  const chatId = message.chat?.id ?? message.recipient?.id ?? message.conversation?.id ?? message.chat_id;
  return chatId === undefined ? undefined : String(chatId);
}

export function createZaloRuntimeAdapter(client: ZaloClient, update?: ZaloUpdate, options?: Pick<ZaloUpdateHandlerOptions, "config" | "paths" | "client" | "channel">): ChannelRuntimeAdapter<ZaloAttachmentSummary, string, "typing"> {
  return {
    descriptor: getZaloRuntimeDescriptor(options?.channel ?? "zalo"),
    ...(update && options ? {
      attachments: {
        getAttachment: (message) => getZaloAttachment(message.raw as ZaloMessage),
        processAttachment: (attachment) => saveZaloAttachment(attachment, update, options),
      },
    } : {}),
    outbound: createZaloOutboundAdapter(client, update?.message?.chat?.type === "group" ? 1 : 0, update?.message?.quote, options?.channel === "zalo-personal"),
  };
}

export function createZaloOutboundAdapter(client: ZaloClient, threadType: 0 | 1 = 0, quote?: unknown, plainText = false): ChannelOutboundAdapter<string, "typing"> {
  let pendingQuote = threadType === 1 ? quote : undefined;

  return {
    createResponseAdapter: (chatId) => ({
      sendMessage: async (text) => {
        const messageQuote = pendingQuote;
        const sent = normalizeZaloSentMessage(await client.sendMessage(chatId, plainText ? stripMarkdown(text) : text, { threadType, ...(messageQuote === undefined ? {} : { quote: messageQuote }) }));
        pendingQuote = undefined;
        return sent;
      },
      editMessage: async (_messageId, text) => {
        await client.sendMessage(chatId, plainText ? stripMarkdown(text) : text, { threadType });
      },
      splitMessage: splitZaloMessage,
      isNoopEditError: () => true,
    }),
    createActivityOptions: (chatId, action) => ({ client: { sendChatAction: (id: string, nextAction: "typing") => client.sendChatAction(id, nextAction, threadType) }, chatId, action, refreshMs: 4_000 }),
  };
}

function createZaloOutboundFileSender(client: ZaloClient, currentChatId: string, channel: ZaloRuntimeChannel = "zalo", threadType: 0 | 1 = 0): AgentOutboundFileSender {
  return {
    async sendPhoto(payload) {
      if (!client.sendPhoto) {
        throw new Error("Zalo client does not support sending photos.");
      }
      const chatId = resolveZaloOutboundChatId(payload.channel, currentChatId, channel);
      const sent = normalizeZaloSentMessage(await client.sendPhoto(chatId, payload.bytes, { fileName: payload.fileName, mimeType: payload.mimeType, caption: channel === "zalo-personal" && payload.caption !== undefined ? stripMarkdown(payload.caption) : payload.caption, threadType }));
      return { channel: `${channel}:${chatId}`, target: chatId, ...(sent?.messageId === undefined ? {} : { messageId: sent.messageId }) };
    },
    async sendFile(payload) {
      if (!client.sendDocument) {
        throw new Error("Zalo client does not support sending files.");
      }
      const chatId = resolveZaloOutboundChatId(payload.channel, currentChatId, channel);
      const sent = normalizeZaloSentMessage(await client.sendDocument(chatId, payload.bytes, { fileName: payload.fileName, mimeType: payload.mimeType, caption: channel === "zalo-personal" && payload.caption !== undefined ? stripMarkdown(payload.caption) : payload.caption, threadType }));
      return { channel: `${channel}:${chatId}`, target: chatId, ...(sent?.messageId === undefined ? {} : { messageId: sent.messageId }) };
    },
  };
}

function resolveZaloOutboundChatId(channel: string | undefined, currentChatId: string, runtimeChannel: ZaloRuntimeChannel): string {
  if (channel === undefined || channel.trim() === "" || channel === "current") return currentChatId;
  const match = new RegExp(`^${runtimeChannel}:(.+)$`).exec(channel.trim());
  if (!match?.[1]) {
    throw new Error(`Zalo outbound files require channel "${runtimeChannel}:<chatId>" or the current channel.`);
  }
  return match[1];
}

function getZaloAttachment(message: ZaloMessage): ZaloAttachmentSummary | undefined {
  for (const kind of ["photo", "document", "voice", "audio", "video", "sticker"] as const) {
    const raw = message[kind];
    const attachment = normalizeZaloAttachment(kind, raw);
    if (attachment) {
      return attachment;
    }
  }

  const attachments = message.attachments;
  if (Array.isArray(attachments)) {
    for (const raw of attachments) {
      const kind = inferZaloAttachmentKind(asRecord(raw)) ?? "document";
      const attachment = normalizeZaloAttachment(kind, raw);
      if (attachment) {
        return attachment;
      }
    }
  }

  return normalizeZaloAttachment(inferZaloAttachmentKind(message) ?? "document", message.attachment);
}

function normalizeZaloAttachment(kind: ZaloAttachmentKind, raw: unknown): ZaloAttachmentSummary | undefined {
  const record = asRecord(raw);
  if (!record) {
    if (typeof raw === "string" && raw.trim()) {
      return { kind, fileId: raw.trim(), filePath: raw.trim() };
    }
    return undefined;
  }

  const fileId = firstString(record, ["file_id", "fileId", "id", "attachment_id", "attachmentId", "media_id", "mediaId", "token"]);
  const filePath = firstString(record, ["file_path", "filePath", "file_url", "fileUrl", "download_url", "downloadUrl", "url", "href", "path"]);
  if (!fileId && !filePath) {
    return undefined;
  }

  const transcriptText = firstString(record, ["transcript", "transcription", "speech_to_text", "speechToText"]);
  return {
    kind,
    fileId: fileId ?? filePath!,
    ...(filePath === undefined ? {} : { filePath }),
    ...optionalStringProperty("fileName", firstString(record, ["file_name", "fileName", "name", "filename", "title"])),
    ...optionalStringProperty("mimeType", firstString(record, ["mime_type", "mimeType", "content_type", "contentType", "type"])),
    ...optionalNumberProperty("fileSize", firstNumber(record, ["file_size", "fileSize", "size", "bytes"])),
    ...optionalNumberProperty("width", firstNumber(record, ["width"])),
    ...optionalNumberProperty("height", firstNumber(record, ["height"])),
    ...optionalNumberProperty("duration", firstNumber(record, ["duration"])),
    ...optionalStringProperty("emoji", firstString(record, ["emoji"])),
    ...(transcriptText ? { providedTranscript: { text: transcriptText, source: "platform" as const } } : {}),
  };
}

async function saveZaloAttachment(attachment: ZaloAttachmentSummary, update: ZaloUpdate, options: Pick<ZaloUpdateHandlerOptions, "config" | "paths" | "client" | "channel">): Promise<SavedZaloAttachment> {
  const channel = options.channel ?? "zalo";
  const policy = getZaloAttachmentPolicy(options.config, channel);
  const transcriber = createChannelVoiceTranscriber({ config: options.config, paths: options.paths, transcriptionPolicy: policy.transcriptionPolicy });
  const processed = await processChannelAttachment({
    validate: () => validateZaloAttachmentPolicy(policy),
    download: () => downloadChannelAttachmentBytes({
      fileId: attachment.fileId,
      reportedSize: attachment.fileSize,
      maxBytes: policy.maxBytes,
      getFile: (fileId) => getZaloFileInfo(options.client, attachment, fileId),
      downloadFile: options.client.downloadFile ? (filePath) => options.client.downloadFile!(filePath) : undefined,
      messages: zaloAttachmentDownloadMessages(policy),
    }),
    buildLocalPath: (downloaded: ChannelDownloadedAttachment) => buildZaloAttachmentPath(options.paths, update, attachment, downloaded.filePath, channel),
    persist: persistChannelAttachmentFile,
    preview: (input: ZaloAttachmentPipelineInput) => buildChannelAttachmentPreview({
      bytes: input.bytes,
      localPath: input.localPath,
      mimeType: attachment.mimeType,
      previewMaxBytes: policy.previewMaxBytes,
      parseMaxBytes: policy.parseMaxBytes,
    }),
    vision: (input: ZaloAttachmentPipelineInput) => buildChannelVisionAttachment({
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      localPath: input.localPath,
      bytes: input.bytes,
      visionPolicy: policy.visionPolicy,
      visionMaxBytes: policy.visionMaxBytes,
    }),
    transcribe: (input: ZaloAttachmentPipelineInput) => transcribeZaloAudioAttachment(attachment, input.localPath, input.bytes, policy, transcriber),
    retain: (input: Pick<ZaloAttachmentPipelineInput, "localPath">) => applyChannelAttachmentRetention({
      localPath: input.localPath,
      kind: attachment.kind,
      deleteAfterProcessingKinds: policy.deleteAfterProcessingKinds,
      onCleanupFailed: (detail) => appendLog({ event: "zalo_attachment_cleanup_failed", detail }),
    }),
  });

  return { ...attachment, ...processed };
}

async function getZaloFileInfo(client: ZaloClient, attachment: ZaloAttachmentSummary, fileId: string): Promise<ZaloFileInfo> {
  if (attachment.filePath) {
    return { fileId, filePath: attachment.filePath, fileSize: attachment.fileSize };
  }
  if (!client.getFile) {
    return {};
  }
  return client.getFile(fileId);
}

function validateZaloAttachmentPolicy(policy: ZaloAttachmentPolicy): void {
  if (policy.downloadPolicy === "deny") {
    throw new ChannelAttachmentHandlingError("download_disabled", "Attachment downloads are disabled by config.");
  }
}

function zaloAttachmentDownloadMessages(policy: ZaloAttachmentPolicy): Parameters<typeof downloadChannelAttachmentBytes>[0]["messages"] {
  return {
    clientUnsupported: "This Zalo runtime cannot download attachments yet.",
    metadataFailed: "Zalo could not provide file metadata for this attachment.",
    missingFilePath: "Zalo could not provide a downloadable file for this attachment.",
    downloadFailed: "Zalo could not download this attachment. Please try again with a smaller or different file.",
    tooLarge: `This attachment is larger than the configured limit of ${policy.maxBytes} bytes.`,
  };
}

function buildZaloAttachmentPath(paths: RuntimePaths, update: ZaloUpdate, attachment: ZaloAttachmentSummary, filePath: string, channel: ZaloRuntimeChannel = "zalo"): string {
  const date = new Date().toISOString().slice(0, 10);
  const messageId = update.message?.message_id ?? update.message?.messageId ?? update.update_id;
  const sourceName = attachment.fileName ?? (basename(filePath) || `${attachment.kind}-${attachment.fileId}`);
  const extension = extname(sourceName) || defaultZaloAttachmentExtension(attachment.kind, attachment.mimeType);
  return buildChannelAttachmentPath({
    workspaceDir: paths.workspaceDir,
    channelName: channel,
    date,
    updateId: update.update_id,
    messageId,
    kind: attachment.kind,
    sourceName,
    extension,
    fallbackName: `${attachment.kind}-${messageId}`,
  });
}

function defaultZaloAttachmentExtension(kind: ZaloAttachmentKind, mimeType: string | undefined): string {
  if (mimeType === "text/plain") return ".txt";
  if (mimeType === "application/json") return ".json";
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "audio/ogg") return ".ogg";
  if (mimeType === "video/mp4") return ".mp4";
  if (kind === "photo") return ".jpg";
  if (kind === "sticker") return ".webp";
  return ".bin";
}

function getZaloAttachmentPolicy(config: AppConfig, channel: ZaloRuntimeChannel = "zalo"): ZaloAttachmentPolicy {
  const configured = getZaloRuntimeConfig(config, channel)?.attachments;
  return {
    downloadPolicy: configured?.downloadPolicy ?? "allow",
    maxBytes: configured?.maxBytes ?? ZALO_ATTACHMENT_MAX_BYTES,
    previewMaxBytes: configured?.previewMaxBytes ?? ZALO_ATTACHMENT_PREVIEW_MAX_BYTES,
    parseMaxBytes: configured?.parseMaxBytes ?? ZALO_ATTACHMENT_PARSE_MAX_BYTES,
    visionPolicy: resolveChannelVisionPolicy(config, configured?.visionPolicy),
    visionMaxBytes: configured?.visionMaxBytes ?? ZALO_ATTACHMENT_VISION_MAX_BYTES,
    transcriptionPolicy: configured?.transcriptionPolicy ?? "deny",
    transcriptionMaxBytes: configured?.transcriptionMaxBytes ?? ZALO_ATTACHMENT_TRANSCRIPTION_MAX_BYTES,
    deleteAfterProcessingKinds: configured?.deleteAfterProcessingKinds ?? [],
  };
}

function buildZaloAttachmentUserInput(caption: string, attachment: SavedZaloAttachment): string {
  return buildChannelAttachmentPrompt({
    channelDisplayName: "Zalo",
    caption,
    kind: attachment.kind,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    reportedSize: attachment.fileSize,
    savedBytes: attachment.bytes,
    width: attachment.width,
    height: attachment.height,
    duration: attachment.duration,
    emoji: attachment.emoji,
    localPath: attachment.localPath,
    localPathRetained: attachment.localPathRetained,
    textPreview: attachment.textPreview,
    textPreviewParser: attachment.contentParser,
    textPreviewTruncated: attachment.textPreviewTruncated,
    parseWarning: attachment.parseWarning,
    visionAttached: Boolean(attachment.visionImage),
    audioTranscript: attachment.audioTranscript,
    audioTranscriptSource: attachment.audioTranscriptSource,
    audioTranscriptTruncated: attachment.audioTranscriptTruncated,
    transcriptionWarning: attachment.transcriptionWarning,
  });
}

async function transcribeZaloAudioAttachment(attachment: ZaloAttachmentSummary, localPath: string, bytes: Uint8Array, policy: ZaloAttachmentPolicy, transcriber: ChannelVoiceTranscriber | undefined): Promise<ChannelAudioTranscriptResult> {
  if (!isAudioAttachmentKind(attachment.kind)) {
    return {};
  }

  const providedTranscript = buildChannelProvidedAudioTranscriptResult({ transcript: attachment.providedTranscript, maxBytes: policy.previewMaxBytes });
  if (providedTranscript) {
    return providedTranscript;
  }

  if (policy.transcriptionPolicy !== "allow") {
    return {};
  }

  if (bytes.byteLength > policy.transcriptionMaxBytes) {
    return { transcriptionWarning: `Skipped audio transcription because the file exceeds transcriptionMaxBytes (${policy.transcriptionMaxBytes} bytes).` };
  }

  if (!transcriber) {
    return { transcriptionWarning: "Transcription is allowed by config, but no transcriber is configured in this runtime." };
  }

  try {
    const result = await transcriber({ bytes, localPath, mimeType: attachment.mimeType, kind: attachment.kind, duration: attachment.duration });
    return buildChannelProvidedAudioTranscriptResult({ transcript: { text: result.text, source: "provider" }, maxBytes: policy.previewMaxBytes }) ?? {};
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown transcription error";
    return { transcriptionWarning: `Could not transcribe audio attachment: ${message}` };
  }
}

function attachZaloVisionImage(messages: ChatMessage[], userInput: string, dataUrl: string): void {
  const currentUserMessage = messages.at(-1);
  if (!currentUserMessage || currentUserMessage.role !== "user") {
    return;
  }

  currentUserMessage.content = buildZaloVisionContent(userInput, dataUrl);
}

function buildZaloVisionContent(userInput: string, dataUrl: string): ChatMessageContent {
  return [
    { type: "text", text: userInput },
    { type: "image_url", image_url: { url: dataUrl } },
  ];
}

function inferZaloAttachmentKind(record: Record<string, unknown> | undefined): ZaloAttachmentKind | undefined {
  const kind = record ? firstString(record, ["kind", "type", "media_type", "mediaType", "attachment_type", "attachmentType"])?.toLowerCase() : undefined;
  if (kind?.includes("photo") || kind?.includes("image")) return "photo";
  if (kind?.includes("voice")) return "voice";
  if (kind?.includes("audio")) return "audio";
  if (kind?.includes("video")) return "video";
  if (kind?.includes("sticker")) return "sticker";
  if (kind?.includes("file") || kind?.includes("document")) return "document";
  return undefined;
}

function normalizeZaloFileInfo(value: unknown, fallbackFileId: string): ZaloFileInfo {
  const record = asRecord(value);
  if (!record) {
    return { fileId: fallbackFileId };
  }

  return {
    fileId: firstString(record, ["file_id", "fileId", "id"]) ?? fallbackFileId,
    ...optionalStringProperty("filePath", firstString(record, ["file_path", "filePath", "file_url", "fileUrl", "download_url", "downloadUrl", "url", "href", "path"])),
    ...optionalNumberProperty("fileSize", firstNumber(record, ["file_size", "fileSize", "size", "bytes"])),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function optionalStringProperty<TKey extends string>(key: TKey, value: string | undefined): { [K in TKey]: string } | Record<string, never> {
  return value === undefined ? {} : { [key]: value } as { [K in TKey]: string };
}

function optionalNumberProperty<TKey extends string>(key: TKey, value: number | undefined): { [K in TKey]: number } | Record<string, never> {
  return value === undefined ? {} : { [key]: value } as { [K in TKey]: number };
}

async function handleZaloSlashCommand(text: string, chatId: string, userId: string, options: ZaloUpdateHandlerOptions, channel: ZaloRuntimeChannel = "zalo", threadType: 0 | 1 = 0): Promise<boolean> {
  const sendMessage = (message: string) => options.client.sendMessage(chatId, message, { threadType });
  const reasoningKey = `${channel}:${chatId}:${userId}`;
  if (text === "/reasoning") {
    const level = zaloReasoningLevels.get(reasoningKey) ?? "off";
    await sendMessage(`🧠 Suy luận: ${formatReasoningLevel(level)}\n${formatReasoningCommandHelp()}`);
    return true;
  }
  if (text.startsWith("/reasoning ")) {
    const level = parseReasoningLevel(text.slice("/reasoning ".length));
    if (!level) {
      await sendMessage(`⚠️ Mức suy luận không hợp lệ.\n${formatReasoningCommandHelp()}`);
      return true;
    }
    zaloReasoningLevels.set(reasoningKey, level);
    await sendMessage(`🧠 Đã đặt suy luận: ${formatReasoningLevel(level)}.`);
    return true;
  }
  if (await handleCronChannelCommand({ text, paths: options.paths, channel, userId: chatId, sendMessage: (message) => sendMessage(message).then(() => undefined) })) {
    return true;
  }

  if (text === "/status") {
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const state = store.getMemoryState();
      const activeCount = store.listActiveMemories().length;
      const pendingCount = store.listPendingMemories().length;
      const providerHealth = await formatProviderFallbackHealth(options.paths);
      await sendMessage([`Status -> memory ${state.paused ? "paused" : "active"}; active ${activeCount}; pending ${pendingCount}`, providerHealth].filter(Boolean).join("; "));
      return true;
    } finally {
      store.close();
    }
  }

  if (text === "/providers") {
    await sendMessage(await formatProviderFallbackDiagnostics(options.paths));
    return true;
  }

  if (text === "/approvals") {
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const approvals = store.listPendingActionApprovals(channel, userId, 5);
      await sendMessage(approvals.length === 0 ? "No pending action approvals." : `Pending approvals:\n${approvals.map(formatPendingApprovalSummary).join("\n\n")}`);
      return true;
    } finally {
      store.close();
    }
  }

  const approvalDecision = parseZaloApprovalDecision(text);
  if (approvalDecision) {
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const pendingApproval = store.getPendingActionApprovalById(approvalDecision.id);
      if (pendingApproval?.userId && pendingApproval.userId !== userId) {
        await sendMessage(`Approval request ${approvalDecision.id} belongs to another owner.`);
        return true;
      }
      const approval = approvalDecision.decision === "approve" ? store.approvePendingActionApproval(approvalDecision.id) : store.denyPendingActionApproval(approvalDecision.id);
      if (!approval) {
        await sendMessage(`Approval request ${approvalDecision.id} is no longer pending. It may have already been handled or expired.`);
        return true;
      }
      const actionResult = await executeApprovedAction(store, approval, approvalDecision.decision, { config: options.config, paths: options.paths, outboundFileSender: createZaloOutboundFileSender(options.client, chatId, channel, threadType) });
      await sendMessage(actionResult.message);
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
        await sendMessage("No active memories.");
        return true;
      }

      await sendZaloTextChunks(options.client, chatId, `Active memories (${memories.length}):\n${formatMemoryList(memories)}`, threadType);
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand === "tiers") {
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      await sendZaloTextChunks(options.client, chatId, formatMemoryTiersReport({ memories: store.listActiveMemories(), plan: await planMemoryHygieneTool({ paths: options.paths }), channelCommandPrefix: "/memory" }), threadType);
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand === "rebalance" || memoryCommand === "rebalance_apply" || memoryCommand === "rebalance_apply_confirm") {
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const plan = planMemoryRebalance(store.listActiveMemories());
      const deletePolicy = options.config.memory?.deletePolicy ?? "ask";

      if (memoryCommand === "rebalance") {
        await sendZaloTextChunks(options.client, chatId, formatMemoryRebalancePlan({ plan, channelCommandPrefix: "/memory" }), threadType);
        return true;
      }

      if (deletePolicy === "deny") {
        await sendMessage("memory.deletePolicy is deny. No memories were moved.");
        return true;
      }

      if (deletePolicy === "ask" && memoryCommand !== "rebalance_apply_confirm") {
        await sendZaloTextChunks(options.client, chatId, `${formatMemoryRebalancePlan({ plan, channelCommandPrefix: "/memory" })}\nCONFIRM: reply /memory rebalance apply confirm to move non-review-only memories.`, threadType);
        return true;
      }

      await sendZaloTextChunks(options.client, chatId, formatMemoryRebalanceApplyResult(applyMemoryRebalancePlan(store, plan)), threadType);
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand === "digest") {
    await sendMessage("Running memory maintenance digest...");
    const result = await runMemoryMaintenanceDigest({ config: options.config, paths: options.paths });
    await sendZaloTextChunks(options.client, chatId, result.ok ? result.output : `Digest failed: ${result.reason}`, threadType);
    return true;
  }

  if (memoryCommand === "summary") {
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const memories = store.listActiveMemories();
      const plan = await planMemoryHygieneTool({ paths: options.paths });
      const rebalance = planMemoryRebalance(memories);
      const trendResult = await readMemoryHygieneTrendTool({ paths: options.paths });
      const trend = trendResult.latest && trendResult.baseline && trendResult.latest.id !== trendResult.baseline.id
        ? { previousScore: trendResult.baseline.score, delta: trendResult.delta, direction: trendResult.direction }
        : undefined;
      await sendZaloTextChunks(options.client, chatId, formatMemorySummary({
        memories,
        plan,
        rebalance,
        trend,
        deletePolicy: options.config.memory?.deletePolicy ?? "ask",
        retrievalPolicy: options.config.memory?.retrievalPolicy ?? "full",
        channelCommandPrefix: "/memory",
      }), threadType);
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand?.startsWith("scope:")) {
    const scope = memoryCommand.split(":")[1];
    if (!isMemoryScope(scope)) {
      await sendMessage("Usage: /memory scope core|project|session");
      return true;
    }

    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const memories = store.listActiveMemoriesByScope(scope);
      const header = `Active memories / ${scope} (${memories.length})`;
      await sendZaloTextChunks(options.client, chatId, memories.length === 0 ? `No active memories in ${scope} scope.` : `${header}:\n${formatMemoryList(memories)}`, threadType);
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand?.startsWith("inspect:")) {
    const id = Number(memoryCommand.split(":")[1]);
    if (!Number.isSafeInteger(id) || id <= 0) {
      await sendMessage("Usage: /memory inspect <id>");
      return true;
    }

    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const memory = store.getActiveMemory(id);
      await sendZaloTextChunks(options.client, chatId, memory ? formatMemoryInspect(memory) : `No active memory found for id ${id}.`, threadType);
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand === "analyze" || memoryCommand === "cleanup_dry_run") {
    const analysis = await analyzeMemoriesTool({ paths: options.paths, mode: "all" });
    const message = memoryCommand === "analyze" ? formatMemoryAnalysisReport(analysis) : formatMemoryCleanupDryRunReport(analysis);
    await sendZaloTextChunks(options.client, chatId, message, threadType);
    return true;
  }

  if (memoryCommand === "hygiene") {
    await sendZaloTextChunks(options.client, chatId, formatMemoryHygieneReport(await planMemoryHygieneTool({ paths: options.paths })), threadType);
    return true;
  }

  if (memoryCommand === "hygiene_status") {
    const plan = await planMemoryHygieneTool({ paths: options.paths });
    const score = calculateMemoryHygieneScore(plan);
    const trend = await recordMemoryHygieneSnapshot({ paths: options.paths, plan, score, source: "zalo:status" });
    await sendZaloTextChunks(options.client, chatId, formatMemoryHygieneStatus({ plan, deletePolicy: options.config.memory?.deletePolicy ?? "ask", retrievalPolicy: options.config.memory?.retrievalPolicy ?? "full", channelCommand: "/memory hygiene apply", trend }), threadType);
    return true;
  }

  if (memoryCommand === "hygiene_trend") {
    await sendZaloTextChunks(options.client, chatId, formatMemoryHygieneTrendReport(await readMemoryHygieneTrendTool({ paths: options.paths })), threadType);
    return true;
  }

  if (memoryCommand === "hygiene_doctor") {
    const plan = await planMemoryHygieneTool({ paths: options.paths });
    const report = await buildMemoryHygieneDoctorReport({ paths: options.paths, plan, deletePolicy: options.config.memory?.deletePolicy ?? "ask", retrievalPolicy: options.config.memory?.retrievalPolicy ?? "full" });
    const trend = await recordMemoryHygieneSnapshot({ paths: options.paths, plan, score: report.score, source: "zalo:doctor" });
    await sendZaloTextChunks(options.client, chatId, formatMemoryHygieneDoctorReport(report, trend), threadType);
    return true;
  }

  if (memoryCommand === "hygiene_apply" || memoryCommand === "hygiene_apply_confirm") {
    await sendZaloTextChunks(options.client, chatId, await applyMemoryHygienePlanForChannel({ plan: await planMemoryHygieneTool({ paths: options.paths }), paths: options.paths, deletePolicy: options.config.memory?.deletePolicy ?? "ask", confirmed: memoryCommand === "hygiene_apply_confirm" }), threadType);
    return true;
  }

  if (memoryCommand === "governance_status") {
    const analysis = await analyzeMemoriesTool({ paths: options.paths, mode: "all" });
    await sendZaloTextChunks(options.client, chatId, formatMemoryGovernanceStatus(analysis, options.config.memory?.retrievalPolicy ?? "full"), threadType);
    return true;
  }

  if (memoryCommand?.startsWith("pin:") || memoryCommand?.startsWith("unpin:")) {
    const [action, rawId] = memoryCommand.split(":");
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      await sendMessage("Usage: /memory pin <id> or /memory unpin <id>");
      return true;
    }

    const pinned = action === "pin";
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const updated = store.setMemoryPinned(id, pinned);
      await sendMessage(updated ? `Memory ${pinned ? "pinned" : "unpinned"}: #${updated.id}` : `No active memory found for id ${id}.`);
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand?.startsWith("move:")) {
    const [, rawId, scope] = memoryCommand.split(":");
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0 || !isMemoryScope(scope)) {
      await sendMessage("Usage: /memory move <id> core|project|session");
      return true;
    }

    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const updated = store.setMemoryScope(id, scope);
      await sendMessage(updated ? `Memory #${updated.id} moved to ${updated.scope}.` : `No active memory found for id ${id}.`);
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand?.startsWith("supersede:")) {
    const [, rawOldId, rawNewId] = memoryCommand.split(":");
    const oldId = Number(rawOldId);
    const newId = Number(rawNewId);
    if (!Number.isSafeInteger(oldId) || oldId <= 0 || !Number.isSafeInteger(newId) || newId <= 0) {
      await sendMessage("Usage: /memory supersede <oldId> <newId>");
      return true;
    }

    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const updated = store.supersedeMemory(oldId, newId);
      await sendMessage(updated ? `Memory #${updated.id} superseded by #${updated.supersededBy}.` : "Could not supersede memory. Make sure both ids are active and different.");
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand?.startsWith("governance_policy:")) {
    const policy = memoryCommand.split(":")[1];
    if (!isMemoryRetrievalPolicy(policy)) {
      await sendMessage("Usage: /memory governance policy full|governed");
      return true;
    }

    await setMemoryRetrievalPolicy(policy, options.paths);
    await sendMessage(formatMemoryRetrievalPolicyUpdated(policy));
    return true;
  }

  if (memoryCommand?.startsWith("maintenance:")) {
    const action = memoryCommand.split(":")[1];
    const destination = `zalo:${chatId}`;

    if (action === "install") {
      const result = await installMemoryMaintenanceReport({ paths: options.paths, channel: destination, timeZone: options.config.agent.timeZone });
      await sendMessage(result.ok ? formatMemoryMaintenanceInstalled(result.schedule) : result.reason);
      return true;
    }

    if (action === "status") {
      await sendMessage(formatMemoryMaintenanceStatus(await getMemoryMaintenanceReportStatus(options.paths)));
      return true;
    }

    if (action === "remove") {
      await sendMessage(formatMemoryMaintenanceRemoved(await removeMemoryMaintenanceReport(options.paths)));
      return true;
    }
  }

  if (memoryCommand === "pending") {
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const memories = store.listPendingMemories(5);
      await sendMessage(memories.length === 0 ? "No pending memories." : `Pending memories:\n${memories.map((memory) => `${memory.id}. [${memory.type}] ${memory.content}\n   Reason: ${memory.reason || "needs review"}`).join("\n")}`);
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand?.startsWith("graph_pending_sanitize:")) {
    const id = Number(memoryCommand.split(":")[1]);
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      await sendZaloTextChunks(options.client, chatId, formatPendingKnowledgeSanitizeResult(id, store.sanitizePendingKnowledgeItem(id), "/memory graph"), threadType);
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
      await sendMessage(`Memory ${paused ? "paused" : "resumed"}.`);
      return true;
    } finally {
      store.close();
    }
  }

  return false;
}

function createZaloPermissionApprover(client: ZaloClient, chatId: string, userId: string, paths: RuntimePaths, channel: ZaloRuntimeChannel = "zalo", threadType: 0 | 1 = 0): PermissionApprover {
  return createChannelActionPermissionApprover({
    paths,
    channel,
    userId,
    ttlMs: ZALO_ACTION_APPROVAL_TTL_MS,
    send: async (approvalId, request, proposed) => {
      await client.sendMessage(chatId, [
        `Approval needed. Request: ${approvalId}`,
        `Action: ${request.action}`,
        `Category: ${request.category}`,
        request.target ? `Target: ${request.target}` : undefined,
        request.reason ? `Reason: ${request.reason}` : undefined,
        `Policy: ${proposed.reason}`,
        `Reply /approve ${approvalId} or /deny ${approvalId}.`,
      ].filter(Boolean).join("\n"), { threadType });
    },
    pendingReason: (approvalId) => `Approval request ${approvalId} is pending in Zalo.`,
  });
}

async function handleZaloToolActivity(response: ReturnType<typeof createChannelResponseController>, activity: AgentToolActivity, agentName: string): Promise<void> {
  if (!shouldShowToolProgress(activity)) {
    return;
  }
  if (activity.callIndex !== 1 && activity.callIndex % ZALO_TOOL_PROGRESS_EVERY !== 0) {
    return;
  }
  await response.showProgress(formatChannelToolProgress(activity, agentName));
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

async function runZaloKnowledgeReasoningPass(options: Parameters<typeof runKnowledgeReasoningPass>[0]): Promise<KnowledgeReasoningResult> {
  try {
    return await runKnowledgeReasoningPass(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown knowledge reasoning error.";
    await appendLog({ event: "knowledge_reasoning_failure", detail: { channel: "zalo", message } }, { paths: options.paths, knownSecrets: [options.apiKey] });
    return { storedEntities: [], storedRelations: [], pending: [], skipped: [] };
  }
}

async function runZaloConversationSummaryPass(options: Parameters<typeof refreshConversationSummary>[0]): Promise<void> {
  try {
    await refreshConversationSummary(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown conversation summary error.";
    await appendLog({ event: "conversation_summary_failure", detail: { channel: options.channel, message } }, { paths: options.paths, knownSecrets: [options.apiKey] });
  }
}

async function sendZaloMemoryReasoningApprovalsIfNeeded(
  client: ZaloClient,
  chatId: string,
  paths: RuntimePaths,
  ownerUserId: string,
  result: MemoryReasoningResult,
  channel: ZaloRuntimeChannel = "zalo",
  threadType: 0 | 1 = 0,
): Promise<void> {
  for (const pending of result.pending) {
    const store = await SqliteMemoryStore.open(paths);
    let approvalId: number;

    try {
      approvalId = store.addPendingActionApproval({
        channel,
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
      ].filter(Boolean).join("\n")), { threadType });
  }
}

async function sendZaloKnowledgeReasoningApprovalsIfNeeded(
  client: ZaloClient,
  chatId: string,
  paths: RuntimePaths,
  ownerUserId: string,
  result: KnowledgeReasoningResult,
  channel: ZaloRuntimeChannel = "zalo",
  threadType: 0 | 1 = 0,
): Promise<void> {
  for (const pending of result.pending) {
    const store = await SqliteMemoryStore.open(paths);
    let approvalId: number;

    try {
      approvalId = store.addPendingActionApproval({
        channel,
        userId: ownerUserId,
        category: "local_write",
        action: "knowledge_approve",
        target: `pending-knowledge:${pending.id}`,
        reason: "Approve or deny a knowledge graph item inferred from the latest conversation.",
        proposedReason: pending.reason ?? "Knowledge graph reasoning proposed this item.",
      }).id;
    } finally {
      store.close();
    }

    await client.sendMessage(
      chatId,
      redactSecrets([
        `Knowledge graph approval needed. Request: ${approvalId}`,
        formatPendingKnowledgePayloadSummary(pending.payload),
        pending.reason ? `Reason: ${pending.reason}` : undefined,
        `Reply /approve ${approvalId} to save it or /deny ${approvalId} to reject it.`,
      ].filter(Boolean).join("\n")), { threadType });
  }
}

async function sendZaloMemoryApprovalIfNeeded(
  client: ZaloClient,
  chatId: string,
  paths: RuntimePaths,
  ownerUserId: string,
  toolName: string,
  result: { ok: boolean; result?: unknown },
  channel: ZaloRuntimeChannel = "zalo",
  threadType: 0 | 1 = 0,
): Promise<void> {
  if (toolName !== "internal.remember_memory" || !result.ok || !isPendingToolResult(result.result)) {
    return;
  }

  const store = await SqliteMemoryStore.open(paths);
  let approvalId: number;
  let content = "";
  let type = "memory";

  try {
    const pending = store.getPendingMemoryById(result.result.id);
    if (!pending) {
      return;
    }
    content = pending.content;
    type = pending.type;
    approvalId = store.addPendingActionApproval({
      channel,
      userId: ownerUserId,
      category: "local_write",
      action: "memory_approve",
      target: `pending-memory:${pending.id}`,
      reason: "Approve or deny model-requested memory write.",
      proposedReason: pending.reason ?? "Memory write policy is ask.",
      ttlMs: ZALO_ACTION_APPROVAL_TTL_MS,
    }).id;
  } finally {
    store.close();
  }

  await client.sendMessage(chatId, [`Memory approval needed. Request: ${approvalId}`, `Type: ${type}`, `Content: ${content}`, `Reply /approve ${approvalId} to save it or /deny ${approvalId} to reject it.`].join("\n"), { threadType });
}

async function sendZaloKnowledgeApprovalIfNeeded(
  client: ZaloClient,
  chatId: string,
  paths: RuntimePaths,
  ownerUserId: string,
  toolName: string,
  result: { ok: boolean; result?: unknown },
  channel: ZaloRuntimeChannel = "zalo",
  threadType: 0 | 1 = 0,
): Promise<void> {
  if (toolName !== "internal.remember_knowledge" || !result.ok || !isPendingToolResult(result.result)) {
    return;
  }

  const store = await SqliteMemoryStore.open(paths);
  let approvalId: number;
  let summary = "Payload unavailable.";

  try {
    const pending = store.getPendingKnowledgeItem(result.result.id);
    if (!pending) {
      return;
    }
    summary = formatPendingKnowledgePayloadSummary(pending.payload);
    approvalId = store.addPendingActionApproval({
      channel,
      userId: ownerUserId,
      category: "local_write",
      action: "knowledge_approve",
      target: `pending-knowledge:${pending.id}`,
      reason: "Approve or deny model-requested knowledge graph write.",
      proposedReason: pending.reason ?? "Knowledge graph write policy is ask.",
      ttlMs: ZALO_ACTION_APPROVAL_TTL_MS,
    }).id;
  } finally {
    store.close();
  }

  await client.sendMessage(chatId, [`Knowledge graph approval needed. Request: ${approvalId}`, summary, `Reply /approve ${approvalId} to save it or /deny ${approvalId} to reject it.`].join("\n"), { threadType });
}

async function sendZaloTextChunks(client: ZaloClient, chatId: string, text: string, threadType: 0 | 1 = 0): Promise<void> {
  for (const chunk of splitZaloMessageText(text)) {
    await client.sendMessage(chatId, chunk, { threadType });
  }
}

export function splitZaloMessageText(text: string): string[] {
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

async function loadRecentZaloTurns(paths: RuntimePaths, userId: string, recentMessageLimit: number, channel: ZaloRuntimeChannel = "zalo"): Promise<ChatMessage[]> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    if (store.getMemoryState().paused) {
      return [];
    }
    return store.listRecentMessagesForChannel(channel, userId, recentMessageLimit).map((message) => ({ role: message.role, content: message.content }));
  } finally {
    store.close();
  }
}

async function persistZaloConversationTurn(paths: RuntimePaths, userId: string, userInput: string, assistantText: string, channel: ZaloRuntimeChannel = "zalo"): Promise<void> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    if (store.getMemoryState().paused) {
      return;
    }
    store.addMessage({ channel, userId, role: "user", content: userInput });
    store.addMessage({ channel, userId, role: "assistant", content: assistantText });
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

function buildZaloRuntimeToolContext(incoming: ChannelIncomingMessage<string, string | number | undefined, ZaloMessage>, ownerUserId: string, channel: ZaloRuntimeChannel = "zalo"): string {
  const cronDestination = channel === "zalo-personal" && incoming.raw.chat?.type === "group" ? "zalo-personal-group" : channel;
  return `Current channel: ${channel}. Current Zalo chat id: ${incoming.chatId}. Current owner/user id: ${ownerUserId}. internal.send_photo and internal.send_file can send generated or local workspace files back to this chat; omit arguments.channel for this chat or set it to "${channel}:${incoming.chatId}" explicitly. For internal.add_cron_schedule, the report destination is automatically bound to "${cronDestination}:${incoming.chatId}"; do not ask the user to provide a channel or recipient.`;
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

export function stripMarkdown(text: string): string {
  return text
    .replace(/```(?:[a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, "")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function toZaloDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
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

async function sendZaloChatActionBestEffort(client: ZaloClient, chatId: string, action: "typing", threadType: 0 | 1 = 0): Promise<void> {
  try {
    await client.sendChatAction(chatId, action, threadType);
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

function parseZaloMemoryCommand(text: string): "list" | "tiers" | "rebalance" | "rebalance_apply" | "rebalance_apply_confirm" | "summary" | "digest" | "pending" | `graph_pending_sanitize:${number}` | "pause" | "resume" | "analyze" | "cleanup_dry_run" | "hygiene" | "hygiene_status" | "hygiene_trend" | "hygiene_doctor" | "hygiene_apply" | "hygiene_apply_confirm" | "governance_status" | `governance_policy:${string}` | `pin:${number}` | `unpin:${number}` | `scope:${string}` | `inspect:${number}` | `move:${number}:${string}` | `supersede:${number}:${number}` | "maintenance:install" | "maintenance:status" | "maintenance:remove" | undefined {
  if (text === "/memory" || text === "/memory list" || text === "/memory status") {
    return "list";
  }
  if (text === "/memory pending") {
    return "pending";
  }
  const graphPendingSanitizeMatch = text.match(/^\/(?:memory graph|graph) pending sanitize (\d+)$/);
  if (graphPendingSanitizeMatch) {
    return `graph_pending_sanitize:${Number(graphPendingSanitizeMatch[1])}`;
  }
  if (text === "/memory tiers") {
    return "tiers";
  }
  if (text === "/memory rebalance" || text === "/memory rebalance dry-run" || text === "/memory rebalance --dry-run") {
    return "rebalance";
  }
  if (text === "/memory rebalance apply") {
    return "rebalance_apply";
  }
  if (text === "/memory rebalance apply confirm") {
    return "rebalance_apply_confirm";
  }
  if (text === "/memory analyze") {
    return "analyze";
  }
  if (text === "/memory cleanup dry-run" || text === "/memory cleanup --dry-run") {
    return "cleanup_dry_run";
  }
  if (text === "/memory digest") {
    return "digest";
  }
  if (text === "/memory summary") {
    return "summary";
  }
  if (text === "/memory hygiene" || text === "/memory hygiene dry-run") {
    return "hygiene";
  }
  if (text === "/memory hygiene status") {
    return "hygiene_status";
  }
  if (text === "/memory hygiene trend") {
    return "hygiene_trend";
  }
  if (text === "/memory hygiene doctor") {
    return "hygiene_doctor";
  }
  if (text === "/memory hygiene apply") {
    return "hygiene_apply";
  }
  if (text === "/memory hygiene apply confirm") {
    return "hygiene_apply_confirm";
  }
  if (text === "/memory governance" || text === "/memory governance status") {
    return "governance_status";
  }
  const governancePolicyMatch = text.match(/^\/memory governance policy (\S+)$/);
  if (governancePolicyMatch) {
    return `governance_policy:${governancePolicyMatch[1]}`;
  }
  const pinMatch = text.match(/^\/memory (pin|unpin) (\d+)$/);
  if (pinMatch) {
    return `${pinMatch[1]}:${Number(pinMatch[2])}` as `pin:${number}` | `unpin:${number}`;
  }
  const scopeMatch = text.match(/^\/memory scope (\S+)$/);
  if (scopeMatch) {
    return `scope:${scopeMatch[1]}`;
  }
  const inspectMatch = text.match(/^\/memory inspect (\d+)$/);
  if (inspectMatch) {
    return `inspect:${Number(inspectMatch[1])}`;
  }
  const moveMatch = text.match(/^\/memory move (\d+) (\S+)$/);
  if (moveMatch) {
    return `move:${Number(moveMatch[1])}:${moveMatch[2]}`;
  }
  const supersedeMatch = text.match(/^\/memory supersede (\d+) (\d+)$/);
  if (supersedeMatch) {
    return `supersede:${Number(supersedeMatch[1])}:${Number(supersedeMatch[2])}`;
  }
  if (text === "/memory maintenance install") {
    return "maintenance:install";
  }
  if (text === "/memory maintenance" || text === "/memory maintenance status") {
    return "maintenance:status";
  }
  if (text === "/memory maintenance remove" || text === "/memory maintenance uninstall") {
    return "maintenance:remove";
  }
  if (text === "/memory pause" || text === "/pause_memory" || text === "/pause-memory") {
    return "pause";
  }
  if (text === "/memory resume" || text === "/resume_memory" || text === "/resume-memory") {
    return "resume";
  }
  return undefined;
}

interface ZaloJsonResponse {
  ok?: boolean;
  result?: unknown;
  description?: unknown;
  error_code?: unknown;
}

async function readJsonResponse(response: Response): Promise<ZaloJsonResponse> {
  try {
    return await response.json() as ZaloJsonResponse;
  } catch {
    return { ok: response.ok, description: response.statusText };
  }
}

function isPendingToolResult(value: unknown): value is { id: number; status: "pending" } {
  return typeof value === "object" && value !== null && "id" in value && "status" in value && Number.isInteger((value as { id: unknown }).id) && (value as { status: unknown }).status === "pending";
}

function formatPendingKnowledgePayloadSummary(payload: unknown): string {
  const text = JSON.stringify(payload);
  if (!text) {
    return "Payload: empty";
  }
  return `Payload: ${text.length > 500 ? `${text.slice(0, 497)}...` : text}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
