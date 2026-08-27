export interface ChatSessionsSummary {
  ok: true;
  sessions: ChatSession[];
}

export interface ChatSessionMessagesSummary {
  ok: true;
  session: ChatSession;
  messages: ChatMessage[];
  events: ChatEvent[];
  runs: ChatRun[];
  approvals?: Record<string, PendingActionApproval>;
  branch?: ChatBranchSummary;
  retryMessage?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  replay?: {
    runId: number;
    toolsEnabled?: boolean;
    memoryEnabled?: boolean;
    providerModelRef?: string;
    attachments?: ChatAttachment[];
  };
}

export interface ChatSession {
  id: number;
  title: string;
  agentId?: string | null;
  pinnedAt?: string | null;
  archivedAt?: string | null;
  toolsEnabled?: boolean | null;
  memoryEnabled?: boolean | null;
  providerModelRef?: string | null;
  reasoningLevel?: "off" | "low" | "medium" | "high" | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string | null;
  [key: string]: unknown;
}

export interface ChatMessage {
  id: number;
  sessionId: number;
  role: "user" | "assistant";
  content: string;
  runId?: number | null;
  createdAt: string;
  [key: string]: unknown;
}

export interface ChatRun {
  id: number;
  sessionId: number;
  status: string;
  model?: string | null;
  providerModelRef?: string | null;
  userMessageId?: number | null;
  assistantMessageId?: number | null;
  metadataJson?: string | null;
  createdAt: string;
  completedAt?: string | null;
  [key: string]: unknown;
}

export interface ChatEvent {
  id: number;
  sessionId: number;
  runId?: number | null;
  eventType: string;
  message: string;
  payloadJson?: string | null;
  createdAt: string;
  [key: string]: unknown;
}

export interface ChatBranchSummary {
  parent?: ChatBranchLink;
  children: ChatBranchLink[];
}

export interface ChatBranchLink {
  id: number;
  sourceSessionId: number;
  sessionId: number;
  sourceMessageId: number;
  createdAt: string;
  [key: string]: unknown;
}

export interface PendingActionApproval {
  id: number;
  status: string;
  action: string;
  target?: string;
  reason?: string;
  proposedReason?: string;
  createdAt: string;
  [key: string]: unknown;
}

export interface ChatAttachment {
  name: string;
  type?: string;
  size?: number;
  content: string;
}

export interface ChatStreamDoneResult {
  ok: true;
  session?: ChatSession;
  run?: ChatRun;
  answer: string;
  model: string;
  toolActivities?: unknown[];
}

export interface ChatTimelineEvent {
  type: "thinking" | "tool_start" | "tool_finish" | "token" | "approval_required" | "memory_capture" | "done" | "error";
  label: string;
  runId?: number;
  payload?: unknown;
}

export interface ChatExportSummary extends ChatSessionMessagesSummary {
  exportedAt: string;
}
