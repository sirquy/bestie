export interface KnowledgeGraphSummary {
  ok: boolean;
  database: {
    exists: boolean;
    path: string;
  };
  state: {
    paused: boolean;
  };
  counts: {
    entities: number;
    relations: number;
    pending: number;
  };
  entities: KnowledgeEntity[];
  relations: KnowledgeRelation[];
  pending: PendingKnowledgeItem[];
  analysis: KnowledgeGraphAnalysis;
  review: KnowledgeGraphReviewPlan;
  trust: KnowledgeGraphTrustSummary;
  query?: string;
  action?: KnowledgeGraphAction;
  actionStatus?: "executed" | "queued";
  message?: string;
  approvalId?: number;
}

export interface KnowledgeEntity {
  id: number;
  canonicalName: string;
  kind: string;
  aliases: string[];
  sensitivity: string;
  scope: string;
  confidence: number;
  sourceMemoryId?: number;
  sourceMessageId?: string;
  source?: KnowledgeSourceAttribution;
  trust: KnowledgeTrustMetrics;
  createdAt: string;
  updatedAt: string;
  auditTrail: KnowledgeAuditEvent[];
}

export interface KnowledgeRelation {
  id: number;
  sourceEntityId: number;
  sourceName: string;
  sourceKind: string;
  relationType: string;
  targetEntityId: number;
  targetName: string;
  targetKind: string;
  evidence?: string;
  sensitivity: string;
  scope: string;
  confidence: number;
  sourceMemoryId?: number;
  sourceMessageId?: string;
  source?: KnowledgeSourceAttribution;
  trust: KnowledgeTrustMetrics;
  createdAt: string;
  updatedAt: string;
  auditTrail: KnowledgeAuditEvent[];
}

export interface PendingKnowledgeItem {
  id: number;
  reason?: string;
  source?: string;
  sourceAttribution?: KnowledgeSourceAttribution;
  explicitConsent: boolean;
  createdAt: string;
  payloadSummary: string;
  auditTrail: KnowledgeAuditEvent[];
}

export interface KnowledgeSourceAttribution {
  kind: "memory" | "ui_chat" | "message" | "manual";
  label: string;
  memoryId?: number;
  sourceMessageId?: string;
  chatSessionId?: number;
  chatMessageId?: number;
  chatRunId?: number;
}

export interface KnowledgeAuditEvent {
  id: number;
  eventType: string;
  actor?: string;
  channel?: string;
  reason?: string;
  payloadSummary?: string;
  createdAt: string;
}

export interface KnowledgeTrustMetrics {
  score?: number;
  level?: string;
  signals?: string[];
  warnings?: string[];
  [key: string]: unknown;
}

export interface KnowledgeGraphTrustSummary {
  score?: number;
  level?: string;
  label?: string;
  warnings?: string[];
  [key: string]: unknown;
}

export interface KnowledgeGraphAnalysis {
  isolatedEntities?: KnowledgeEntity[];
  conflictingRelations?: Array<{ relationIds: number[]; reason?: string }>;
  lowConfidenceEntities?: KnowledgeEntity[];
  lowConfidenceRelations?: KnowledgeRelation[];
  [key: string]: unknown;
}

export interface KnowledgeGraphReviewPlan {
  suggestions?: Array<{ title?: string; reason?: string; action?: string }>;
  [key: string]: unknown;
}

export type KnowledgeGraphAction = "merge_entity" | "forget_entity" | "forget_relation" | "update_relation" | "approve_pending" | "reject_pending" | "sanitize_pending";
