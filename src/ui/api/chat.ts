import { buildAgentToolResultMessage, buildMcpToolSystemPrompt, completeWithAgentTools, formatToolRequestName, parseAgentToolDecisionResult, type AgentToolActivity } from "../../chat/mcp-tool-use.js";
import { appendConversationTurn, buildChatMessages } from "../../chat/message-builder.js";
import { loadSystemPrompt } from "../../character/prompt-loader.js";
import { sendChatCompletionWithFallbacks } from "../../llm/chat-completion.js";
import { loadLlmCandidateSecret, resolvePrimaryLlmCandidate } from "../../llm/resolve-config.js";
import { SqliteMemoryStore } from "../../memory/sqlite-store.js";
import { loadConfig } from "../../runtime/config.js";
import { appendLog } from "../../runtime/logger.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { executeApprovedAction } from "../../safety/approval-executor.js";
import type { ActionPermissionRequest, ActionPermissionResult } from "../../safety/permission-policy.js";

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

export type UiChatTimelineEventType = "thinking" | "tool_start" | "tool_finish" | "token" | "approval_required" | "done" | "error";

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
    return { ok: true, sessions: store.listUiChatSessions() };
  } finally {
    store.close();
  }
}

export async function searchUiChatSessions(options: UiChatSessionSearchOptions = {}): Promise<UiChatSessionsSummary> {
  const store = await SqliteMemoryStore.open(options.paths ?? getRuntimePaths());
  try {
    return { ok: true, sessions: store.searchUiChatSessions({ query: options.query, eventType: chatSessionFilterToEventType(options.filter) }) };
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

export async function createUiChatSession(title?: string, paths: RuntimePaths = getRuntimePaths()): Promise<UiChatSessionMessagesSummary> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    const session = store.createUiChatSession(title);
    return { ok: true, session, messages: [], events: [], runs: [] };
  } finally {
    store.close();
  }
}

export async function updateUiChatSession(options: { id: number; title?: string; pinned?: boolean; toolsEnabled?: boolean; memoryEnabled?: boolean; providerModelRef?: string | null; paths?: RuntimePaths }): Promise<UiChatSessionMessagesSummary> {
  const store = await SqliteMemoryStore.open(options.paths ?? getRuntimePaths());
  try {
    if (typeof options.title === "string") store.updateUiChatSessionTitle(options.id, options.title);
    if (typeof options.pinned === "boolean") store.updateUiChatSessionPinned(options.id, options.pinned);
    if ("toolsEnabled" in options || "memoryEnabled" in options || "providerModelRef" in options) store.updateUiChatSessionPreferences(options.id, options);
    const events = store.listUiChatEvents(options.id);
    return { ok: true, session: store.getUiChatSession(options.id), messages: store.listUiChatMessages(options.id), events, runs: store.listUiChatRuns(options.id), approvals: collectChatApprovalStatuses(store, events), branch: collectChatBranch(store, options.id) };
  } finally {
    store.close();
  }
}

export async function getUiChatSessionMessages(sessionId: number, paths: RuntimePaths = getRuntimePaths()): Promise<UiChatSessionMessagesSummary> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    const events = store.listUiChatEvents(sessionId);
    return { ok: true, session: store.getUiChatSession(sessionId), messages: store.listUiChatMessages(sessionId), events, runs: store.listUiChatRuns(sessionId), approvals: collectChatApprovalStatuses(store, events), branch: collectChatBranch(store, sessionId) };
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
  const config = await loadConfig(paths);
  const store = await SqliteMemoryStore.open(paths);
  try {
    const session = store.getUiChatSession(options.sessionId);
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
    const execution = await executeApprovedAction(store, approval, "approve", { config, paths });
    await emitTimelineEvent(paths, session.id, options, { type: execution.status === "executed" ? "tool_finish" : "error", label: execution.shortText, payload: { approvalId: approval.id, status: execution.status, message: execution.message } });

    const finalAnswer = await synthesizeContinuedChatAnswer(paths, config, session.id, execution, options).catch((error) => {
      void emitTimelineEvent(paths, session.id, options, { type: "error", label: error instanceof Error ? error.message : "Unable to synthesize continued response.", payload: { approvalId: approval.id } });
      return execution.message;
    });
    store.addUiChatMessage(session.id, "assistant", finalAnswer);
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
    return [{ name: item.name, type: typeof item.type === "string" ? item.type : undefined, size: typeof item.size === "number" ? item.size : undefined, content: item.content.slice(0, 64 * 1024) }];
  });
  return attachments.length ? attachments : undefined;
}

async function synthesizeContinuedChatAnswer(paths: RuntimePaths, config: Awaited<ReturnType<typeof loadConfig>>, sessionId: number, execution: Awaited<ReturnType<typeof executeApprovedAction>>, options?: UiChatContinueOptions): Promise<string> {
  if (!execution.request || !execution.toolResult) {
    return execution.message;
  }

  const apiKey = await loadLlmCandidateSecret(resolvePrimaryLlmCandidate(config), paths);
  const systemPrompt = await loadSystemPrompt(paths);
  const store = await SqliteMemoryStore.open(paths);
  try {
    const history = toChatHistory(store.listUiChatMessages(sessionId).map((message) => ({ role: message.role, content: message.content })));
    const toolName = formatToolRequestName(execution.request);
    const messages = [
      { role: "system" as const, content: buildMcpToolSystemPrompt(systemPrompt, config) },
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
    "Content:",
    attachment.content.slice(0, 64 * 1024),
  ].join("\n"));
  return `${userInput}\n\nAttached context:\n${blocks.join("\n\n---\n\n")}`;
}

export async function runUiChat(options: UiChatOptions): Promise<UiChatResult> {
  const paths = options.paths ?? getRuntimePaths();
  const userInput = options.message.trim();
  if (!userInput) throw new Error("Chat message is required.");

  const applyProviderOverride = (config: Awaited<ReturnType<typeof loadConfig>>) => options.providerModelRef ? { ...config, llm: { ...config.llm, primary: options.providerModelRef } } : config;
  const config = applyProviderOverride(await loadConfig(paths));
  const systemPrompt = await loadSystemPrompt(paths);
  const apiKey = await loadLlmCandidateSecret(resolvePrimaryLlmCandidate(config), paths);
  const memories = options.memoryEnabled === false ? [] : await loadActiveMemories(paths);
  const history = toChatHistory(options.history ?? []);
  const promptInput = appendAttachmentContext(userInput, options.attachments);
  const messages = buildChatMessages(buildMcpToolSystemPrompt(systemPrompt, config), history, promptInput, memories, { memoryRetrievalPolicy: config.memory?.retrievalPolicy ?? "full" });
  const toolActivities: AgentToolActivity[] = [];
  const persistedUser = options.sessionId === undefined ? undefined : await persistUserChatMessage(paths, options.sessionId, userInput);
  const session = persistedUser?.session;
  const run = session ? await createUiChatRun(paths, session.id, {
    model: config.llm.primary,
    providerModelRef: options.providerModelRef,
    userMessageId: persistedUser?.message.id,
    metadataJson: JSON.stringify(buildChatRunMetadata(userInput, options, { model: config.llm.primary })),
  }) : undefined;
  const timelineOptions = run ? { ...options, runId: run.id } : options;
  await emitTimelineEvent(paths, session?.id, timelineOptions, { type: "thinking", label: "Preparing agent context", payload: { memoryCount: memories.length, model: config.llm.primary } });

  let answer: string;
  try {
    answer = await completeWithAgentTools({
      config,
      paths,
      apiKey,
      messages,
      approver: session ? createUiChatApprover(paths, session.id, timelineOptions) : undefined,
      chatCompletion: (currentConfig, _apiKey, requestOptions) => sendChatCompletionWithFallbacks(currentConfig, requestOptions, { paths }),
      reloadConfig: async () => applyProviderOverride(await loadConfig(paths)),
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
      runtimeContext: "Bestie Web UI chat session",
    });
  } catch (error) {
    const label = error instanceof Error ? error.message : "Unexpected chat error.";
    await emitTimelineEvent(paths, session?.id, timelineOptions, { type: "error", label });
    if (run) await finishUiChatRun(paths, run.id, { status: "error", metadataJson: JSON.stringify({ error: label, toolCalls: toolActivities.length }) });
    throw error;
  }

  const persistedAssistant = session ? await persistAssistantChatMessage(paths, session.id, answer, run?.id) : undefined;
  const finishedRun = run ? await finishUiChatRun(paths, run.id, { status: "done", model: config.llm.primary, assistantMessageId: persistedAssistant?.message.id, metadataJson: JSON.stringify(buildChatRunMetadata(userInput, options, { model: config.llm.primary, output: answer, outputChars: answer.length, toolCalls: toolActivities.length })) }) : undefined;
  await emitTimelineEvent(paths, session?.id, timelineOptions, { type: "done", label: "Assistant response completed", payload: { characters: answer.length, toolCalls: toolActivities.length } });
  await appendLog({ event: "ui_chat_success", detail: { model: config.llm.primary, toolCalls: toolActivities.length } }, { paths, knownSecrets: [apiKey] });
  return { ok: true, ...(persistedAssistant ? { session: persistedAssistant.session } : {}), ...(finishedRun ? { run: finishedRun } : {}), answer, model: config.llm.primary, toolActivities };
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

async function persistAssistantChatMessage(paths: RuntimePaths, sessionId: number, content: string, runId?: number): Promise<PersistedUiChatUserMessage> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    const message = store.addUiChatMessage(sessionId, "assistant", content, runId);
    return { session: store.getUiChatSession(sessionId), message };
  } finally {
    store.close();
  }
}

function buildChatRunMetadata(userInput: string, options: UiChatOptions, result: { model: string; output?: string; outputChars?: number; toolCalls?: number }): Record<string, unknown> {
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
  };
}

function summarizeChatAttachments(attachments: UiChatAttachment[] | undefined): Array<{ name: string; type?: string; size?: number; chars: number; content: string }> {
  return (attachments ?? []).slice(0, 5).map((attachment) => ({ name: attachment.name, type: attachment.type, size: attachment.size, chars: attachment.content.length, content: attachment.content.slice(0, 64 * 1024) }));
}

function toChatHistory(history: UiChatMessage[]): import("../../llm/types.js").ChatMessage[] {
  return history.reduce<import("../../llm/types.js").ChatMessage[]>((turns, message, index) => {
    if (message.role !== "user" && message.role !== "assistant") return turns;
    if (index >= 24) return turns;
    return appendConversationTurn(turns, message.role === "user" ? message.content : "", message.role === "assistant" ? message.content : "");
  }, []).filter((message) => typeof message.content === "string" && message.content.trim());
}

async function loadActiveMemories(paths: RuntimePaths): Promise<import("../../memory/sqlite-store.js").StoredMemory[]> {
  const store = await SqliteMemoryStore.open(paths);
  try {
    if (store.getMemoryState().paused) return [];
    return store.listActiveMemories();
  } finally {
    store.close();
  }
}
