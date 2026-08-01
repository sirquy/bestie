export interface MemorySummary {
  ok: boolean;
  database: {
    exists: boolean;
    path: string;
  };
  state: {
    paused: boolean;
  };
  counts: {
    active: number;
    pending: number;
    core: number;
    project: number;
    session: number;
    conversationSummaries: number;
  };
  memories: MemoryItem[];
  pending: PendingMemoryItem[];
  conversationSummaries: ConversationSummaryItem[];
  query?: string;
}

export interface MemoryItem {
  id: number;
  type: string;
  content: string;
  sensitivity: string;
  importance: number;
  source?: string;
  pinned: boolean;
  scope: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface PendingMemoryItem {
  id: number;
  type: string;
  content: string;
  reason?: string;
  source?: string;
  explicitConsent: boolean;
  createdAt: string;
}

export interface ConversationSummaryItem {
  id: number;
  channel: string;
  userId?: string;
  content: string;
  summarizedMessageId: number;
  updatedAt: string;
}

export type MemoryAction = "approve_pending" | "reject_pending";
