import { buildAgentToolResultMessage, buildMcpToolSystemPrompt, completeWithAgentTools, formatToolRequestName, parseAgentToolDecisionResult, runAgentToolRequest, type AgentToolActivity } from "../../chat/mcp-tool-use.js";
import { buildChannelAgentToolRunner, resolveWorkforceAgentRuntime } from "../../agents/channel-binding.js";
import { buildChatMessages, getRecentMessageLimit } from "../../chat/message-builder.js";
import { loadSystemPrompt } from "../../character/prompt-loader.js";
import { getProviderAdapterMetadata } from "../../llm/adapters/registry.js";
import { sendChatCompletionWithFallbacks } from "../../llm/chat-completion.js";
import { loadLlmCandidateSecret, resolvePrimaryLlmCandidate } from "../../llm/resolve-config.js";
import type { ChatCompletionOptions, ChatMessage } from "../../llm/types.js";
import { loadUiConversationSummaryContext, refreshUiConversationSummary } from "../../memory/conversation-summary.js";
import { loadRelevantMemories } from "../../memory/context.js";
import { loadRelevantKnowledgeGraph } from "../../memory/knowledge-context.js";
import { runKnowledgeReasoningPass, type KnowledgeReasoningResult } from "../../memory/knowledge-reasoning.js";
import { SqliteMemoryStore, type UiChatSession } from "../../memory/sqlite-store.js";
import { loadConfig } from "../../runtime/config.js";
import { appendLog } from "../../runtime/logger.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { executeApprovedAction } from "../../safety/approval-executor.js";
import type { ActionPermissionRequest, ActionPermissionResult } from "../../safety/permission-policy.js";
import type { AgentOutboundFileSender, ResolvedOutboundFilePayload } from "../../tools/channel-send-tools.js";

export interface UiChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface UiChatOptions {
  message: string;
  sessionId?: number;
  history?: UiChatMessage[];
  attachments?: UiChatAttachment[];
  toolsEnabled?: boolean;
  memoryEnabled?: boolean;
  providerModelRef?: string;
  replaySourceRunId?: number;
  paths?: RuntimePaths;
  stream?: boolean;
  chatCompletion?: (config: Awaited<ReturnType<typeof loadConfig>>, apiKey: string, options: ChatCompletionOptions) => Promise<string>;
  onToken?: (token: string) => void;
  onToolActivity?: (activity: AgentToolActivity) => void | Promise<void>;
  onTimelineEvent?: (event: UiChatTimelineEvent) => void | Promise<void>;
}

export interface UiChatAttachment {
  name: string;
  type?: string;
  size?: number;
  content: string;
}

interface UiChatOutboundAttachment extends UiChatAttachment {
  channel: "ui-chat";
}

export type UiChatTimelineEventType = "thinking" | "tool_start" | "tool_finish" | "token" | "approval_required" | "memory_capture" | "done" | "error";

export interface UiChatTimelineEvent {
  type: UiChatTimelineEventType;
  label: string;
  runId?: number;
  payload?: unknown;
}

interface UiChatTimelineSink {
  onTimelineEvent?: (event: UiChatTimelineEvent) => void | Promise<void>;
  runId?: number;
}

interface PersistedUiChatUserMessage {
  session: import("../../memory/sqlite-store.js").UiChatSession;
  message: import("../../memory/sqlite-store.js").UiChatMessage;
}

const activeUiChatSessionRuns = new Set<number>();

export interface UiChatResult {
  ok: true;
  session?: import("../../memory/sqlite-store.js").UiChatSession;
  run?: import("../../memory/sqlite-store.js").UiChatRun;
  answer: string;
  model: string;
  toolActivities: AgentToolActivity[];
}

export interface UiChatContinueOptions {
  sessionId: number;
  approvalId: number;
  paths?: RuntimePaths;
  stream?: boolean;
  onToken?: (token: string) => void;
  onTimelineEvent?: (event: UiChatTimelineEvent) => void | Promise<void>;
}

export interface UiChatSessionsSummary {
  ok: true;
  sessions: import("../../memory/sqlite-store.js").UiChatSession[];
}

export interface UiChatSessionSearchOptions {
  query?: string;
  filter?: "all" | "approval" | "cancelled" | "error" | "fork" | "retry";
  paths?: RuntimePaths;
}

export interface UiChatSessionMessagesSummary {
  ok: true;
  session: import("../../memory/sqlite-store.js").UiChatSession;
  messages: import("../../memory/sqlite-store.js").UiChatMessage[];
  events: import("../../memory/sqlite-store.js").UiChatEvent[];
  runs: import("../../memory/sqlite-store.js").UiChatRun[];
  approvals?: Record<string, import("../../memory/sqlite-store.js").PendingActionApproval>;
  branch?: UiChatBranchSummary;
}

export interface UiChatBranchSummary {
  parent?: import("../../memory/sqlite-store.js").UiChatBranchLink;
  children: import("../../memory/sqlite-store.js").UiChatBranchLink[];
}

export interface UiChatRetrySummary extends UiChatSessionMessagesSummary {
  retryMessage: string;
  history: UiChatMessage[];
  replay?: {
    runId: number;
    toolsEnabled?: boolean;
    memoryEnabled?: boolean;
    providerModelRef?: string;
    attachments?: UiChatAttachment[];
  };
}

export interface UiChatReplayOptions {
  sessionId: number;
  runId: number;
  paths?: RuntimePaths;
}

export interface UiChatForkOptions {
  sessionId: number;
  messageId: number;
  title?: string;
  paths?: RuntimePaths;
}

export interface UiChatEventsSummary {
  ok: true;
  events: import("../../memory/sqlite-store.js").UiChatEvent[];
  approvals?: Record<string, import("../../memory/sqlite-store.js").PendingActionApproval>;
}

export interface UiChatExportSummary extends UiChatSessionMessagesSummary {
  export: {
    version: 1;
    exportedAt: string;
    session: import("../../memory/sqlite-store.js").UiChatSession;
    messages: import("../../memory/sqlite-store.js").UiChatMessage[];
    events: import("../../memory/sqlite-store.js").UiChatEvent[];
  };
  markdown: string;
}

export interface UiChatImportOptions {
  title?: string;
  messages: UiChatMessage[];
  events?: Array<{ eventType?: string; type?: string; label?: string; payloadJson?: string; payload?: unknown }>;
  paths?: RuntimePaths;
}

export async function getUiChatSessions(paths: RuntimePaths = getRuntimePaths()): Promise<UiChatSessionsSummary> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    const config = await loadConfig(paths);
    return { ok: true, sessions: sanitizeUiChatSessions(store, config, store.listUiChatSessions()) };
  } finally {
    store.close();
  }
}

export async function searchUiChatSessions(options: UiChatSessionSearchOptions = {}): Promise<UiChatSessionsSummary> {
  const paths = options.paths ?? getRuntimePaths();
  const store = await SqliteMemoryStore.open(paths);
  try {
    const config = await loadConfig(paths);
    return { ok: true, sessions: sanitizeUiChatSessions(store, config, store.searchUiChatSessions({ query: options.query, eventType: chatSessionFilterToEventType(options.filter) })) };
  } finally {
    store.close();
  }
}

function chatSessionFilterToEventType(filter: UiChatSessionSearchOptions["filter"]): string | undefined {
  if (filter === "approval") return "approval_required";
  if (filter === "cancelled") return "cancelled";
  if (filter === "error") return "error";
  if (filter === "fork") return "fork";
  if (filter === "retry") return "retry";
  return undefined;
}

function resolveValidUiProviderModelRef(config: Awaited<ReturnType<typeof loadConfig>>, modelRef: string | undefined): string | undefined {
  if (!modelRef) return undefined;
  return config.llm.modelCatalog[modelRef] ? modelRef : undefined;
}

function sanitizeUiChatSessions(store: SqliteMemoryStore, config: Awaited<ReturnType<typeof loadConfig>>, sessions: UiChatSession[]): UiChatSession[] {
  return sessions.map((session) => sanitizeUiChatSession(store, config, session));
}

function sanitizeUiChatSession(store: SqliteMemoryStore, config: Awaited<ReturnType<typeof loadConfig>>, session: UiChatSession): UiChatSession {
  if (!session.providerModelRef || config.llm.modelCatalog[session.providerModelRef]) {
    return session;
  }

  return store.updateUiChatSessionPreferences(session.id, { providerModelRef: null });
}

async function sanitizeUiChatSessionById(paths: RuntimePaths, config: Awaited<ReturnType<typeof loadConfig>>, sessionId: number): Promise<void> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    sanitizeUiChatSession(store, config, store.getUiChatSession(sessionId));
  } finally {
    store.close();
  }
}

export async function createUiChatSession(title?: string, agentIdOrPaths?: string | RuntimePaths, suppliedPaths?: RuntimePaths): Promise<UiChatSessionMessagesSummary> {
  const paths = typeof agentIdOrPaths === "object" ? agentIdOrPaths : suppliedPaths ?? getRuntimePaths();
  const agentId = typeof agentIdOrPaths === "string" ? agentIdOrPaths : undefined;
  const store = await SqliteMemoryStore.open(paths);
  try {
    const config = await loadConfig(paths);
    const resolvedAgentId = resolveUiChatAgentId(config, agentId);
    const session = store.createUiChatSession(title, resolvedAgentId);
    return { ok: true, session, messages: [], events: [], runs: [] };
  } finally {
    store.close();
  }
}

export async function updateUiChatSession(options: { id: number; title?: string; pinned?: boolean; toolsEnabled?: boolean; memoryEnabled?: boolean; providerModelRef?: string | null; paths?: RuntimePaths }): Promise<UiChatSessionMessagesSummary> {
  const paths = options.paths ?? getRuntimePaths();
  const store = await SqliteMemoryStore.open(paths);
  try {
    if (typeof options.title === "string") store.updateUiChatSessionTitle(options.id, options.title);
    if (typeof options.pinned === "boolean") store.updateUiChatSessionPinned(options.id, options.pinned);
    if ("toolsEnabled" in options || "memoryEnabled" in options || "providerModelRef" in options) {
      const config = await loadConfig(paths);
      const providerModelRef = "providerModelRef" in options
        ? options.providerModelRef === null ? null : resolveValidUiProviderModelRef(config, options.providerModelRef) ?? null
        : undefined;
      store.updateUiChatSessionPreferences(options.id, { ...options, providerModelRef });
    }
    const config = await loadConfig(paths);
    const session = sanitizeUiChatSession(store, config, store.getUiChatSession(options.id));
    const events = store.listUiChatEvents(options.id);
    return { ok: true, session, messages: store.listUiChatMessages(options.id), events, runs: store.listUiChatRuns(options.id), approvals: collectChatApprovalStatuses(store, events), branch: collectChatBranch(store, options.id) };
  } finally {
    store.close();
  }
}

export async function getUiChatSessionMessages(sessionId: number, paths: RuntimePaths = getRuntimePaths()): Promise<UiChatSessionMessagesSummary> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    const config = await loadConfig(paths);
    const session = sanitizeUiChatSession(store, config, store.getUiChatSession(sessionId));
    const events = store.listUiChatEvents(sessionId);
    return { ok: true, session, messages: store.listUiChatMessages(sessionId), events, runs: store.listUiChatRuns(sessionId), approvals: collectChatApprovalStatuses(store, events), branch: collectChatBranch(store, sessionId) };
  } finally {
    store.close();
  }
}

export async function getUiChatSessionEvents(sessionId: number, paths: RuntimePaths = getRuntimePaths()): Promise<UiChatEventsSummary> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    const events = store.listUiChatEvents(sessionId);
    return { ok: true, events, approvals: collectChatApprovalStatuses(store, events) };
  } finally {
    store.close();
  }
}

export async function exportUiChatSession(sessionId: number, paths: RuntimePaths = getRuntimePaths()): Promise<UiChatExportSummary> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    const session = store.getUiChatSession(sessionId);
    const messages = store.listUiChatMessages(sessionId);
    const events = store.listUiChatEvents(sessionId);
    return {
      ok: true,
      session,
      messages,
      events,
      runs: store.listUiChatRuns(sessionId),
      approvals: collectChatApprovalStatuses(store, events),
      branch: collectChatBranch(store, sessionId),
      export: { version: 1, exportedAt: new Date().toISOString(), session, messages, events },
      markdown: formatChatExportMarkdown(session, messages, events),
    };
  } finally {
    store.close();
  }
}

export async function importUiChatSession(options: UiChatImportOptions): Promise<UiChatSessionMessagesSummary> {
  const store = await SqliteMemoryStore.open(options.paths ?? getRuntimePaths());
  try {
    const session = store.createUiChatSession(options.title ? `${options.title} import` : "Imported chat");
    for (const message of options.messages.slice(0, 160)) {
      if ((message.role === "user" || message.role === "assistant") && message.content.trim()) store.addUiChatMessage(session.id, message.role, message.content);
    }
    for (const event of (options.events ?? []).slice(0, 160)) {
      const eventType = typeof event.eventType === "string" ? event.eventType : typeof event.type === "string" ? event.type : undefined;
      if (!eventType) continue;
      store.addUiChatEvent(session.id, eventType, typeof event.label === "string" ? event.label : undefined, typeof event.payloadJson === "string" ? event.payloadJson : event.payload === undefined ? undefined : JSON.stringify(event.payload));
    }
    const events = store.listUiChatEvents(session.id);
    return { ok: true, session: store.getUiChatSession(session.id), messages: store.listUiChatMessages(session.id), events, runs: store.listUiChatRuns(session.id), approvals: collectChatApprovalStatuses(store, events), branch: collectChatBranch(store, session.id) };
  } finally {
    store.close();
  }
}

function formatChatExportMarkdown(session: import("../../memory/sqlite-store.js").UiChatSession, messages: import("../../memory/sqlite-store.js").UiChatMessage[], events: import("../../memory/sqlite-store.js").UiChatEvent[]): string {
  const lines = [`# ${session.title}`, "", `- Session: ${session.id}`, `- Exported: ${new Date().toISOString()}`, `- Messages: ${messages.length}`, `- Events: ${events.length}`, ""];
  for (const message of messages) {
    lines.push(`## ${message.role === "user" ? "User" : "Assistant"}`, "", message.content, "");
  }
  if (events.length) {
    lines.push("## Timeline", "");
    for (const event of events) lines.push(`- ${event.eventType}: ${event.label ?? event.createdAt}`);
    lines.push("");
  }
  return lines.join("\n");
}

export async function deleteUiChatSession(sessionId: number, paths: RuntimePaths = getRuntimePaths()): Promise<UiChatSessionsSummary> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    store.deleteUiChatSession(sessionId);
    return { ok: true, sessions: store.listUiChatSessions() };
  } finally {
    store.close();
  }
}

export async function prepareUiChatRetry(sessionId: number, messageId?: number, paths: RuntimePaths = getRuntimePaths()): Promise<UiChatRetrySummary> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    const session = store.getUiChatSession(sessionId);
    const messages = store.listUiChatMessages(session.id);
    const lastUser = messageId === undefined
      ? [...messages].reverse().find((message) => message.role === "user")
      : messages.find((message) => message.id === messageId && message.role === "user");
    if (!lastUser) {
      throw new Error(`UI chat session has no user message to retry: ${session.id}`);
    }
    store.deleteUiChatMessagesAfter(session.id, lastUser.id);
    store.addUiChatEvent(session.id, "retry", messageId === undefined ? "Retrying last user message" : "Retrying selected user message", JSON.stringify({ messageId: lastUser.id }));
    const nextMessages = store.listUiChatMessages(session.id);
    const events = store.listUiChatEvents(session.id);
    return {
      ok: true,
      session: store.getUiChatSession(session.id),
      messages: nextMessages,
      events,
      runs: store.listUiChatRuns(session.id),
      approvals: collectChatApprovalStatuses(store, events),
      branch: collectChatBranch(store, session.id),
      retryMessage: lastUser.content,
      history: nextMessages.filter((message) => message.id < lastUser.id).map((message) => ({ role: message.role, content: message.content })),
    };
  } finally {
    store.close();
  }
}

export async function prepareUiChatRunReplay(options: UiChatReplayOptions): Promise<UiChatRetrySummary> {
  const store = await SqliteMemoryStore.open(options.paths ?? getRuntimePaths());
  try {
    const session = store.getUiChatSession(options.sessionId);
    const run = store.listUiChatRuns(session.id).find((candidate) => candidate.id === options.runId);
    if (!run?.userMessageId) {
      throw new Error(`UI chat run cannot be replayed: ${options.runId}`);
    }
    const messages = store.listUiChatMessages(session.id);
    const userMessage = messages.find((message) => message.id === run.userMessageId && message.role === "user");
    if (!userMessage) {
      throw new Error(`UI chat run user message not found: ${options.runId}`);
    }
    const metadata = parseChatRunMetadata(run.metadataJson);
    store.deleteUiChatMessagesAfter(session.id, userMessage.id);
    store.addUiChatEvent(session.id, "retry", "Replaying selected run", JSON.stringify({ runId: run.id, messageId: userMessage.id }));
    const nextMessages = store.listUiChatMessages(session.id);
    const events = store.listUiChatEvents(session.id);
    return {
      ok: true,
      session: store.getUiChatSession(session.id),
      messages: nextMessages,
      events,
      runs: store.listUiChatRuns(session.id),
      approvals: collectChatApprovalStatuses(store, events),
      branch: collectChatBranch(store, session.id),
      retryMessage: typeof metadata.input === "string" && metadata.input.trim() ? metadata.input : userMessage.content,
      history: nextMessages.filter((message) => message.id < userMessage.id).map((message) => ({ role: message.role, content: message.content })),
      replay: {
        runId: run.id,
        toolsEnabled: typeof metadata.toolsEnabled === "boolean" ? metadata.toolsEnabled : undefined,
        memoryEnabled: typeof metadata.memoryEnabled === "boolean" ? metadata.memoryEnabled : undefined,
        providerModelRef: typeof metadata.providerModelRef === "string" ? metadata.providerModelRef : undefined,
        attachments: readReplayAttachments(metadata.attachments),
      },
    };
  } finally {
    store.close();
  }
}

export async function forkUiChatSession(options: UiChatForkOptions): Promise<UiChatSessionMessagesSummary> {
  const paths = options.paths ?? getRuntimePaths();
  const store = await SqliteMemoryStore.open(paths);
  try {
    const fork = store.forkUiChatSession(options.sessionId, options.messageId, options.title);
    const events = store.listUiChatEvents(fork.id);
    return { ok: true, session: fork, messages: store.listUiChatMessages(fork.id), events, runs: store.listUiChatRuns(fork.id), approvals: collectChatApprovalStatuses(store, events), branch: collectChatBranch(store, fork.id) };
  } finally {
    store.close();
  }
}

function collectChatBranch(store: SqliteMemoryStore, sessionId: number): UiChatBranchSummary {
  const links = store.listUiChatBranchLinks();
  return {
    parent: links.find((link) => link.sessionId === sessionId),
    children: links.filter((link) => link.sourceSessionId === sessionId),
  };
}

export async function runUiChatContinue(options: UiChatContinueOptions): Promise<UiChatSessionMessagesSummary> {
  const paths = options.paths ?? getRuntimePaths();
  const baseConfig = await loadConfig(paths);
  const store = await SqliteMemoryStore.open(paths);
  try {
    const session = store.getUiChatSession(options.sessionId);
    const agentRuntime = await resolveWorkforceAgentRuntime(baseConfig, paths, session.agentId, "the Web UI chat", `ui-chat:agent:${session.agentId}:session:${session.id}`);
    const config = agentRuntime?.config ?? baseConfig;
    const approval = store.getPendingActionApprovalById(options.approvalId);
    if (!approval || approval.channel !== "ui-chat" || approval.userId !== `session:${session.id}`) {
      throw new Error(`Chat approval not found for session ${session.id}: ${options.approvalId}`);
    }
    if (approval.status === "executed") {
      await emitTimelineEvent(paths, session.id, options, { type: "done", label: "Approved action already continued", payload: { approvalId: approval.id, status: approval.status } });
      const events = store.listUiChatEvents(session.id);
      return { ok: true, session: store.getUiChatSession(session.id), messages: store.listUiChatMessages(session.id), events, runs: store.listUiChatRuns(session.id), approvals: collectChatApprovalStatuses(store, events) };
    }
    if (approval.status !== "approved") {
      throw new Error(`Chat approval must be approved before continue: ${options.approvalId}`);
    }

    await emitTimelineEvent(paths, session.id, options, { type: "tool_start", label: `Continuing ${approval.action}`, payload: { approvalId: approval.id, action: approval.action, target: approval.target } });
    const outboundAttachments: UiChatOutboundAttachment[] = [];
    const execution = await executeApprovedAction(store, approval, "approve", { config, paths, outboundFileSender: createUiOutboundFileSender(session.id, outboundAttachments) });
    await emitTimelineEvent(paths, session.id, options, { type: execution.status === "executed" ? "tool_finish" : "error", label: execution.shortText, payload: { approvalId: approval.id, status: execution.status, message: execution.message } });

    const finalAnswer = await synthesizeContinuedChatAnswer(paths, config, session.id, execution, options, agentRuntime?.systemPrompt).catch((error) => {
      void emitTimelineEvent(paths, session.id, options, { type: "error", label: error instanceof Error ? error.message : "Unable to synthesize continued response.", payload: { approvalId: approval.id } });
      return execution.message;
    });
    store.addUiChatMessage(session.id, "assistant", finalAnswer, undefined, buildUiMessageMetadata(outboundAttachments));
    await emitTimelineEvent(paths, session.id, options, { type: "done", label: "Approved action continued", payload: { approvalId: approval.id, status: execution.status, characters: finalAnswer.length } });
    const events = store.listUiChatEvents(session.id);
    return { ok: true, session: store.getUiChatSession(session.id), messages: store.listUiChatMessages(session.id), events, runs: store.listUiChatRuns(session.id), approvals: collectChatApprovalStatuses(store, events) };
  } finally {
    store.close();
  }
}

function collectChatApprovalStatuses(store: SqliteMemoryStore, events: import("../../memory/sqlite-store.js").UiChatEvent[]): Record<string, import("../../memory/sqlite-store.js").PendingActionApproval> {
  const approvals: Record<string, import("../../memory/sqlite-store.js").PendingActionApproval> = {};
  for (const event of events) {
    const approvalId = readTimelineApprovalId(event.payloadJson);
    if (approvalId === undefined || approvals[String(approvalId)]) continue;
    const approval = store.getPendingActionApprovalById(approvalId);
    if (approval) approvals[String(approvalId)] = approval;
  }
  return approvals;
}

function readTimelineApprovalId(payloadJson: string | undefined): number | undefined {
  if (!payloadJson) return undefined;
  try {
    const payload = JSON.parse(payloadJson) as unknown;
    return payload && typeof payload === "object" && typeof (payload as { approvalId?: unknown }).approvalId === "number" ? (payload as { approvalId: number }).approvalId : undefined;
  } catch {
    return undefined;
  }
}

function parseChatRunMetadata(metadataJson: string | undefined): Record<string, unknown> {
  if (!metadataJson) return {};
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readReplayAttachments(value: unknown): UiChatAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments = value.slice(0, 5).flatMap((attachment) => {
    if (!attachment || typeof attachment !== "object") return [];
    const item = attachment as Record<string, unknown>;
    if (typeof item.name !== "string" || typeof item.content !== "string") return [];
    if (item.content === UI_IMAGE_CONTENT_OMITTED) return [];
    return [{ name: item.name, type: typeof item.type === "string" ? item.type : undefined, size: typeof item.size === "number" ? item.size : undefined, content: item.content.slice(0, 64 * 1024) }];
  });
  return attachments.length ? attachments : undefined;
}

async function synthesizeContinuedChatAnswer(paths: RuntimePaths, config: Awaited<ReturnType<typeof loadConfig>>, sessionId: number, execution: Awaited<ReturnType<typeof executeApprovedAction>>, options?: UiChatContinueOptions, agentSystemPrompt?: string): Promise<string> {
  if (!execution.request || !execution.toolResult) {
    return execution.message;
  }

  const apiKey = await loadLlmCandidateSecret(resolvePrimaryLlmCandidate(config), paths);
  const systemPrompt = agentSystemPrompt ?? await loadSystemPrompt(paths);
  const store = await SqliteMemoryStore.open(paths);
  try {
    const recentMessageLimit = getRecentMessageLimit(config);
    const history = toChatHistory(store.listUiChatMessages(sessionId, recentMessageLimit).map((message) => ({ role: message.role, content: message.content })), recentMessageLimit);
    const conversationSummary = await loadUiConversationSummaryContext(paths, sessionId);
    const toolName = formatToolRequestName(execution.request);
    const messages = [
      { role: "system" as const, content: buildMcpToolSystemPrompt(systemPrompt, config) },
      ...conversationSummary,
      ...history,
      { role: "user" as const, content: buildAgentToolResultMessage(toolName, execution.toolResult) },
    ];
    const answer = await sendChatCompletionWithFallbacks(config, { messages, stream: options?.stream === true, onToken: options?.onToken }, { paths });
    const decision = parseAgentToolDecisionResult(answer);
    return decision.kind === "answer" ? decision.content : answer.trim() || execution.message;
  } finally {
    store.close();
  }
}

function appendAttachmentContext(userInput: string, attachments: UiChatAttachment[] | undefined): string {
  const safeAttachments = (attachments ?? []).filter((attachment) => attachment.name && attachment.content).slice(0, 5);
  if (!safeAttachments.length) return userInput;
  const blocks = safeAttachments.map((attachment, index) => [
    `Attachment ${index + 1}: ${attachment.name}`,
    `Type: ${attachment.type ?? "text/plain"}`,
    `Size: ${attachment.size ?? attachment.content.length} bytes`,
    isUiImageAttachment(attachment)
      ? `Content: ${isSupportedUiImageDataUrl(attachment.content) ? "[image attached for vision input]" : "[image attachment omitted from text context]"}`
      : ["Content:", attachment.content.slice(0, 64 * 1024)].join("\n"),
  ].join("\n"));
  return `${userInput}\n\nAttached context:\n${blocks.join("\n\n---\n\n")}`;
}

const UI_SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const UI_IMAGE_CONTENT_OMITTED = "[image data omitted]";

function isUiImageAttachment(attachment: UiChatAttachment): boolean {
  const type = attachment.type?.toLowerCase() ?? "";
  return type.startsWith("image/") || attachment.content.startsWith("data:image/");
}

function isSupportedUiImageDataUrl(value: string): boolean {
  return /^data:image\/(?:jpeg|png|webp|gif);base64,[a-z0-9+/=\r\n]+$/i.test(value);
}

function resolveUiVisionImageUrls(config: Awaited<ReturnType<typeof loadConfig>>, attachments: UiChatAttachment[] | undefined): string[] {
  if (!attachments?.length) return [];
  const provider = resolvePrimaryLlmCandidate(config).provider;
  if (!getProviderAdapterMetadata(provider).supportsVision) return [];
  return attachments
    .filter((attachment) => {
      const type = attachment.type?.toLowerCase() ?? "";
      return (!type || UI_SUPPORTED_IMAGE_MIME_TYPES.has(type)) && isSupportedUiImageDataUrl(attachment.content);
    })
    .slice(0, 5)
    .map((attachment) => attachment.content);
}

function attachUiVisionImages(messages: ChatMessage[], promptInput: string, imageUrls: string[]): void {
  if (!imageUrls.length) return;
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUserMessage) return;
  lastUserMessage.content = [
    { type: "text", text: promptInput },
    ...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
}

export async function runUiChat(options: UiChatOptions): Promise<UiChatResult> {
  if (options.sessionId !== undefined) {
    if (activeUiChatSessionRuns.has(options.sessionId)) {
      throw new Error("Chat session is already streaming. Wait for the current response or stop it before sending another message.");
    }
    activeUiChatSessionRuns.add(options.sessionId);
  }

  try {
    return await runUiChatUnlocked(options);
  } finally {
    if (options.sessionId !== undefined) activeUiChatSessionRuns.delete(options.sessionId);
  }
}

async function runUiChatUnlocked(options: UiChatOptions): Promise<UiChatResult> {
  const paths = options.paths ?? getRuntimePaths();
  const userInput = options.message.trim();
  if (!userInput) throw new Error("Chat message is required.");

  const baseConfig = await loadConfig(paths);
  const providerModelRef = resolveValidUiProviderModelRef(baseConfig, options.providerModelRef);
  if (options.sessionId !== undefined) await sanitizeUiChatSessionById(paths, baseConfig, options.sessionId);
  const sessionBeforeRun = options.sessionId === undefined ? undefined : (await getUiChatSessionMessages(options.sessionId, paths)).session;
  const agentRuntime = await resolveWorkforceAgentRuntime(baseConfig, paths, sessionBeforeRun?.agentId, "the Web UI chat", sessionBeforeRun ? `ui-chat:agent:${sessionBeforeRun.agentId}:session:${sessionBeforeRun.id}` : undefined);
  const applyProviderOverride = (config: Awaited<ReturnType<typeof loadConfig>>) => !agentRuntime && providerModelRef ? { ...config, llm: { ...config.llm, primary: providerModelRef } } : config;
  const config = applyProviderOverride(agentRuntime?.config ?? baseConfig);
  const systemPrompt = agentRuntime?.systemPrompt ?? await loadSystemPrompt(paths);
  const apiKey = await loadLlmCandidateSecret(resolvePrimaryLlmCandidate(config), paths);
  const chatCompletion = options.chatCompletion ?? ((currentConfig: typeof config, _apiKey: string, requestOptions: ChatCompletionOptions) => sendChatCompletionWithFallbacks(currentConfig, requestOptions, { paths }));
  const recentMessageLimit = getRecentMessageLimit(config);
  const history = toChatHistory(await resolveUiChatHistory(paths, options, recentMessageLimit), recentMessageLimit);
  const promptInput = appendAttachmentContext(userInput, options.attachments);
  const memories = options.memoryEnabled === false ? [] : await loadRelevantMemories(paths, { query: promptInput });
  const knowledgeGraph = options.memoryEnabled === false ? undefined : await loadRelevantKnowledgeGraph(paths, promptInput);
  const conversationSummary = options.memoryEnabled === false || options.sessionId === undefined ? [] : await loadUiConversationSummaryContext(paths, options.sessionId);
  const messages = buildChatMessages(buildMcpToolSystemPrompt(systemPrompt, config), history, promptInput, memories, { memoryRetrievalPolicy: config.memory?.retrievalPolicy ?? "full", knowledgeGraph, conversationSummary, recentMessageLimit });
  attachUiVisionImages(messages, promptInput, resolveUiVisionImageUrls(config, options.attachments));
  const toolActivities: AgentToolActivity[] = [];
  const outboundAttachments: UiChatOutboundAttachment[] = [];
  const persistedUser = options.sessionId === undefined ? undefined : await persistUserChatMessage(paths, options.sessionId, userInput);
  const session = persistedUser?.session;
  const toolRunner = agentRuntime ? buildChannelAgentToolRunner(agentRuntime.agent, runAgentToolRequest) : runAgentToolRequest;
  const run = session ? await createUiChatRun(paths, session.id, {
    model: config.llm.primary,
    providerModelRef,
    userMessageId: persistedUser?.message.id,
    metadataJson: JSON.stringify(buildChatRunMetadata(userInput, { ...options, providerModelRef }, { model: config.llm.primary })),
  }) : undefined;
  const sanitizedOptions = { ...options, providerModelRef };
  const timelineOptions = run ? { ...sanitizedOptions, runId: run.id } : sanitizedOptions;
  await emitTimelineEvent(paths, session?.id, timelineOptions, { type: "thinking", label: "Preparing agent context", payload: { memoryCount: memories.length, model: config.llm.primary } });

  let answer: string;
  try {
    answer = await completeWithAgentTools({
      config,
      paths,
      apiKey,
      messages,
      toolRunner,
      approver: session ? createUiChatApprover(paths, session.id, timelineOptions) : undefined,
      chatCompletion,
      reloadConfig: async () => {
        const refreshedConfig = await loadConfig(paths);
        const refreshedAgentRuntime = await resolveWorkforceAgentRuntime(refreshedConfig, paths, session?.agentId, "the Web UI chat", session ? `ui-chat:agent:${session.agentId}:session:${session.id}` : undefined);
        return applyProviderOverride(refreshedAgentRuntime?.config ?? refreshedConfig);
      },
      policy: agentRuntime?.policy,
      maxToolCalls: options.toolsEnabled === false ? 0 : 20,
      streamFinalResponse: options.stream === true,
      onToken: (token) => {
        void emitTimelineEvent(paths, session?.id, timelineOptions, { type: "token", label: "Streaming token", payload: { bytes: Buffer.byteLength(token, "utf8") } });
        options.onToken?.(token);
      },
      onToolActivity: async (activity) => {
        toolActivities.push(activity);
        await emitTimelineEvent(paths, session?.id, timelineOptions, { type: activity.phase === "start" ? "tool_start" : "tool_finish", label: activity.label, payload: activity });
        await options.onToolActivity?.(activity);
      },
      runtimeContext: "Current channel: Web UI. Current Web UI chat session can receive internal.send_photo and internal.send_file attachments; omit arguments.channel for this chat.",
      outboundFileSender: session ? createUiOutboundFileSender(session.id, outboundAttachments) : undefined,
    });
  } catch (error) {
    const label = error instanceof Error ? error.message : "Unexpected chat error.";
    await emitTimelineEvent(paths, session?.id, timelineOptions, { type: "error", label });
    if (run) await finishUiChatRun(paths, run.id, { status: "error", metadataJson: JSON.stringify({ error: label, toolCalls: toolActivities.length }) });
    throw error;
  }

  const persistedAssistant = session ? await persistAssistantChatMessage(paths, session.id, answer, run?.id, outboundAttachments) : undefined;
  const finishedRun = run ? await finishUiChatRun(paths, run.id, { status: "done", model: config.llm.primary, assistantMessageId: persistedAssistant?.message.id, metadataJson: JSON.stringify(buildChatRunMetadata(userInput, sanitizedOptions, { model: config.llm.primary, output: answer, outputChars: answer.length, toolCalls: toolActivities.length, outboundAttachments })) }) : undefined;
  if (options.memoryEnabled !== false) {
    await runUiKnowledgeReasoningPass({ config, paths, apiKey, userInput: promptInput, assistantText: answer, sessionId: session?.id, assistantMessageId: persistedAssistant?.message.id, runId: run?.id, timelineOptions, chatCompletion });
    if (session) {
      await refreshUiConversationSummaryBestEffort({ config, paths, apiKey, sessionId: session.id, chatCompletion });
    }
  }
  await emitTimelineEvent(paths, session?.id, timelineOptions, { type: "done", label: "Assistant response completed", payload: { characters: answer.length, toolCalls: toolActivities.length } });
  await appendLog({ event: "ui_chat_success", detail: { model: config.llm.primary, toolCalls: toolActivities.length } }, { paths, knownSecrets: [apiKey] });
  return { ok: true, ...(persistedAssistant ? { session: persistedAssistant.session } : {}), ...(finishedRun ? { run: finishedRun } : {}), answer, model: config.llm.primary, toolActivities };
}

async function runUiKnowledgeReasoningPass(options: {
  config: Awaited<ReturnType<typeof loadConfig>>;
  paths: RuntimePaths;
  apiKey: string;
  userInput: string;
  assistantText: string;
  sessionId?: number;
  assistantMessageId?: number;
  runId?: number;
  timelineOptions: UiChatTimelineSink;
  chatCompletion: (config: Awaited<ReturnType<typeof loadConfig>>, apiKey: string, options: ChatCompletionOptions) => Promise<string>;
}): Promise<KnowledgeReasoningResult> {
  try {
    const result = await runKnowledgeReasoningPass({
      config: options.config,
      paths: options.paths,
      apiKey: options.apiKey,
      turn: { channel: "ui", userId: options.sessionId === undefined ? undefined : `session:${options.sessionId}`, sourceMessageId: formatUiChatKnowledgeSource(options), userInput: options.userInput, assistantText: options.assistantText },
      chatCompletion: options.chatCompletion,
    });
    const storedEntities = result.storedEntities.length;
    const storedRelations = result.storedRelations.length;
    const pending = result.pending.length;
    const skipped = result.skipped.length;
    if (storedEntities > 0 || storedRelations > 0 || pending > 0 || skipped > 0) {
      await emitTimelineEvent(options.paths, options.sessionId, options.timelineOptions, {
        type: "memory_capture",
        label: pending > 0 ? "Knowledge graph memory pending review" : storedEntities > 0 || storedRelations > 0 ? "Knowledge graph memory captured" : "Knowledge graph memory skipped",
        payload: { storedEntities, storedRelations, pending, skipped },
      });
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown knowledge reasoning error.";
    await appendLog({ event: "knowledge_reasoning_failure", detail: { channel: "ui", message } }, { paths: options.paths, knownSecrets: [options.apiKey] });
    return { storedEntities: [], storedRelations: [], pending: [], skipped: [] };
  }
}

function formatUiChatKnowledgeSource(options: { sessionId?: number; assistantMessageId?: number; runId?: number }): string | undefined {
  if (options.sessionId === undefined || options.assistantMessageId === undefined) {
    return undefined;
  }
  return `ui-chat:${options.sessionId}:message:${options.assistantMessageId}${options.runId === undefined ? "" : `:run:${options.runId}`}`;
}

function createUiChatApprover(paths: RuntimePaths, sessionId: number, options: UiChatOptions) {
  return async (request: ActionPermissionRequest, proposed: ActionPermissionResult) => {
    const store = await SqliteMemoryStore.open(paths);
    try {
      const approval = store.addPendingActionApproval({
        channel: "ui-chat",
        userId: `session:${sessionId}`,
        category: request.category,
        action: request.action,
        target: request.target,
        reason: request.reason,
        proposedReason: proposed.reason,
        payloadJson: request.payloadJson,
        ttlMs: 15 * 60 * 1000,
      });
      await emitTimelineEvent(paths, sessionId, options, { type: "approval_required", label: `${request.action} requires approval`, payload: { approvalId: approval.id, category: approval.category, target: approval.target, reason: approval.reason, proposedReason: approval.proposedReason } });
      return { approved: false, reason: `Approval required in Chat UI: ${approval.id}` };
    } finally {
      store.close();
    }
  };
}

async function emitTimelineEvent(paths: RuntimePaths, sessionId: number | undefined, options: UiChatTimelineSink, event: UiChatTimelineEvent): Promise<void> {
  if (sessionId !== undefined) {
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addUiChatEvent(sessionId, event.type, event.label, event.payload === undefined ? undefined : JSON.stringify(event.payload), options.runId);
    } finally {
      store.close();
    }
  }

  await options.onTimelineEvent?.(options.runId === undefined ? event : { ...event, runId: options.runId });
}

async function createUiChatRun(paths: RuntimePaths, sessionId: number, options: { model?: string; providerModelRef?: string; userMessageId?: number; metadataJson?: string }): Promise<import("../../memory/sqlite-store.js").UiChatRun> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    return store.createUiChatRun(sessionId, options);
  } finally {
    store.close();
  }
}

async function finishUiChatRun(paths: RuntimePaths, runId: number, options: { status: string; model?: string; assistantMessageId?: number; metadataJson?: string }): Promise<import("../../memory/sqlite-store.js").UiChatRun> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    return store.finishUiChatRun(runId, options);
  } finally {
    store.close();
  }
}

async function persistUserChatMessage(paths: RuntimePaths, sessionId: number, content: string): Promise<PersistedUiChatUserMessage> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    const session = store.getUiChatSession(sessionId);
    const message = store.addUiChatMessage(session.id, "user", content);
    if (session.title === "New chat") {
      return { session: store.updateUiChatSessionTitle(session.id, content.slice(0, 54)), message };
    }
    return { session: store.getUiChatSession(session.id), message };
  } finally {
    store.close();
  }
}

async function persistAssistantChatMessage(paths: RuntimePaths, sessionId: number, content: string, runId?: number, attachments?: UiChatOutboundAttachment[]): Promise<PersistedUiChatUserMessage> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    const message = store.addUiChatMessage(sessionId, "assistant", content, runId, buildUiMessageMetadata(attachments));
    return { session: store.getUiChatSession(sessionId), message };
  } finally {
    store.close();
  }
}

function buildChatRunMetadata(userInput: string, options: UiChatOptions, result: { model: string; output?: string; outputChars?: number; toolCalls?: number; outboundAttachments?: UiChatOutboundAttachment[] }): Record<string, unknown> {
  return {
    input: userInput,
    inputChars: userInput.length,
    output: result.output,
    outputChars: result.outputChars ?? 0,
    toolCalls: result.toolCalls ?? 0,
    model: result.model,
    toolsEnabled: options.toolsEnabled !== false,
    memoryEnabled: options.memoryEnabled !== false,
    providerModelRef: options.providerModelRef,
    replaySourceRunId: options.replaySourceRunId,
    attachmentCount: options.attachments?.length ?? 0,
    attachments: summarizeChatAttachments(options.attachments),
    outboundAttachments: summarizeChatAttachments(result.outboundAttachments),
  };
}

function buildUiMessageMetadata(attachments: UiChatOutboundAttachment[] | undefined): string | undefined {
  return attachments?.length ? JSON.stringify({ attachments }) : undefined;
}

function createUiOutboundFileSender(sessionId: number, attachments: UiChatOutboundAttachment[]): AgentOutboundFileSender {
  const send = async (payload: ResolvedOutboundFilePayload) => {
    attachments.push(toUiOutboundAttachment(payload));
    return { channel: "ui-chat", target: `session:${sessionId}`, messageId: attachments.length };
  };

  return { sendPhoto: send, sendFile: send };
}

function toUiOutboundAttachment(payload: ResolvedOutboundFilePayload): UiChatOutboundAttachment {
  return {
    channel: "ui-chat",
    name: payload.fileName,
    type: payload.mimeType,
    size: payload.bytes.byteLength,
    content: uiAttachmentContent(payload),
  };
}

function uiAttachmentContent(payload: ResolvedOutboundFilePayload): string {
  if (payload.mimeType.startsWith("text/") || payload.mimeType === "application/json") {
    return Buffer.from(payload.bytes).toString("utf8");
  }
  return `data:${payload.mimeType};base64,${Buffer.from(payload.bytes).toString("base64")}`;
}

function summarizeChatAttachments(attachments: UiChatAttachment[] | undefined): Array<{ name: string; type?: string; size?: number; chars: number; content: string }> {
  return (attachments ?? []).slice(0, 5).map((attachment) => ({
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    chars: attachment.content.length,
    content: isUiImageAttachment(attachment) ? UI_IMAGE_CONTENT_OMITTED : attachment.content.slice(0, 64 * 1024),
  }));
}

function toChatHistory(history: UiChatMessage[], recentMessageLimit: number): import("../../llm/types.js").ChatMessage[] {
  return history
    .filter((message) => (message.role === "user" || message.role === "assistant") && message.content.trim())
    .slice(-recentMessageLimit)
    .map((message) => ({ role: message.role, content: message.content }));
}

async function resolveUiChatHistory(paths: RuntimePaths, options: UiChatOptions, recentMessageLimit: number): Promise<UiChatMessage[]> {
  if (options.history && options.history.length > 0) {
    return options.history;
  }
  if (options.sessionId === undefined) {
    return [];
  }

  const store = await SqliteMemoryStore.open(paths);
  try {
    return store.listUiChatMessages(options.sessionId, recentMessageLimit).map((message) => ({ role: message.role, content: message.content }));
  } finally {
    store.close();
  }
}

async function refreshUiConversationSummaryBestEffort(options: {
  config: Awaited<ReturnType<typeof loadConfig>>;
  paths: RuntimePaths;
  apiKey: string;
  sessionId: number;
  chatCompletion: (config: Awaited<ReturnType<typeof loadConfig>>, apiKey: string, options: ChatCompletionOptions) => Promise<string>;
}): Promise<void> {
  try {
    await refreshUiConversationSummary(options);
  } catch (error) {
    await appendLog({ event: "conversation_summary_failure", detail: { channel: "ui", sessionId: options.sessionId, error: error instanceof Error ? error.message : String(error) } }, { paths: options.paths, knownSecrets: [options.apiKey] });
  }
}

function resolveUiChatAgentId(config: Awaited<ReturnType<typeof loadConfig>>, agentId: string | undefined): string | undefined {
  const normalized = agentId?.trim();
  if (!normalized) return undefined;
  const agent = config.agents?.[normalized];
  if (!agent) throw new Error(`Agent '${normalized}' does not exist.`);
  if (!agent.enabled) throw new Error(`Agent '${agent.displayName}' is paused.`);
  return normalized;
}
