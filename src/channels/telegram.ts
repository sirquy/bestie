import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Bot, InputFile } from "grammy";
import type { BotCommand, InlineKeyboardMarkup, MaybeInaccessibleMessage, UserFromGetMe, Update } from "@grammyjs/types";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

import { matchesOwnerId, type OwnerUserIdConfig } from "./owner-policy.js";
import { loadSystemPrompt } from "../character/prompt-loader.js";
import { buildChatMessages, getRecentMessageLimit } from "../chat/message-builder.js";
import {
  buildMcpToolSystemPrompt,
  completeWithAgentTools,
  runAgentToolRequest,
  type AgentToolActivity,
  type RunAgentToolRequestOptions,
} from "../chat/mcp-tool-use.js";
import type { ChatCompletionOptions, ChatMessage, ChatMessageContent } from "../llm/types.js";
import { sendChatCompletionWithFallbacks } from "../llm/chat-completion.js";
import { fallbackLogDetail, formatProviderFallbackDiagnostics, formatProviderFallbackHealth } from "../llm/fallbacks.js";
import { runKnowledgeReasoningPass, type KnowledgeReasoningResult } from "../memory/knowledge-reasoning.js";
import { loadConversationSummaryContext, refreshConversationSummary } from "../memory/conversation-summary.js";
import { loadRelevantMemories } from "../memory/context.js";
import { loadRelevantKnowledgeGraph } from "../memory/knowledge-context.js";
import { runMemoryReasoningPass, type MemoryReasoningResult } from "../memory/reasoning.js";
import { isMemoryRetrievalPolicy, setMemoryRetrievalPolicy } from "../memory/governance.js";
import { getMemoryMaintenanceReportStatus, installMemoryMaintenanceReport, removeMemoryMaintenanceReport, runMemoryMaintenanceDigest } from "../memory/maintenance.js";
import { buildMemoryHygieneDoctorReport, formatMemoryHygieneDoctorReport } from "../memory/hygiene-doctor.js";
import { calculateMemoryHygieneScore } from "../memory/hygiene-score.js";
import { formatMemoryHygieneStatus } from "../memory/hygiene-status.js";
import { formatMemoryHygieneTrendReport, recordMemoryHygieneSnapshot } from "../memory/hygiene-trend.js";
import { isMemoryScope, SqliteMemoryStore } from "../memory/sqlite-store.js";
import { applyMemoryRebalancePlan, formatMemoryRebalanceApplyResult, formatMemoryRebalancePlan, planMemoryRebalance } from "../memory/rebalance.js";
import { formatMemorySummary } from "../memory/summary.js";
import { formatMemoryTiersReport } from "../memory/tiers.js";
import type { AppConfig } from "../runtime/config.js";
import { loadLlmCandidateSecret, resolvePrimaryLlmCandidate } from "../llm/resolve-config.js";
import { appendLog, redactSecrets } from "../runtime/logger.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { runDoctor, type DoctorReport } from "../runtime/doctor.js";
import { validateDoctorReportContract } from "../runtime/doctor-report-contract.js";
import { executeApprovedAction } from "../safety/approval-executor.js";
import { handleCronChannelCommand } from "../cron/channel-commands.js";
import { analyzeMemoriesTool, planMemoryHygieneTool, readMemoryHygieneTrendTool } from "../tools/local-read-tools.js";
import type { ActionPermissionRequest, ActionPermissionResult, PermissionApprover, PermissionPolicy } from "../safety/permission-policy.js";
import { buildChannelAttachmentPreview, type AttachmentContentParser } from "./attachment-preview.js";
import { ProviderAuthError, ProviderFallbackError, ProviderNetworkError, ProviderRateLimitError, ProviderResponseError, ProviderTimeoutError } from "../llm/errors.js";
import type { ChannelIncomingMessage, ChannelOutboundAdapter, ChannelRuntimeAdapter } from "./adapter.js";
import { createChannelActivityController } from "./activity.js";
import { applyMemoryHygienePlanForChannel, formatMemoryAnalysisReport, formatMemoryCleanupDryRunReport, formatMemoryGovernanceStatus, formatMemoryHygieneReport, formatMemoryInspect, formatMemoryMaintenanceInstalled, formatMemoryMaintenanceRemoved, formatMemoryMaintenanceStatus, formatMemoryRetrievalPolicyUpdated, formatPendingKnowledgeSanitizeResult } from "./memory-commands.js";
import { buildChannelAttachmentPrompt } from "./attachment-prompt.js";
import { resolveChannelVisionPolicy } from "./attachment-policy.js";
import { processChannelAttachment } from "./attachment-pipeline.js";
import { buildChannelVisionAttachment, type ChannelVisionAttachment } from "./attachment-vision.js";
import {
  ChannelAttachmentHandlingError,
  applyChannelAttachmentRetention,
  buildChannelAttachmentPath,
  assertChannelAttachmentDownloadAllowed,
  downloadChannelAttachmentBytes,
  formatChannelTranscriptLabel,
  isAudioAttachmentKind,
  persistChannelAttachmentFile,
  type ChannelAttachmentKind,
  type ChannelDownloadedAttachment,
  type ChannelTranscript,
} from "./attachments.js";
import { buildChannelAudioTranscriptResult, buildChannelProvidedAudioTranscriptResult, type ChannelAudioTranscriptResult } from "./audio-transcription.js";
import { TELEGRAM_CHANNEL, formatChannelHelpCommands } from "./registry.js";
import { createChannelResponseController } from "./response-controller.js";
import { formatChannelToolProgress, shouldShowToolProgress } from "./tool-progress.js";
import type { AgentOutboundFileSender } from "../tools/channel-send-tools.js";

export type TelegramUpdate = Update;
type TelegramChatAction = Parameters<Bot["api"]["sendChatAction"]>[1];
const execFileAsync = promisify(execFile);


export interface TelegramClient {
  getMe?(): Promise<UserFromGetMe>;
  getUpdates(offset: number | undefined): Promise<TelegramUpdate[]>;
  getFile?(fileId: string): Promise<TelegramFileInfo>;
  downloadFile?(filePath: string): Promise<Uint8Array>;
  sendMessage(chatId: number, text: string, options?: TelegramSendMessageOptions): Promise<TelegramSentMessage | void>;
  sendPhoto?(chatId: number, photo: Uint8Array, options?: TelegramSendPhotoOptions): Promise<TelegramSentMessage | void>;
  sendDocument?(chatId: number, document: Uint8Array, options?: TelegramSendDocumentOptions): Promise<TelegramSentMessage | void>;
  sendAudio?(chatId: number, audio: Uint8Array, options?: TelegramSendAudioOptions): Promise<void>;
  sendVoice?(chatId: number, voice: Uint8Array, options?: TelegramSendVoiceOptions): Promise<void>;
  editMessageText(chatId: number, messageId: number, text: string): Promise<void>;
  answerCallbackQuery?(callbackQueryId: string, text?: string): Promise<void>;
  sendChatAction(chatId: number, action: TelegramChatAction): Promise<void>;
  setMyCommands(commands: BotCommand[]): Promise<void>;
}

type TelegramMessageDecision =
  | { kind: "ignored" }
  | { kind: "callback" }
  | { kind: "unsupported-attachment"; chatId: number; message: NonNullable<TelegramUpdate["message"]> }
  | { kind: "process"; chatId: number; userId: string; incoming: ChannelIncomingMessage<number, number, NonNullable<TelegramUpdate["message"]>>; attachment: TelegramAttachmentSummary | undefined; text: string };

type TelegramAttachmentPipelineInput = { localPath: string; bytes: Uint8Array };

export interface TelegramSendMessageOptions {
  replyMarkup?: InlineKeyboardMarkup;
}

export interface TelegramSentMessage {
  messageId: number;
}

export interface TelegramSendAudioOptions {
  fileName?: string;
  mimeType?: string;
}

export interface TelegramSendPhotoOptions {
  fileName?: string;
  mimeType?: string;
  caption?: string;
}

export interface TelegramSendDocumentOptions {
  fileName?: string;
  mimeType?: string;
  caption?: string;
}

export interface TelegramSendVoiceOptions {
  fileName?: string;
  mimeType?: string;
}

export interface TelegramFileInfo {
  fileId: string;
  filePath?: string;
  fileSize?: number;
}

export type TelegramAttachmentKind = ChannelAttachmentKind;

interface TelegramAttachmentSummary {
  kind: TelegramAttachmentKind;
  fileId: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  duration?: number;
  emoji?: string;
  providedTranscript?: ChannelTranscript;
}

interface SavedTelegramAttachment extends TelegramAttachmentSummary {
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

export interface TelegramAttachmentParseTelemetry {
  kind: TelegramAttachmentKind;
  mimeType?: string;
  telegramFileSize?: number;
  savedBytes: number;
  contentParser?: AttachmentContentParser;
  hasTextPreview: boolean;
  textPreviewTruncated: boolean;
  hasParseWarning: boolean;
  hasVisionInput: boolean;
  hasAudioTranscript: boolean;
  audioTranscriptTruncated: boolean;
  hasTranscriptionWarning: boolean;
}

interface TelegramAttachmentPolicy {
  downloadPolicy: "allow" | "deny";
  maxBytes: number;
  previewMaxBytes: number;
  parseMaxBytes: number;
  visionPolicy: "allow" | "deny";
  visionMaxBytes: number;
  transcriptionPolicy: "allow" | "deny";
  transcriptionMaxBytes: number;
  deleteAfterProcessingKinds: TelegramAttachmentKind[];
}

export interface TelegramAttachmentTranscriptionInput {
  bytes: Uint8Array;
  localPath: string;
  mimeType?: string;
  kind: Extract<TelegramAttachmentKind, "voice" | "audio">;
  duration?: number;
}

export interface TelegramAttachmentTranscriptionResult {
  text: string;
}

export type TelegramAttachmentTranscriber = (input: TelegramAttachmentTranscriptionInput) => Promise<TelegramAttachmentTranscriptionResult>;

export interface TelegramSpeechSynthesisResult {
  bytes: Uint8Array;
  mimeType: string;
}

export type TelegramSpeechSynthesizer = (text: string) => Promise<TelegramSpeechSynthesisResult>;
export type TelegramSpeechVoiceConverter = (input: TelegramSpeechSynthesisResult, options: { paths: RuntimePaths }) => Promise<TelegramSpeechSynthesisResult>;

const TELEGRAM_BOT_COMMANDS: BotCommand[] = TELEGRAM_CHANNEL.commands
  .filter((command) => command.native)
  .map(({ command, description }) => ({ command, description }));

const DEFAULT_TELEGRAM_POLL_RETRY_DELAY_MS = 2_000;
const DEFAULT_TELEGRAM_POLL_MAX_RETRY_DELAY_MS = 30_000;
const TELEGRAM_TYPING_REFRESH_MS = 4_000;
const TELEGRAM_TOOL_PROGRESS_EVERY = 3;
const TELEGRAM_MESSAGE_CHUNK_LIMIT = 3_500;
const TELEGRAM_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const TELEGRAM_ATTACHMENT_PREVIEW_MAX_BYTES = 16 * 1024;
const TELEGRAM_ATTACHMENT_PARSE_MAX_BYTES = 5 * 1024 * 1024;
const TELEGRAM_ATTACHMENT_VISION_MAX_BYTES = 4 * 1024 * 1024;
const TELEGRAM_ATTACHMENT_TRANSCRIPTION_MAX_BYTES = 10 * 1024 * 1024;
const TELEGRAM_SPEECH_REPLY_MAX_CHARS = 800;
const TELEGRAM_SPEECH_REPLY_COOLDOWN_MS = 30_000;
const TELEGRAM_ACTION_APPROVAL_TTL_MS = 30 * 60 * 1000;
const TELEGRAM_PERMISSION_POLICY: PermissionPolicy = {
  allowTrustedRead: true,
  allowLocalWrite: false,
};
const telegramSpeechReplyLastSentAt = new Map<number, number>();

export interface TelegramPollingOptions {
  config: AppConfig;
  paths: RuntimePaths;
  client: TelegramClient;
  chatCompletion?: TelegramChatCompletionRunner;
  mcpToolRunner?: TelegramMcpToolRunner;
  typingRefreshMs?: number;
  once?: boolean;
  shouldStop?: () => boolean;
  onIdle?: () => Promise<void>;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onAttachmentParsed?: (attachment: TelegramAttachmentParseTelemetry) => Promise<void> | void;
  attachmentTranscriber?: TelegramAttachmentTranscriber;
  speechSynthesizer?: TelegramSpeechSynthesizer;
  speechVoiceConverter?: TelegramSpeechVoiceConverter;
}

export interface TelegramUpdateHandlerOptions {
  config: AppConfig;
  paths: RuntimePaths;
  client: TelegramClient;
  chatCompletion?: TelegramChatCompletionRunner;
  mcpToolRunner?: TelegramMcpToolRunner;
  typingRefreshMs?: number;
  onAttachmentParsed?: (attachment: TelegramAttachmentParseTelemetry) => Promise<void> | void;
  attachmentTranscriber?: TelegramAttachmentTranscriber;
  speechSynthesizer?: TelegramSpeechSynthesizer;
  speechVoiceConverter?: TelegramSpeechVoiceConverter;
}

export type TelegramUpdateResult = "ignored" | "replied";
export type TelegramChatCompletionRunner = (config: AppConfig, apiKey: string, options: ChatCompletionOptions) => Promise<string>;
export type TelegramMcpToolRunner = (
  options: RunAgentToolRequestOptions,
) => Promise<{ ok: boolean; status: "pass" | "warn" | "fail"; message: string; result?: unknown }>;

export function formatTelegramDoctorSummary(report: unknown): string {
  const contract = validateDoctorReportContract(report);

  if (!contract.valid) {
    return `Doctor -> report contract error: ${contract.errors[0] ?? "unknown report error"}`;
  }

  const doctorReport = report as DoctorReport;
  const failed = doctorReport.checks.filter((check) => check.status === "fail");
  const warned = doctorReport.checks.filter((check) => check.status === "warn");
  const detail = failed[0] ?? warned[0];

  return redactSecrets(
    detail ? `Doctor -> ${doctorReport.issueCount} issues; ${detail.status.toUpperCase()} ${detail.name}: ${detail.message}` : "Doctor -> 0 issues found.",
  );
}

export class TelegramHttpClient implements TelegramClient {
  private readonly bot: Bot;

  constructor(
    private readonly botToken: string,
    private readonly fetchImpl?: typeof fetch,
  ) {
    this.bot = new Bot(botToken, fetchImpl ? { client: { fetch: fetchImpl } } : undefined);
  }

  async getMe(): Promise<UserFromGetMe> {
    return this.bot.api.getMe();
  }

  async getUpdates(offset: number | undefined): Promise<TelegramUpdate[]> {
    return this.bot.api.getUpdates({
      timeout: 25,
      ...(offset === undefined ? {} : { offset }),
      allowed_updates: ["message", "callback_query"],
    });
  }

  async getFile(fileId: string): Promise<TelegramFileInfo> {
    const file = await this.bot.api.getFile(fileId);
    return { fileId: file.file_id, filePath: file.file_path, fileSize: file.file_size };
  }

  async downloadFile(filePath: string): Promise<Uint8Array> {
    try {
      const response = await (this.fetchImpl ?? fetch)(`https://api.telegram.org/file/bot${this.botToken}/${filePath}`);
      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      const reason = error instanceof Error && error.message.startsWith("status ") ? error.message : "network error";
      throw new Error(`Telegram file download failed: ${reason}`);
    }
  }

  async sendMessage(chatId: number, text: string, options?: TelegramSendMessageOptions): Promise<TelegramSentMessage | void> {
    const message = await this.bot.api.sendMessage(chatId, formatTelegramMessageText(text), { parse_mode: "HTML", reply_markup: options?.replyMarkup });
    return { messageId: message.message_id };
  }

  async sendPhoto(chatId: number, photo: Uint8Array, options: TelegramSendPhotoOptions = {}): Promise<TelegramSentMessage | void> {
    const message = await this.bot.api.sendPhoto(chatId, new InputFile(Buffer.from(photo), options.fileName ?? "bestie-photo.jpg"), { caption: options.caption ? formatTelegramMessageText(options.caption) : undefined, parse_mode: options.caption ? "HTML" : undefined });
    return { messageId: message.message_id };
  }

  async sendDocument(chatId: number, document: Uint8Array, options: TelegramSendDocumentOptions = {}): Promise<TelegramSentMessage | void> {
    const message = await this.bot.api.sendDocument(chatId, new InputFile(Buffer.from(document), options.fileName ?? "bestie-file.bin"), { caption: options.caption ? formatTelegramMessageText(options.caption) : undefined, parse_mode: options.caption ? "HTML" : undefined });
    return { messageId: message.message_id };
  }

  async sendAudio(chatId: number, audio: Uint8Array, options: TelegramSendAudioOptions = {}): Promise<void> {
    await this.bot.api.sendAudio(chatId, new InputFile(Buffer.from(audio), options.fileName ?? "bestie-reply.mp3"));
  }

  async sendVoice(chatId: number, voice: Uint8Array, options: TelegramSendVoiceOptions = {}): Promise<void> {
    await this.bot.api.sendVoice(chatId, new InputFile(Buffer.from(voice), options.fileName ?? "bestie-reply.ogg"));
  }

  async editMessageText(chatId: number, messageId: number, text: string): Promise<void> {
    await this.bot.api.editMessageText(chatId, messageId, formatTelegramMessageText(text), { parse_mode: "HTML" });
  }

  async sendChatAction(chatId: number, action: TelegramChatAction): Promise<void> {
    await this.bot.api.sendChatAction(chatId, action);
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.bot.api.answerCallbackQuery(callbackQueryId, text ? { text } : undefined);
  }

  async setMyCommands(commands: BotCommand[]): Promise<void> {
    await this.bot.api.setMyCommands(commands);
  }
}

function formatTelegramMessageText(text: string): string {
  return escapeTelegramHtml(text)
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/```(?:\w+)?\n?([\s\S]*?)```/g, "<pre>$1</pre>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]\n]+)]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]+)__/g, "<b>$1</b>");
}

function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function runTelegramPollingLoop(options: TelegramPollingOptions): Promise<void> {
  let offset: number | undefined;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_TELEGRAM_POLL_RETRY_DELAY_MS;
  const maxRetryDelayMs = Math.max(retryDelayMs, options.maxRetryDelayMs ?? DEFAULT_TELEGRAM_POLL_MAX_RETRY_DELAY_MS);
  let consecutiveFailures = 0;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  try {
    await options.client.setMyCommands(TELEGRAM_BOT_COMMANDS);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown Telegram command registration error.";
    await appendLog({ event: "telegram_set_commands_failure", detail: { message: errorMessage } }, { paths: options.paths });
  }

  do {
    let updates: TelegramUpdate[];

    try {
      updates = await options.client.getUpdates(offset);
    } catch (error) {
      consecutiveFailures += 1;
      const delayMs = Math.min(retryDelayMs * 2 ** (consecutiveFailures - 1), maxRetryDelayMs);
      const errorMessage = error instanceof Error ? error.message : "Unknown Telegram polling error.";
      await appendLog({ event: "telegram_polling_failure", detail: { message: errorMessage, consecutiveFailures, retryDelayMs: delayMs } }, { paths: options.paths });

      if (options.once) {
        throw error;
      }

      await sleep(delayMs);
      await options.onIdle?.();
      continue;
    }

    if (consecutiveFailures > 0) {
      await appendLog({ event: "telegram_polling_recovered", detail: { consecutiveFailures } }, { paths: options.paths });
      consecutiveFailures = 0;
    }

    for (const update of updates) {
      await handleTelegramUpdate(update, options);
      offset = update.update_id + 1;
    }

    if (options.once) {
      return;
    }

    await options.onIdle?.();
  } while (!options.shouldStop?.());
}

export async function handleTelegramUpdate(update: TelegramUpdate, options: TelegramUpdateHandlerOptions): Promise<TelegramUpdateResult> {
  const telegramConfig = options.config.channels?.telegram;
  const message = update.message;
  const adapter = createTelegramRuntimeAdapter(update, options);
  const incoming = message ? mapTelegramIncomingMessage(message) : undefined;
  const attachment = incoming ? adapter.attachments?.getAttachment(incoming) : undefined;
  const text = (incoming?.text ?? incoming?.caption ?? "").trim();
  const decision = getTelegramMessageDecision({ enabled: telegramConfig?.enabled, ownerUserId: telegramConfig?.ownerUserId, callbackQuery: update.callback_query, message, incoming, attachment, text });

  if (decision.kind === "ignored") {
    return "ignored";
  }

  if (decision.kind === "callback") {
    return handleTelegramCallbackQuery(update, options);
  }

  if (decision.kind === "unsupported-attachment") {
    await sendTelegramChatActionBestEffort(options.client, decision.chatId, "typing");
    await options.client.sendMessage(decision.chatId, `${options.config.agent.name} received this Telegram attachment type, but cannot save it yet. Please send a text description with it.`);
    return "replied";
  }

  const { chatId, userId } = decision;

  await sendTelegramChatActionBestEffort(options.client, chatId, "typing");

  if (!attachment && text === "/start") {
    await options.client.sendMessage(chatId, `${options.config.agent.name} is online.`);
    return "replied";
  }

  if (!attachment && text === "/help") {
    await options.client.sendMessage(chatId, formatChannelHelpCommands(adapter.descriptor));
    return "replied";
  }

  if (!attachment && await handleTelegramSlashCommand(text, chatId, userId, options)) {
    return "replied";
  }

  if (!attachment && text.startsWith("/")) {
    await options.client.sendMessage(chatId, `Unknown command: ${text}. Try /help.`);
    return "replied";
  }

  const chatCompletion = options.chatCompletion ?? ((config, _apiKeyValue, requestOptions) => sendChatCompletionWithFallbacks(config, { ...requestOptions, stream: requestOptions.stream ?? true }, { paths: options.paths }));
  const mcpToolRunner = options.mcpToolRunner ?? runAgentToolRequest;
  const apiKey = await loadLlmCandidateSecret(resolvePrimaryLlmCandidate(options.config), options.paths);
  const typing = createChannelActivityController(adapter.outbound.createActivityOptions(chatId, "typing"));
  typing.start();

  try {
    const savedAttachment = decision.attachment ? await adapter.attachments?.processAttachment(decision.attachment, decision.incoming) as SavedTelegramAttachment | undefined : undefined;
    if (savedAttachment) {
      await options.onAttachmentParsed?.(summarizeTelegramAttachmentParse(savedAttachment));
    }
    const userInput = savedAttachment ? buildTelegramAttachmentUserInput(text, savedAttachment) : text;
    const systemPrompt = await loadSystemPrompt(options.paths);
    const memories = await loadRelevantMemories(options.paths, { query: userInput });
    const recentMessageLimit = getRecentMessageLimit(options.config);
    const recentTurns = await loadRecentTelegramTurns(options.paths, userId, recentMessageLimit);
    const knowledgeGraph = await loadRelevantKnowledgeGraph(options.paths, userInput);
    const conversationSummary = await loadConversationSummaryContext(options.paths, "telegram", userId);
    const messages = buildChatMessages(buildMcpToolSystemPrompt(systemPrompt, options.config, buildTelegramRuntimeToolContext(decision.incoming)), recentTurns, userInput, memories, { memoryRetrievalPolicy: options.config.memory?.retrievalPolicy ?? "full", knowledgeGraph, conversationSummary, recentMessageLimit });
    if (savedAttachment?.visionImage) {
      attachTelegramVisionImage(messages, userInput, savedAttachment.visionImage.dataUrl);
    }
    const response = createChannelResponseController(adapter.outbound.createResponseAdapter(chatId));
    const handleToolActivity = async (activity: AgentToolActivity): Promise<void> => {
      if (!shouldShowToolProgress(activity)) {
        return;
      }

      if (activity.callIndex !== 1 && activity.callIndex % TELEGRAM_TOOL_PROGRESS_EVERY !== 0) {
        return;
      }

      await response.showProgress(formatChannelToolProgress(activity, options.config.agent.name));
    };
    const assistantText = await completeWithAgentTools({
      config: options.config,
      paths: options.paths,
      apiKey,
      messages,
      chatCompletion,
      toolRunner: async (toolOptions) => {
        const result = await mcpToolRunner(toolOptions);
        await sendTelegramMemoryApprovalIfNeeded(options.client, chatId, options.paths, userId, toolOptions.request.tool, result);
        await sendTelegramKnowledgeApprovalIfNeeded(options.client, chatId, options.paths, userId, toolOptions.request.tool, result);
        return result;
      },
      approver: createTelegramPermissionApprover(options.client, chatId, userId, options.paths),
      policy: TELEGRAM_PERMISSION_POLICY,
      streamFinalResponse: true,
      onToolActivity: handleToolActivity,
      runtimeContext: buildTelegramRuntimeToolContext(decision.incoming),
      outboundFileSender: createTelegramOutboundFileSender(options.client, chatId),
    });
    typing.stop();
    await response.replyFinal(assistantText);
    await sendTelegramSpeechReplyIfNeeded({
      client: options.client,
      chatId,
      config: options.config,
      paths: options.paths,
      savedAttachment,
      assistantText,
      speechSynthesizer: options.speechSynthesizer,
      speechVoiceConverter: options.speechVoiceConverter,
    });
    await persistTelegramConversationTurn(options.paths, userId, userInput, assistantText);
    await runTelegramConversationSummaryPass({ config: options.config, paths: options.paths, apiKey, channel: "telegram", userId, chatCompletion });
    const memoryReasoning = await runTelegramMemoryReasoningPass({
      config: options.config,
      paths: options.paths,
      apiKey,
      turn: { channel: "telegram", userId, userInput, assistantText },
      chatCompletion,
    });
    const knowledgeReasoning = await runTelegramKnowledgeReasoningPass({
      config: options.config,
      paths: options.paths,
      apiKey,
      turn: { channel: "telegram", userId, userInput, assistantText },
      chatCompletion,
    });
    await sendTelegramMemoryReasoningApprovalsIfNeeded(options.client, chatId, options.paths, userId, memoryReasoning);
    await sendTelegramKnowledgeReasoningApprovalsIfNeeded(options.client, chatId, options.paths, userId, knowledgeReasoning);
    await appendLog({ event: "telegram_chat_success", detail: { model: options.config.llm.primary } }, { paths: options.paths });
    return "replied";
  } catch (error) {
    typing.stop();
    if (error instanceof ChannelAttachmentHandlingError) {
      await appendLog({ event: "telegram_attachment_failure", detail: { reason: error.reason, kind: attachment?.kind } }, { paths: options.paths, knownSecrets: [apiKey] });
      await options.client.sendMessage(chatId, error.userMessage);
      return "replied";
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown Telegram chat error.";
    await appendLog({ event: "telegram_chat_failure", detail: { message: errorMessage, ...fallbackLogDetail(error) } }, { paths: options.paths, knownSecrets: [apiKey] });
    await options.client.sendMessage(chatId, telegramChatFailureMessage(options.config, error));
    return "replied";
  }
}

function getTelegramMessageDecision(options: {
  enabled: boolean | undefined;
  ownerUserId: OwnerUserIdConfig | undefined;
  callbackQuery: TelegramUpdate["callback_query"];
  message: TelegramUpdate["message"];
  incoming: ChannelIncomingMessage<number, number, NonNullable<TelegramUpdate["message"]>> | undefined;
  attachment: TelegramAttachmentSummary | undefined;
  text: string;
}): TelegramMessageDecision {
  if (!options.enabled) {
    return { kind: "ignored" };
  }

  if (options.callbackQuery) {
    return { kind: "callback" };
  }

  if (!options.message || !options.incoming) {
    return { kind: "ignored" };
  }

  if (!matchesTelegramOwner(options.ownerUserId, options.incoming.senderId, options.incoming.senderUsername)) {
    return { kind: "ignored" };
  }

  if (!options.text && !options.attachment) {
    if (hasTelegramAttachment(options.message)) {
      return { kind: "unsupported-attachment", chatId: options.incoming.chatId, message: options.message };
    }

    return { kind: "ignored" };
  }

  return { kind: "process", chatId: options.incoming.chatId, userId: options.incoming.senderId, incoming: options.incoming, attachment: options.attachment, text: options.text };
}

export function mapTelegramIncomingMessage(message: NonNullable<TelegramUpdate["message"]>): ChannelIncomingMessage<number, number, NonNullable<TelegramUpdate["message"]>> {
  return {
    chatId: message.chat.id,
    messageId: message.message_id,
    senderId: String(message.from?.id ?? ""),
    senderUsername: message.from?.username,
    text: message.text,
    caption: message.caption,
    raw: message,
  };
}

function matchesTelegramOwner(ownerUserId: OwnerUserIdConfig | undefined, senderId: string, senderUsername: string | undefined): boolean {
  const owners = typeof ownerUserId === "string" ? normalizeTelegramOwner(ownerUserId) : ownerUserId?.map(normalizeTelegramOwner);
  return matchesOwnerId(owners, [senderId, ...(senderUsername ? [normalizeTelegramOwner(senderUsername)] : [])]);
}

function normalizeTelegramOwner(value: string): string {
  return value?.trim().replace(/^@/, "").toLowerCase() ?? "";
}

export function createTelegramRuntimeAdapter(update: TelegramUpdate, options: TelegramUpdateHandlerOptions): ChannelRuntimeAdapter<TelegramAttachmentSummary, number, "typing"> {
  return {
    descriptor: TELEGRAM_CHANNEL,
    attachments: {
      getAttachment: (message) => getTelegramAttachment(message.raw as NonNullable<TelegramUpdate["message"]>),
      processAttachment: async (attachment) => saveTelegramAttachment(attachment, update, options),
    },
    outbound: createTelegramOutboundAdapter(options.client, options.typingRefreshMs),
  };
}

function telegramChatFailureMessage(config: AppConfig, error: unknown): string {
  if (error instanceof ProviderTimeoutError || (error instanceof ProviderFallbackError && error.finalError instanceof ProviderTimeoutError)) {
    return `${config.agent.name} timed out while handling this message. The task may be too heavy for the current provider timeout; try again, ask a narrower question, or raise llm.timeoutMs in .bestie/config.json.`;
  }

  const providerError = formatProviderChatFailure(error);
  if (providerError) {
    return `${config.agent.name} could not get a provider response: ${providerError}`;
  }

  return `${config.agent.name} hit an error while handling this message. Try again or ask a narrower question.`;
}

function buildTelegramRuntimeToolContext(incoming: ChannelIncomingMessage<number, number, NonNullable<TelegramUpdate["message"]>>): string {
  const username = incoming.senderUsername ? `, username @${incoming.senderUsername}` : "";
  return `Current channel: telegram. Current Telegram chat id: ${incoming.chatId}. Current owner/user id: ${incoming.senderId}${username}. internal.send_photo and internal.send_file can send generated or local workspace files back to this chat; omit arguments.channel for this chat or set it to "telegram:${incoming.chatId}" explicitly. For internal.add_cron_schedule reports back to this chat, set arguments.channel to "telegram:${incoming.chatId}".`;
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

async function runTelegramMemoryReasoningPass(options: Parameters<typeof runMemoryReasoningPass>[0]): Promise<MemoryReasoningResult> {
  try {
    return await runMemoryReasoningPass(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown memory reasoning error.";
    await appendLog({ event: "memory_reasoning_failure", detail: { channel: "telegram", message } }, { paths: options.paths, knownSecrets: [options.apiKey] });
    return { stored: [], pending: [], skipped: [] };
  }
}

async function runTelegramKnowledgeReasoningPass(options: Parameters<typeof runKnowledgeReasoningPass>[0]): Promise<KnowledgeReasoningResult> {
  try {
    return await runKnowledgeReasoningPass(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown knowledge reasoning error.";
    await appendLog({ event: "knowledge_reasoning_failure", detail: { channel: "telegram", message } }, { paths: options.paths, knownSecrets: [options.apiKey] });
    return { storedEntities: [], storedRelations: [], pending: [], skipped: [] };
  }
}

async function runTelegramConversationSummaryPass(options: Parameters<typeof refreshConversationSummary>[0]): Promise<void> {
  try {
    await refreshConversationSummary(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown conversation summary error.";
    await appendLog({ event: "conversation_summary_failure", detail: { channel: options.channel, message } }, { paths: options.paths, knownSecrets: [options.apiKey] });
  }
}

async function sendTelegramSpeechReplyIfNeeded(options: {
  client: TelegramClient;
  chatId: number;
  config: AppConfig;
  paths: RuntimePaths;
  savedAttachment?: SavedTelegramAttachment;
  assistantText: string;
  speechSynthesizer?: TelegramSpeechSynthesizer;
  speechVoiceConverter?: TelegramSpeechVoiceConverter;
}): Promise<void> {
  if (options.config.channels?.telegram?.voiceReplyPolicy !== "voice-input-only") {
    return;
  }

  if (!options.config.speech || !options.speechSynthesizer || !options.client.sendVoice) {
    return;
  }

  if (options.savedAttachment?.kind !== "voice" && options.savedAttachment?.kind !== "audio") {
    return;
  }

  const trimmedText = options.assistantText.trim();
  if (!trimmedText) {
    return;
  }

  const maxChars = options.config.channels.telegram.voiceReplyMaxChars ?? TELEGRAM_SPEECH_REPLY_MAX_CHARS;
  if (trimmedText.length > maxChars) {
    await appendLog({ event: "telegram_speech_reply_skipped", detail: { reason: "too_long", textLength: trimmedText.length, maxChars } }, { paths: options.paths });
    return;
  }

  const cooldownMs = options.config.channels.telegram.voiceReplyCooldownMs ?? TELEGRAM_SPEECH_REPLY_COOLDOWN_MS;
  const now = Date.now();
  const lastSentAt = telegramSpeechReplyLastSentAt.get(options.chatId);
  if (cooldownMs > 0 && lastSentAt !== undefined && now - lastSentAt < cooldownMs) {
    await appendLog({ event: "telegram_speech_reply_skipped", detail: { reason: "cooldown", cooldownMs, remainingMs: cooldownMs - (now - lastSentAt) } }, { paths: options.paths });
    return;
  }

  try {
    await options.client.sendChatAction(options.chatId, "upload_voice");
    const speech = await options.speechSynthesizer(trimmedText);
    const voice = await (options.speechVoiceConverter ?? convertSpeechToTelegramVoice)(speech, { paths: options.paths });
    await options.client.sendVoice(options.chatId, voice.bytes, { fileName: "bestie-reply.ogg", mimeType: voice.mimeType });
    telegramSpeechReplyLastSentAt.set(options.chatId, now);
    await appendLog({ event: "telegram_speech_reply_success", detail: { bytes: voice.bytes.byteLength, mimeType: voice.mimeType, converted: speech.mimeType !== voice.mimeType } }, { paths: options.paths });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Telegram speech reply error.";
    await appendLog({ event: "telegram_speech_reply_failure", detail: { message } }, { paths: options.paths });
  }
}

export async function convertSpeechToTelegramVoice(speech: TelegramSpeechSynthesisResult, options: { paths: RuntimePaths }): Promise<TelegramSpeechSynthesisResult> {
  const tempDir = await mkdtemp(resolve(options.paths.appDir, "speech-reply-"));
  const inputPath = join(tempDir, `input${extensionForMimeType(speech.mimeType)}`);
  const outputPath = join(tempDir, "voice.ogg");

  try {
    await writeFile(inputPath, speech.bytes, { mode: 0o600 });
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-vn", "-c:a", "libopus", "-b:a", "32k", "-vbr", "on", outputPath], { timeout: 30_000, windowsHide: true });
    const bytes = await readFile(outputPath);
    if (bytes.byteLength === 0) {
      throw new Error("ffmpeg produced an empty Telegram voice file.");
    }
    return { bytes: new Uint8Array(bytes), mimeType: "audio/ogg" };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim();
  if (normalized === "audio/wav" || normalized === "audio/x-wav") return ".wav";
  if (normalized === "audio/aac") return ".aac";
  if (normalized === "audio/flac") return ".flac";
  if (normalized === "audio/ogg" || normalized === "audio/opus") return ".ogg";
  return ".mp3";
}

async function sendTelegramMemoryReasoningApprovalsIfNeeded(
  client: TelegramClient,
  chatId: number,
  paths: RuntimePaths,
  ownerUserId: string,
  result: MemoryReasoningResult,
): Promise<void> {
  for (const pending of result.pending) {
    const store = await SqliteMemoryStore.open(paths);
    let approvalId: number;

    try {
      approvalId = store.addPendingActionApproval({
        channel: "telegram",
        userId: ownerUserId,
        category: "local_write",
        action: "memory_approve",
        target: `pending-memory:${pending.id}`,
        reason: "Approve or deny a memory inferred from the latest conversation.",
        proposedReason: pending.reason ?? "Memory reasoning proposed this candidate.",
        ttlMs: TELEGRAM_ACTION_APPROVAL_TTL_MS,
      }).id;
    } finally {
      store.close();
    }

    await client.sendMessage(
      chatId,
      redactSecrets(
        [
          `Memory approval needed. Request: ${approvalId}`,
          `Type: ${pending.type}`,
          `Content: ${pending.content}`,
          pending.reason ? `Reason: ${pending.reason}` : undefined,
          "Choose Approve to save it or Deny to reject it.",
        ].filter(Boolean).join("\n"),
      ),
      { replyMarkup: createApprovalReplyMarkup(approvalId) },
    );
  }
}

async function sendTelegramKnowledgeReasoningApprovalsIfNeeded(
  client: TelegramClient,
  chatId: number,
  paths: RuntimePaths,
  ownerUserId: string,
  result: KnowledgeReasoningResult,
): Promise<void> {
  for (const pending of result.pending) {
    const store = await SqliteMemoryStore.open(paths);
    let approvalId: number;

    try {
      approvalId = store.addPendingActionApproval({
        channel: "telegram",
        userId: ownerUserId,
        category: "local_write",
        action: "knowledge_approve",
        target: `pending-knowledge:${pending.id}`,
        reason: "Approve or deny a knowledge graph item inferred from the latest conversation.",
        proposedReason: pending.reason ?? "Knowledge graph reasoning proposed this item.",
        ttlMs: TELEGRAM_ACTION_APPROVAL_TTL_MS,
      }).id;
    } finally {
      store.close();
    }

    await client.sendMessage(
      chatId,
      redactSecrets(
        [
          `Knowledge graph approval needed. Request: ${approvalId}`,
          formatPendingKnowledgePayloadSummary(pending.payload),
          pending.reason ? `Reason: ${pending.reason}` : undefined,
          "Choose Approve to save it or Deny to reject it.",
        ].filter(Boolean).join("\n"),
      ),
      { replyMarkup: createApprovalReplyMarkup(approvalId) },
    );
  }
}

async function handleTelegramCallbackQuery(update: TelegramUpdate, options: TelegramUpdateHandlerOptions): Promise<TelegramUpdateResult> {
  const telegramConfig = options.config.channels?.telegram;
  const callbackQuery = update.callback_query;

  if (!telegramConfig?.enabled || !callbackQuery) {
    return "ignored";
  }

  if (!matchesTelegramOwner(telegramConfig.ownerUserId, String(callbackQuery.from.id), callbackQuery.from.username)) {
    await appendLog({ event: "telegram_approval_callback_ignored", detail: { reason: "non_owner", fromId: callbackQuery.from.id, fromUsername: callbackQuery.from.username } }, { paths: options.paths });
    await options.client.answerCallbackQuery?.(callbackQuery.id, "Only the configured owner can approve this action.");
    return "ignored";
  }

  const decision = parseTelegramApprovalCallback(callbackQuery.data ?? "");
  if (!decision) {
    await options.client.answerCallbackQuery?.(callbackQuery.id, "Unknown approval action.");
    return "replied";
  }

  const store = await SqliteMemoryStore.open(options.paths);
  try {
    const pendingApproval = store.getPendingActionApprovalById(decision.id);
    if (pendingApproval?.userId && pendingApproval.userId !== String(callbackQuery.from.id)) {
      await options.client.answerCallbackQuery?.(callbackQuery.id, "Only the owner who requested this action can decide it.");
      return "ignored";
    }
    const approval = decision.decision === "approve" ? store.approvePendingActionApproval(decision.id) : store.denyPendingActionApproval(decision.id);

    if (!approval) {
      const message = `Approval request ${decision.id} is no longer pending. It may have already been handled or expired.`;
      await options.client.answerCallbackQuery?.(callbackQuery.id, "Approval request is no longer pending.");
      await replyToTelegramCallbackSource(options.client, callbackQuery.message, message, options.paths);
      return "replied";
    }

    try {
      const callbackLocation = getCallbackMessageLocation(callbackQuery.message);
      const actionResult = await executeApprovedAction(store, approval, decision.decision, { config: options.config, paths: options.paths, outboundFileSender: callbackLocation ? createTelegramOutboundFileSender(options.client, callbackLocation.chatId) : undefined });
      await appendLog({ event: "telegram_approval_execution", detail: { id: approval.id, action: approval.action, decision: decision.decision, status: actionResult.status, message: actionResult.message } }, { paths: options.paths });
      await options.client.answerCallbackQuery?.(callbackQuery.id, actionResult.shortText);
      await replyToTelegramCallbackSource(options.client, callbackQuery.message, actionResult.message, options.paths);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await appendLog({ event: "telegram_approval_execution_failure", detail: { id: approval.id, action: approval.action, decision: decision.decision, message: errorMessage } }, { paths: options.paths });
      await options.client.answerCallbackQuery?.(callbackQuery.id, "Approval action failed.");
      await replyToTelegramCallbackSource(options.client, callbackQuery.message, `Approval ${approval.id} failed while executing ${approval.action}: ${errorMessage}`, options.paths);
    }

    return "replied";
  } finally {
    store.close();
  }
}

async function replyToTelegramCallbackSource(client: TelegramClient, message: MaybeInaccessibleMessage | undefined, text: string, paths: RuntimePaths): Promise<void> {
  const callbackMessage = getCallbackMessageLocation(message);

  if (callbackMessage) {
    try {
      await safeEditTelegramMessageText(client, callbackMessage.chatId, callbackMessage.messageId, text);
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await appendLog({ event: "telegram_callback_reply_edit_failure", detail: { chatId: callbackMessage.chatId, messageId: callbackMessage.messageId, message: errorMessage } }, { paths });
      await client.sendMessage(callbackMessage.chatId, text);
    }
    return;
  }

  if (message && "chat" in message) {
    await client.sendMessage(message.chat.id, text);
  }
}

function getCallbackMessageLocation(message: MaybeInaccessibleMessage | undefined): { chatId: number; messageId: number } | undefined {
  if (!message || !("chat" in message) || !("message_id" in message)) {
    return undefined;
  }

  return { chatId: message.chat.id, messageId: message.message_id };
}

function createTelegramPermissionApprover(client: TelegramClient, chatId: number, userId: string, paths: RuntimePaths): PermissionApprover {
  return async (request: ActionPermissionRequest, proposed: ActionPermissionResult) => {
    const store = await SqliteMemoryStore.open(paths);
    let approvalId: number;

    try {
      approvalId = store.addPendingActionApproval({
        channel: "telegram",
        userId,
        category: request.category,
        action: request.action,
        target: request.target,
        reason: request.reason,
        proposedReason: proposed.reason,
        payloadJson: request.payloadJson,
        ttlMs: TELEGRAM_ACTION_APPROVAL_TTL_MS,
      }).id;
    } finally {
      store.close();
    }

    await client.sendMessage(
      chatId,
      redactSecrets(
        [
          `Approval needed before running this action. Request: ${approvalId}`,
          `Category: ${request.category}`,
          `Action: ${request.action}`,
          request.target ? `Target: ${request.target}` : undefined,
          request.reason ? `Reason: ${request.reason}` : undefined,
          `Policy: ${proposed.reason}`,
          "Decision: choose Approve or Deny below.",
        ].filter(Boolean).join("\n"),
      ),
      { replyMarkup: createApprovalReplyMarkup(approvalId) },
    );

    return { approved: false, reason: `Pending Telegram approval request ${approvalId} was recorded but not executed.` };
  };
}

async function sendTelegramMemoryApprovalIfNeeded(
  client: TelegramClient,
  chatId: number,
  paths: RuntimePaths,
  ownerUserId: string,
  toolName: string,
  result: { ok: boolean; result?: unknown },
): Promise<void> {
  if (toolName !== "internal.remember_memory" || !result.ok || !isPendingMemoryToolResult(result.result)) {
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
      channel: "telegram",
      userId: ownerUserId,
      category: "local_write",
      action: "memory_approve",
      target: `pending-memory:${pending.id}`,
      reason: "Approve or deny model-requested memory write.",
      proposedReason: pending.reason ?? "Memory write policy is ask.",
      ttlMs: TELEGRAM_ACTION_APPROVAL_TTL_MS,
    }).id;
  } finally {
    store.close();
  }

  await client.sendMessage(
    chatId,
    [`${ownerUserId ? "Memory approval needed" : "Approval needed"}. Request: ${approvalId}`, `Type: ${type}`, `Content: ${content}`, "Choose Approve to save it or Deny to reject it."].join("\n"),
    { replyMarkup: createApprovalReplyMarkup(approvalId) },
  );
}

async function sendTelegramKnowledgeApprovalIfNeeded(
  client: TelegramClient,
  chatId: number,
  paths: RuntimePaths,
  ownerUserId: string,
  toolName: string,
  result: { ok: boolean; result?: unknown },
): Promise<void> {
  if (toolName !== "internal.remember_knowledge" || !result.ok || !isPendingMemoryToolResult(result.result)) {
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
      channel: "telegram",
      userId: ownerUserId,
      category: "local_write",
      action: "knowledge_approve",
      target: `pending-knowledge:${pending.id}`,
      reason: "Approve or deny model-requested knowledge graph write.",
      proposedReason: pending.reason ?? "Knowledge graph write policy is ask.",
      ttlMs: TELEGRAM_ACTION_APPROVAL_TTL_MS,
    }).id;
  } finally {
    store.close();
  }

  await client.sendMessage(
    chatId,
    [`Knowledge graph approval needed. Request: ${approvalId}`, summary, "Choose Approve to save it or Deny to reject it."].join("\n"),
    { replyMarkup: createApprovalReplyMarkup(approvalId) },
  );
}

async function safeEditTelegramMessageText(client: TelegramClient, chatId: number, messageId: number, text: string): Promise<void> {
  try {
    await client.editMessageText(chatId, messageId, text);
  } catch (error) {
    if (isTelegramMessageNotModifiedError(error)) {
      return;
    }

    throw error;
  }
}

function isTelegramMessageNotModifiedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("message is not modified");
}

export function splitTelegramMessageText(text: string): string[] {
  if (text.length <= TELEGRAM_MESSAGE_CHUNK_LIMIT) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > TELEGRAM_MESSAGE_CHUNK_LIMIT) {
    const boundary = findTelegramChunkBoundary(remaining, TELEGRAM_MESSAGE_CHUNK_LIMIT);
    chunks.push(remaining.slice(0, boundary).trimEnd());
    remaining = remaining.slice(boundary).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks.length > 0 ? chunks : [text.slice(0, TELEGRAM_MESSAGE_CHUNK_LIMIT)];
}

async function sendTelegramTextChunks(client: TelegramClient, chatId: number, text: string): Promise<void> {
  for (const chunk of splitTelegramMessageText(text)) {
    await client.sendMessage(chatId, chunk);
  }
}

function formatMemoryList(memories: Array<{ id: number; type: string; content: string }>): string {
  return memories.map((memory) => `${memory.id}. [${memory.type}] ${memory.content}`).join("\n");
}

export function createTelegramOutboundAdapter(client: TelegramClient, refreshMs = TELEGRAM_TYPING_REFRESH_MS): ChannelOutboundAdapter<number, "typing"> {
  return {
    createResponseAdapter: (chatId) => ({
      sendMessage: (text) => client.sendMessage(chatId, text),
      editMessage: (messageId, text) => client.editMessageText(chatId, messageId, text),
      splitMessage: splitTelegramMessageText,
      isNoopEditError: isTelegramMessageNotModifiedError,
    }),
    createActivityOptions: (chatId, action) => ({ client, chatId, action, refreshMs }),
  };
}

function createTelegramOutboundFileSender(client: TelegramClient, currentChatId: number): AgentOutboundFileSender {
  return {
    async sendPhoto(payload) {
      if (!client.sendPhoto) {
        throw new Error("Telegram client does not support sending photos.");
      }
      const chatId = resolveTelegramOutboundChatId(payload.channel, currentChatId);
      const sent = await client.sendPhoto(chatId, payload.bytes, { fileName: payload.fileName, mimeType: payload.mimeType, caption: payload.caption });
      return { channel: `telegram:${chatId}`, target: String(chatId), ...(sent?.messageId === undefined ? {} : { messageId: sent.messageId }) };
    },
    async sendFile(payload) {
      if (!client.sendDocument) {
        throw new Error("Telegram client does not support sending files.");
      }
      const chatId = resolveTelegramOutboundChatId(payload.channel, currentChatId);
      const sent = await client.sendDocument(chatId, payload.bytes, { fileName: payload.fileName, mimeType: payload.mimeType, caption: payload.caption });
      return { channel: `telegram:${chatId}`, target: String(chatId), ...(sent?.messageId === undefined ? {} : { messageId: sent.messageId }) };
    },
  };
}

function resolveTelegramOutboundChatId(channel: string | undefined, currentChatId: number): number {
  if (channel === undefined || channel.trim() === "" || channel === "current") return currentChatId;
  const match = /^telegram:(-?\d+)$/.exec(channel.trim());
  if (!match) {
    throw new Error('Telegram outbound files require channel "telegram:<chatId>" or the current channel.');
  }
  return Number(match[1]);
}

function findTelegramChunkBoundary(text: string, limit: number): number {
  const searchWindow = text.slice(0, limit);
  const paragraphBreak = searchWindow.lastIndexOf("\n\n");
  if (paragraphBreak >= Math.floor(limit * 0.5)) {
    return paragraphBreak;
  }

  const lineBreak = searchWindow.lastIndexOf("\n");
  if (lineBreak >= Math.floor(limit * 0.5)) {
    return lineBreak;
  }

  const space = searchWindow.lastIndexOf(" ");
  if (space >= Math.floor(limit * 0.5)) {
    return space;
  }

  return limit;
}

async function sendTelegramChatActionBestEffort(client: TelegramClient, chatId: number, action: TelegramChatAction): Promise<void> {
  try {
    await client.sendChatAction(chatId, action);
  } catch {
    // Chat actions are cosmetic; message handling must continue when Telegram throttles them.
  }
}

function hasTelegramAttachment(message: NonNullable<TelegramUpdate["message"]>): boolean {
  return Boolean(message.photo?.length || message.document || message.voice || message.audio || message.video || message.sticker);
}

function getTelegramAttachment(message: NonNullable<TelegramUpdate["message"]>): TelegramAttachmentSummary | undefined {
  const photo = message.photo?.at(-1);
  if (photo) {
    return { kind: "photo", fileId: photo.file_id, fileUniqueId: photo.file_unique_id, fileSize: photo.file_size, width: photo.width, height: photo.height };
  }

  if (message.document) {
    return {
      kind: "document",
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id,
      fileName: message.document.file_name,
      mimeType: message.document.mime_type,
      fileSize: message.document.file_size,
    };
  }

  if (message.voice) {
    const providedTranscript = (message.voice as typeof message.voice & { providedTranscript?: ChannelTranscript }).providedTranscript;
    return { kind: "voice", fileId: message.voice.file_id, fileUniqueId: message.voice.file_unique_id, mimeType: message.voice.mime_type, fileSize: message.voice.file_size, duration: message.voice.duration, providedTranscript };
  }

  if (message.audio) {
    const providedTranscript = (message.audio as typeof message.audio & { providedTranscript?: ChannelTranscript }).providedTranscript;
    return {
      kind: "audio",
      fileId: message.audio.file_id,
      fileUniqueId: message.audio.file_unique_id,
      fileName: message.audio.file_name,
      mimeType: message.audio.mime_type,
      fileSize: message.audio.file_size,
      duration: message.audio.duration,
      providedTranscript,
    };
  }

  if (message.video) {
    return {
      kind: "video",
      fileId: message.video.file_id,
      fileUniqueId: message.video.file_unique_id,
      fileName: message.video.file_name,
      mimeType: message.video.mime_type,
      fileSize: message.video.file_size,
      width: message.video.width,
      height: message.video.height,
      duration: message.video.duration,
    };
  }

  if (message.sticker) {
    return {
      kind: "sticker",
      fileId: message.sticker.file_id,
      fileUniqueId: message.sticker.file_unique_id,
      fileSize: message.sticker.file_size,
      width: message.sticker.width,
      height: message.sticker.height,
      emoji: message.sticker.emoji,
    };
  }

  return undefined;
}

async function saveTelegramAttachment(attachment: TelegramAttachmentSummary, update: TelegramUpdate, options: TelegramUpdateHandlerOptions): Promise<SavedTelegramAttachment> {
  const policy = getTelegramAttachmentPolicy(options.config);
  const processed = await processChannelAttachment({
    validate: () => validateTelegramAttachmentPolicy(attachment, policy),
    download: () => downloadChannelAttachmentBytes({
      fileId: attachment.fileId,
      reportedSize: attachment.fileSize,
      maxBytes: policy.maxBytes,
      getFile: options.client.getFile ? (fileId) => options.client.getFile!(fileId) : undefined,
      downloadFile: options.client.downloadFile ? (filePath) => options.client.downloadFile!(filePath) : undefined,
      messages: telegramAttachmentDownloadMessages(policy),
    }),
    buildLocalPath: (downloaded: ChannelDownloadedAttachment) => buildTelegramAttachmentPath(options.paths, update, attachment, downloaded.filePath),
    persist: persistChannelAttachmentFile,
    preview: (input: TelegramAttachmentPipelineInput) => buildChannelAttachmentPreview({
      bytes: input.bytes,
      localPath: input.localPath,
      mimeType: attachment.mimeType,
      previewMaxBytes: policy.previewMaxBytes,
      parseMaxBytes: policy.parseMaxBytes,
    }),
    vision: (input: TelegramAttachmentPipelineInput) => buildChannelVisionAttachment({
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      localPath: input.localPath,
      bytes: input.bytes,
      visionPolicy: policy.visionPolicy,
      visionMaxBytes: policy.visionMaxBytes,
    }),
    transcribe: (input: TelegramAttachmentPipelineInput) => transcribeTelegramAudioAttachment(attachment, input.localPath, input.bytes, policy, options.attachmentTranscriber),
    retain: (input: Pick<TelegramAttachmentPipelineInput, "localPath">) => applyChannelAttachmentRetention({
      localPath: input.localPath,
      kind: attachment.kind,
      deleteAfterProcessingKinds: policy.deleteAfterProcessingKinds,
      onCleanupFailed: (detail) => appendLog({ event: "telegram_attachment_cleanup_failed", detail }),
    }),
  });

  return { ...attachment, ...processed };
}

function validateTelegramAttachmentPolicy(attachment: TelegramAttachmentSummary, policy: TelegramAttachmentPolicy): void {
  assertChannelAttachmentDownloadAllowed({ downloadPolicy: policy.downloadPolicy, message: "Attachment downloads are disabled by config." });
}

function telegramAttachmentDownloadMessages(policy: TelegramAttachmentPolicy): Parameters<typeof downloadChannelAttachmentBytes>[0]["messages"] {
  return {
    clientUnsupported: "This Telegram runtime cannot download attachments yet.",
    metadataFailed: "Telegram could not provide file metadata for this attachment.",
    missingFilePath: "Telegram could not provide a downloadable file for this attachment.",
    downloadFailed: "Telegram could not download this attachment. Please try again with a smaller or different file.",
    tooLarge: `This attachment is larger than the configured limit of ${policy.maxBytes} bytes.`,
  };
}

function buildTelegramAttachmentPath(paths: RuntimePaths, update: TelegramUpdate, attachment: TelegramAttachmentSummary, filePath: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const messageId = update.message?.message_id ?? update.update_id;
  const sourceName = attachment.fileName ?? (basename(filePath) || `${attachment.kind}-${attachment.fileUniqueId ?? attachment.fileId}`);
  const extension = extname(sourceName) || defaultTelegramAttachmentExtension(attachment.kind, attachment.mimeType);
  return buildChannelAttachmentPath({
    workspaceDir: paths.workspaceDir,
    channelName: "telegram",
    date,
    updateId: update.update_id,
    messageId,
    kind: attachment.kind,
    sourceName,
    extension,
    fallbackName: `${attachment.kind}-${messageId}`,
  });
}

function defaultTelegramAttachmentExtension(kind: TelegramAttachmentSummary["kind"], mimeType: string | undefined): string {
  if (mimeType === "text/plain") return ".txt";
  if (mimeType === "application/json") return ".json";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "audio/ogg") return ".ogg";
  if (mimeType === "video/mp4") return ".mp4";
  if (kind === "photo") return ".jpg";
  if (kind === "sticker") return ".webp";
  return ".bin";
}

function getTelegramAttachmentPolicy(config: AppConfig): TelegramAttachmentPolicy {
  const configured = config.channels?.telegram?.attachments;
  return {
    downloadPolicy: configured?.downloadPolicy ?? "allow",
    maxBytes: configured?.maxBytes ?? TELEGRAM_ATTACHMENT_MAX_BYTES,
    previewMaxBytes: configured?.previewMaxBytes ?? TELEGRAM_ATTACHMENT_PREVIEW_MAX_BYTES,
    parseMaxBytes: configured?.parseMaxBytes ?? TELEGRAM_ATTACHMENT_PARSE_MAX_BYTES,
    visionPolicy: resolveChannelVisionPolicy(config, configured?.visionPolicy),
    visionMaxBytes: configured?.visionMaxBytes ?? TELEGRAM_ATTACHMENT_VISION_MAX_BYTES,
    transcriptionPolicy: configured?.transcriptionPolicy ?? "deny",
    transcriptionMaxBytes: configured?.transcriptionMaxBytes ?? TELEGRAM_ATTACHMENT_TRANSCRIPTION_MAX_BYTES,
    deleteAfterProcessingKinds: configured?.deleteAfterProcessingKinds ?? [],
  };
}

function buildTelegramAttachmentUserInput(caption: string, attachment: SavedTelegramAttachment): string {
  return buildChannelAttachmentPrompt({
    channelDisplayName: "Telegram",
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

async function transcribeTelegramAudioAttachment(
  attachment: TelegramAttachmentSummary,
  localPath: string,
  bytes: Uint8Array,
  policy: TelegramAttachmentPolicy,
  transcriber: TelegramAttachmentTranscriber | undefined,
): Promise<ChannelAudioTranscriptResult> {
  if (!isTelegramAudioAttachment(attachment)) {
    return {};
  }

  if (policy.transcriptionPolicy !== "allow") {
    return {};
  }

  const providedTranscript = buildChannelProvidedAudioTranscriptResult({ transcript: attachment.providedTranscript, maxBytes: policy.previewMaxBytes });
  if (providedTranscript) {
    return providedTranscript;
  }

  if (!transcriber) {
    return { transcriptionWarning: "Transcription is allowed by config, but no transcriber is configured in this runtime." };
  }

  if (bytes.byteLength > policy.transcriptionMaxBytes) {
    return { transcriptionWarning: `Skipped audio transcription because the file exceeds transcriptionMaxBytes (${policy.transcriptionMaxBytes} bytes).` };
  }

  try {
    const result = await transcriber({ bytes, localPath, mimeType: attachment.mimeType, kind: attachment.kind, duration: attachment.duration });
    return buildChannelAudioTranscriptResult({
      text: result.text,
      maxBytes: policy.previewMaxBytes,
      source: "provider",
      emptyWarning: "No speech text was extracted from this audio attachment.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown transcription error";
    return { transcriptionWarning: `Could not transcribe audio attachment: ${message}` };
  }
}

function isTelegramAudioAttachment(attachment: TelegramAttachmentSummary): attachment is TelegramAttachmentSummary & { kind: "voice" | "audio" } {
  return isAudioAttachmentKind(attachment.kind);
}

function attachTelegramVisionImage(messages: ChatMessage[], userInput: string, dataUrl: string): void {
  const currentUserMessage = messages.at(-1);
  if (!currentUserMessage || currentUserMessage.role !== "user") {
    return;
  }

  currentUserMessage.content = buildTelegramVisionContent(userInput, dataUrl);
}

function buildTelegramVisionContent(userInput: string, dataUrl: string): ChatMessageContent {
  return [
    { type: "text", text: userInput },
    { type: "image_url", image_url: { url: dataUrl } },
  ];
}

function summarizeTelegramAttachmentParse(attachment: SavedTelegramAttachment): TelegramAttachmentParseTelemetry {
  return {
    kind: attachment.kind,
    ...(attachment.mimeType === undefined ? {} : { mimeType: attachment.mimeType }),
    ...(attachment.fileSize === undefined ? {} : { telegramFileSize: attachment.fileSize }),
    savedBytes: attachment.bytes,
    ...(attachment.contentParser === undefined ? {} : { contentParser: attachment.contentParser }),
    hasTextPreview: Boolean(attachment.textPreview),
    textPreviewTruncated: attachment.textPreviewTruncated === true,
    hasParseWarning: Boolean(attachment.parseWarning),
    hasVisionInput: Boolean(attachment.visionImage),
    hasAudioTranscript: Boolean(attachment.audioTranscript),
    audioTranscriptTruncated: attachment.audioTranscriptTruncated === true,
    hasTranscriptionWarning: Boolean(attachment.transcriptionWarning),
  };
}

async function handleTelegramSlashCommand(text: string, chatId: number, userId: string, options: TelegramUpdateHandlerOptions): Promise<boolean> {
  if (await handleCronChannelCommand({ text, paths: options.paths, channel: "telegram", userId: String(chatId), sendMessage: (message) => options.client.sendMessage(chatId, message).then(() => undefined) })) {
    return true;
  }

  if (text === "/approvals") {
    const store = await SqliteMemoryStore.open(options.paths);

    try {
      const approvals = store.listPendingActionApprovals("telegram", userId, 5);

      if (approvals.length === 0) {
        await options.client.sendMessage(chatId, "No pending action approvals.");
        return true;
      }

      await options.client.sendMessage(chatId, `Pending approvals:\n${approvals.map(formatPendingApprovalSummary).join("\n\n")}`);
      return true;
    } finally {
      store.close();
    }
  }

  const approvalDecision = parseTelegramApprovalDecision(text);
  if (approvalDecision) {
    const store = await SqliteMemoryStore.open(options.paths);

    try {
      const pendingApproval = store.getPendingActionApprovalById(approvalDecision.id);
      if (pendingApproval?.userId && pendingApproval.userId !== userId) {
        await options.client.sendMessage(chatId, `Approval request ${approvalDecision.id} belongs to another owner.`);
        return true;
      }
      const approval = approvalDecision.decision === "approve" ? store.approvePendingActionApproval(approvalDecision.id) : store.denyPendingActionApproval(approvalDecision.id);

      if (!approval) {
        await options.client.sendMessage(chatId, `Approval request ${approvalDecision.id} is no longer pending. It may have already been handled or expired.`);
        return true;
      }

      const actionResult = await executeApprovedAction(store, approval, approvalDecision.decision, { config: options.config, paths: options.paths, outboundFileSender: createTelegramOutboundFileSender(options.client, chatId) });
      await options.client.sendMessage(chatId, actionResult.message);
      return true;
    } finally {
      store.close();
    }
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

  if (text === "/doctor") {
    const report = await runDoctor(options.paths);
    await options.client.sendMessage(chatId, formatTelegramDoctorSummary(report));
    return true;
  }

  const memoryCommand = parseTelegramMemoryCommand(text);

  if (memoryCommand === "list") {
    const store = await SqliteMemoryStore.open(options.paths);

    try {
      const memories = store.listActiveMemories();

      if (memories.length === 0) {
        await options.client.sendMessage(chatId, "No active memories.");
        return true;
      }

      await sendTelegramTextChunks(options.client, chatId, `Active memories (${memories.length}):\n${formatMemoryList(memories)}`);
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand === "tiers") {
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      await sendTelegramTextChunks(options.client, chatId, formatMemoryTiersReport({ memories: store.listActiveMemories(), plan: await planMemoryHygieneTool({ paths: options.paths }), channelCommandPrefix: "/memory" }));
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
        await sendTelegramTextChunks(options.client, chatId, formatMemoryRebalancePlan({ plan, channelCommandPrefix: "/memory" }));
        return true;
      }

      if (deletePolicy === "deny") {
        await options.client.sendMessage(chatId, "memory.deletePolicy is deny. No memories were moved.");
        return true;
      }

      if (deletePolicy === "ask" && memoryCommand !== "rebalance_apply_confirm") {
        await sendTelegramTextChunks(options.client, chatId, `${formatMemoryRebalancePlan({ plan, channelCommandPrefix: "/memory" })}\nCONFIRM: reply /memory rebalance apply confirm to move non-review-only memories.`);
        return true;
      }

      await sendTelegramTextChunks(options.client, chatId, formatMemoryRebalanceApplyResult(applyMemoryRebalancePlan(store, plan)));
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand === "digest") {
    await options.client.sendMessage(chatId, "Running memory maintenance digest...");
    const result = await runMemoryMaintenanceDigest({ config: options.config, paths: options.paths });
    await sendTelegramTextChunks(options.client, chatId, result.ok ? result.output : `Digest failed: ${result.reason}`);
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
      await sendTelegramTextChunks(options.client, chatId, formatMemorySummary({
        memories,
        plan,
        rebalance,
        trend,
        deletePolicy: options.config.memory?.deletePolicy ?? "ask",
        retrievalPolicy: options.config.memory?.retrievalPolicy ?? "full",
        channelCommandPrefix: "/memory",
      }));
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand?.startsWith("scope:")) {
    const scope = memoryCommand.split(":")[1];
    if (!isMemoryScope(scope)) {
      await options.client.sendMessage(chatId, "Usage: /memory scope core|project|session");
      return true;
    }

    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const memories = store.listActiveMemoriesByScope(scope);
      const header = `Active memories / ${scope} (${memories.length})`;
      await sendTelegramTextChunks(options.client, chatId, memories.length === 0 ? `No active memories in ${scope} scope.` : `${header}:\n${formatMemoryList(memories)}`);
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand?.startsWith("inspect:")) {
    const id = Number(memoryCommand.split(":")[1]);
    if (!Number.isSafeInteger(id) || id <= 0) {
      await options.client.sendMessage(chatId, "Usage: /memory inspect <id>");
      return true;
    }

    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const memory = store.getActiveMemory(id);
      await sendTelegramTextChunks(options.client, chatId, memory ? formatMemoryInspect(memory) : `No active memory found for id ${id}.`);
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand === "analyze" || memoryCommand === "cleanup_dry_run") {
    const analysis = await analyzeMemoriesTool({ paths: options.paths, mode: "all" });
    const message = memoryCommand === "analyze" ? formatMemoryAnalysisReport(analysis) : formatMemoryCleanupDryRunReport(analysis);
    await sendTelegramTextChunks(options.client, chatId, message);
    return true;
  }

  if (memoryCommand === "hygiene") {
    await sendTelegramTextChunks(options.client, chatId, formatMemoryHygieneReport(await planMemoryHygieneTool({ paths: options.paths })));
    return true;
  }

  if (memoryCommand === "hygiene_status") {
    const plan = await planMemoryHygieneTool({ paths: options.paths });
    const score = calculateMemoryHygieneScore(plan);
    const trend = await recordMemoryHygieneSnapshot({ paths: options.paths, plan, score, source: "telegram:status" });
    await sendTelegramTextChunks(options.client, chatId, formatMemoryHygieneStatus({ plan, deletePolicy: options.config.memory?.deletePolicy ?? "ask", retrievalPolicy: options.config.memory?.retrievalPolicy ?? "full", channelCommand: "/memory hygiene apply", trend }));
    return true;
  }

  if (memoryCommand === "hygiene_trend") {
    await sendTelegramTextChunks(options.client, chatId, formatMemoryHygieneTrendReport(await readMemoryHygieneTrendTool({ paths: options.paths })));
    return true;
  }

  if (memoryCommand === "hygiene_doctor") {
    const plan = await planMemoryHygieneTool({ paths: options.paths });
    const report = await buildMemoryHygieneDoctorReport({ paths: options.paths, plan, deletePolicy: options.config.memory?.deletePolicy ?? "ask", retrievalPolicy: options.config.memory?.retrievalPolicy ?? "full" });
    const trend = await recordMemoryHygieneSnapshot({ paths: options.paths, plan, score: report.score, source: "telegram:doctor" });
    await sendTelegramTextChunks(options.client, chatId, formatMemoryHygieneDoctorReport(report, trend));
    return true;
  }

  if (memoryCommand === "hygiene_apply" || memoryCommand === "hygiene_apply_confirm") {
    await sendTelegramTextChunks(options.client, chatId, await applyMemoryHygienePlanForChannel({ plan: await planMemoryHygieneTool({ paths: options.paths }), paths: options.paths, deletePolicy: options.config.memory?.deletePolicy ?? "ask", confirmed: memoryCommand === "hygiene_apply_confirm" }));
    return true;
  }

  if (memoryCommand === "governance_status") {
    const analysis = await analyzeMemoriesTool({ paths: options.paths, mode: "all" });
    await sendTelegramTextChunks(options.client, chatId, formatMemoryGovernanceStatus(analysis, options.config.memory?.retrievalPolicy ?? "full"));
    return true;
  }

  if (memoryCommand?.startsWith("pin:") || memoryCommand?.startsWith("unpin:")) {
    const [action, rawId] = memoryCommand.split(":");
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      await options.client.sendMessage(chatId, "Usage: /memory pin <id> or /memory unpin <id>");
      return true;
    }

    const pinned = action === "pin";
    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const updated = store.setMemoryPinned(id, pinned);
      await options.client.sendMessage(chatId, updated ? `Memory ${pinned ? "pinned" : "unpinned"}: #${updated.id}` : `No active memory found for id ${id}.`);
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand?.startsWith("move:")) {
    const [, rawId, scope] = memoryCommand.split(":");
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0 || !isMemoryScope(scope)) {
      await options.client.sendMessage(chatId, "Usage: /memory move <id> core|project|session");
      return true;
    }

    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const updated = store.setMemoryScope(id, scope);
      await options.client.sendMessage(chatId, updated ? `Memory #${updated.id} moved to ${updated.scope}.` : `No active memory found for id ${id}.`);
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
      await options.client.sendMessage(chatId, "Usage: /memory supersede <oldId> <newId>");
      return true;
    }

    const store = await SqliteMemoryStore.open(options.paths);
    try {
      const updated = store.supersedeMemory(oldId, newId);
      await options.client.sendMessage(chatId, updated ? `Memory #${updated.id} superseded by #${updated.supersededBy}.` : "Could not supersede memory. Make sure both ids are active and different.");
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand?.startsWith("governance_policy:")) {
    const policy = memoryCommand.split(":")[1];
    if (!isMemoryRetrievalPolicy(policy)) {
      await options.client.sendMessage(chatId, "Usage: /memory governance policy full|governed");
      return true;
    }

    await setMemoryRetrievalPolicy(policy, options.paths);
    await options.client.sendMessage(chatId, formatMemoryRetrievalPolicyUpdated(policy));
    return true;
  }

  if (memoryCommand?.startsWith("maintenance:")) {
    const action = memoryCommand.split(":")[1];
    const destination = `telegram:${chatId}`;

    if (action === "install") {
      const result = await installMemoryMaintenanceReport({ paths: options.paths, channel: destination, timeZone: options.config.agent.timeZone });
      await options.client.sendMessage(chatId, result.ok ? formatMemoryMaintenanceInstalled(result.schedule) : result.reason);
      return true;
    }

    if (action === "status") {
      await options.client.sendMessage(chatId, formatMemoryMaintenanceStatus(await getMemoryMaintenanceReportStatus(options.paths)));
      return true;
    }

    if (action === "remove") {
      await options.client.sendMessage(chatId, formatMemoryMaintenanceRemoved(await removeMemoryMaintenanceReport(options.paths)));
      return true;
    }
  }

  if (memoryCommand === "pending") {
    const store = await SqliteMemoryStore.open(options.paths);

    try {
      const memories = store.listPendingMemories(5);

      if (memories.length === 0) {
        await options.client.sendMessage(chatId, "No pending memories.");
        return true;
      }

      await options.client.sendMessage(chatId, `Pending memories:\n${memories.map((memory) => `${memory.id}. [${memory.type}] ${memory.content}\n   Reason: ${memory.reason || "needs review"}`).join("\n")}`);
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand?.startsWith("pending_inspect:")) {
    const id = Number(memoryCommand.split(":")[1]);
    const store = await SqliteMemoryStore.open(options.paths);

    try {
      const memory = store.getPendingMemoryById(id);

      if (!memory) {
        await options.client.sendMessage(chatId, `No pending memory found for id ${id}.`);
        return true;
      }

      await options.client.sendMessage(chatId, `Pending memory ${memory.id}\nType: ${memory.type}\nSource: ${memory.source}\nCreated: ${memory.createdAt}\nReason: ${memory.reason || "needs review"}\nContent: ${memory.content}\nApprove/reject from CLI for now: bestie memory approve ${memory.id} | bestie memory reject ${memory.id}`);
      return true;
    } finally {
      store.close();
    }
  }

  if (memoryCommand?.startsWith("graph_pending_sanitize:")) {
    const id = Number(memoryCommand.split(":")[1]);
    const store = await SqliteMemoryStore.open(options.paths);

    try {
      await sendTelegramTextChunks(options.client, chatId, formatPendingKnowledgeSanitizeResult(id, store.sanitizePendingKnowledgeItem(id), "/memory graph"));
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

function formatPendingApprovalSummary(approval: { id: number; category: string; action: string; target?: string | null; reason?: string | null }): string {
  return redactSecrets(
    [
      `Request ${approval.id}`,
      `Action: ${approval.action}`,
      `Category: ${approval.category}`,
      approval.target ? `Target: ${approval.target}` : undefined,
      approval.reason ? `Reason: ${approval.reason}` : undefined,
      `Reply with /approve ${approval.id} or /deny ${approval.id}.`,
    ].filter(Boolean).join("\n"),
  );
}

function parseTelegramApprovalDecision(text: string): { decision: "approve" | "deny"; id: number } | undefined {
  const match = text.match(/^\/(approve|deny) (\d+)$/);

  if (!match) {
    return undefined;
  }

  return { decision: match[1] as "approve" | "deny", id: Number(match[2]) };
}

function parseTelegramApprovalCallback(data: string): { decision: "approve" | "deny"; id: number } | undefined {
  const match = data.match(/^approval:(approve|deny):(\d+)$/);

  if (!match) {
    return undefined;
  }

  return { decision: match[1] as "approve" | "deny", id: Number(match[2]) };
}

function createApprovalReplyMarkup(approvalId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "Approve", callback_data: `approval:approve:${approvalId}` },
        { text: "Deny", callback_data: `approval:deny:${approvalId}` },
      ],
    ],
  };
}

function isPendingMemoryToolResult(value: unknown): value is { id: number; status: "pending" } {
  return typeof value === "object" && value !== null && "id" in value && "status" in value && Number.isInteger((value as { id: unknown }).id) && (value as { status: unknown }).status === "pending";
}

function formatPendingKnowledgePayloadSummary(payload: unknown): string {
  const text = JSON.stringify(payload);
  if (!text) {
    return "Payload: empty";
  }
  return `Payload: ${text.length > 500 ? `${text.slice(0, 497)}...` : text}`;
}

function parseTelegramMemoryCommand(text: string): "list" | "tiers" | "rebalance" | "rebalance_apply" | "rebalance_apply_confirm" | "summary" | "digest" | "pending" | `pending_inspect:${number}` | `graph_pending_sanitize:${number}` | "pause" | "resume" | "analyze" | "cleanup_dry_run" | "hygiene" | "hygiene_status" | "hygiene_trend" | "hygiene_doctor" | "hygiene_apply" | "hygiene_apply_confirm" | "governance_status" | `governance_policy:${string}` | `pin:${number}` | `unpin:${number}` | `scope:${string}` | `inspect:${number}` | `move:${number}:${string}` | `supersede:${number}:${number}` | "maintenance:install" | "maintenance:status" | "maintenance:remove" | undefined {
  if (text === "/memory" || text === "/memory list" || text === "/memory status") {
    return "list";
  }

  if (text === "/memory pending") {
    return "pending";
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

  const pendingInspectMatch = text.match(/^\/memory pending inspect (\d+)$/);
  if (pendingInspectMatch) {
    return `pending_inspect:${Number(pendingInspectMatch[1])}`;
  }

  const graphPendingSanitizeMatch = text.match(/^\/(?:memory graph|graph) pending sanitize (\d+)$/);
  if (graphPendingSanitizeMatch) {
    return `graph_pending_sanitize:${Number(graphPendingSanitizeMatch[1])}`;
  }

  if (text === "/memory pause" || text === "/pause_memory" || text === "/pause-memory") {
    return "pause";
  }

  if (text === "/memory resume" || text === "/resume_memory" || text === "/resume-memory") {
    return "resume";
  }

  return undefined;
}

async function loadRecentTelegramTurns(paths: RuntimePaths, userId: string, recentMessageLimit: number): Promise<ChatMessage[]> {
  const store = await SqliteMemoryStore.open(paths);

  try {
    if (store.getMemoryState().paused) {
      return [];
    }

    return store.listRecentMessagesForChannel("telegram", userId, recentMessageLimit).map((message) => ({ role: message.role, content: message.content }));
  } finally {
    store.close();
  }
}

async function persistTelegramConversationTurn(paths: RuntimePaths, userId: string, userInput: string, assistantText: string): Promise<void> {
  const store = await SqliteMemoryStore.open(paths);

  try {
    if (store.getMemoryState().paused) {
      return;
    }

    store.addMessage({ channel: "telegram", userId, role: "user", content: userInput });
    store.addMessage({ channel: "telegram", userId, role: "assistant", content: assistantText });
  } finally {
    store.close();
  }
}
