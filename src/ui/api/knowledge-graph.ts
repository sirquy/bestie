import { access } from "node:fs/promises";

import { runAgentToolRequest, type AgentToolRequest } from "../../chat/mcp-tool-use.js";
import { analyzeKnowledgeGraph, planKnowledgeGraphReview, type KnowledgeGraphAnalysis, type KnowledgeGraphReviewPlan } from "../../memory/knowledge-governance.js";
import { buildKnowledgeTrustMetrics, knowledgeTrustSourceKind, summarizeKnowledgeTrust, type KnowledgeTrustMetrics, type KnowledgeTrustSummary } from "../../memory/knowledge-trust.js";
import { SqliteMemoryStore, type KnowledgeAuditEvent, type KnowledgeEntity, type KnowledgeRelationWithEntities, type PendingKnowledgeItem } from "../../memory/sqlite-store.js";
import { loadConfig } from "../../runtime/config.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import type { ActionPermissionRequest, ActionPermissionResult } from "../../safety/permission-policy.js";

export interface UiKnowledgeGraphSummary {
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
  entities: UiKnowledgeEntity[];
  relations: UiKnowledgeRelation[];
  pending: UiPendingKnowledgeItem[];
  analysis: KnowledgeGraphAnalysis;
  review: KnowledgeGraphReviewPlan;
  trust: UiKnowledgeGraphTrustSummary;
}

export interface UiKnowledgeGraphSearchResult extends UiKnowledgeGraphSummary {
  query: string;
}

export type UiKnowledgeGraphAction = "merge_entity" | "forget_entity" | "forget_relation" | "update_relation" | "approve_pending" | "reject_pending" | "sanitize_pending";

export interface UiKnowledgeGraphActionOptions {
  action: UiKnowledgeGraphAction;
  confirm: boolean;
  primaryId?: number;
  duplicateId?: number;
  id?: number;
  confidence?: number;
  evidence?: string;
  scope?: "core" | "project" | "session";
  sensitivity?: "normal" | "sensitive";
  reason?: string;
  paths?: RuntimePaths;
}

export interface UiKnowledgeGraphActionResult extends UiKnowledgeGraphSummary {
  action: UiKnowledgeGraphAction;
  actionStatus: "executed" | "queued";
  message: string;
  approvalId?: number;
  toolResult?: unknown;
}

export interface UiKnowledgeEntity {
  id: number;
  canonicalName: string;
  kind: string;
  aliases: string[];
  sensitivity: string;
  scope: string;
  confidence: number;
  sourceMemoryId?: number;
  sourceMessageId?: string;
  source?: UiKnowledgeSourceAttribution;
  trust: UiKnowledgeTrustMetrics;
  createdAt: string;
  updatedAt: string;
  auditTrail: UiKnowledgeAuditEvent[];
}

export interface UiKnowledgeRelation {
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
  source?: UiKnowledgeSourceAttribution;
  trust: UiKnowledgeTrustMetrics;
  createdAt: string;
  updatedAt: string;
  auditTrail: UiKnowledgeAuditEvent[];
}

export interface UiPendingKnowledgeItem {
  id: number;
  reason?: string;
  source?: string;
  sourceAttribution?: UiKnowledgeSourceAttribution;
  explicitConsent: boolean;
  createdAt: string;
  payloadSummary: string;
  auditTrail: UiKnowledgeAuditEvent[];
}

export interface UiKnowledgeSourceAttribution {
  kind: "memory" | "ui_chat" | "message" | "manual";
  label: string;
  memoryId?: number;
  sourceMessageId?: string;
  chatSessionId?: number;
  chatMessageId?: number;
  chatRunId?: number;
}

export interface UiKnowledgeAuditEvent {
  id: number;
  eventType: string;
  actor?: string;
  channel?: string;
  reason?: string;
  payloadSummary?: string;
  createdAt: string;
}

export type UiKnowledgeGraphTrustSummary = KnowledgeTrustSummary;
export type UiKnowledgeTrustMetrics = KnowledgeTrustMetrics;

export async function getUiKnowledgeGraphSummary(paths: RuntimePaths = getRuntimePaths(), limit = 60): Promise<UiKnowledgeGraphSummary> {
  const databaseExists = await fileExists(paths.memoryDbPath);
  if (!databaseExists) {
    return emptyKnowledgeGraphSummary(paths);
  }

  const store = await SqliteMemoryStore.open(paths);
  try {
    const entities = store.listKnowledgeEntities({ limit });
    const relations = store.listKnowledgeRelations(limit);
    const pending = store.listPendingKnowledgeItems(limit);
    return buildKnowledgeGraphSummary(paths, store, entities, relations, pending, databaseExists);
  } finally {
    store.close();
  }
}

export async function searchUiKnowledgeGraph(query: string, paths: RuntimePaths = getRuntimePaths(), limit = 60): Promise<UiKnowledgeGraphSearchResult> {
  const databaseExists = await fileExists(paths.memoryDbPath);
  if (!databaseExists || query.trim().length === 0) {
    return { ...emptyKnowledgeGraphSummary(paths), query };
  }

  const store = await SqliteMemoryStore.open(paths);
  try {
    const graph = store.searchKnowledgeGraph(query, limit);
    const pending = store.listPendingKnowledgeItems(limit).filter((item) => pendingKnowledgeMatches(item, query));
    return { ...buildKnowledgeGraphSummary(paths, store, graph.entities, graph.relations, pending, databaseExists), query: graph.query };
  } finally {
    store.close();
  }
}

export async function runUiKnowledgeGraphAction(options: UiKnowledgeGraphActionOptions): Promise<UiKnowledgeGraphActionResult> {
  if (!options.confirm) {
    throw new Error("Thao tác đồ thị tri thức cần confirm=true.");
  }

  const paths = options.paths ?? getRuntimePaths();
  if (options.action === "approve_pending" || options.action === "reject_pending" || options.action === "sanitize_pending") {
    const id = positiveInteger(options.id, "ID tri thức đang chờ");
    const store = await SqliteMemoryStore.open(paths);
    try {
      if (store.getMemoryState().paused) {
        throw new Error("Trí nhớ đang tạm dừng.");
      }
      if (options.action === "approve_pending") {
        const approved = store.approvePendingKnowledgeItem(id);
        if (!approved) throw new Error(`Không tìm thấy mục đồ thị tri thức đang chờ: ${id}`);
        if (approved.status === "blocked") {
          throw new Error(`Mục đồ thị tri thức đang chờ bị chặn: ${approved.explanation ?? approved.reason}`);
        }
      } else if (options.action === "sanitize_pending") {
        const sanitized = store.sanitizePendingKnowledgeItem(id);
        if (!sanitized) throw new Error(`Không tìm thấy mục đồ thị tri thức đang chờ: ${id}`);
        if (sanitized.status === "blocked") {
          throw new Error(`Không thể làm sạch mục đồ thị tri thức đang chờ: ${sanitized.explanation ?? sanitized.reason}`);
        }
      } else if (!store.rejectPendingKnowledgeItem(id)) {
        throw new Error(`Không tìm thấy mục đồ thị tri thức đang chờ: ${id}`);
      }
    } finally {
      store.close();
    }
    return { ...(await getUiKnowledgeGraphSummary(paths)), action: options.action, actionStatus: "executed", message: options.action === "approve_pending" ? "Đã duyệt mục đồ thị đang chờ." : options.action === "sanitize_pending" ? "Đã làm sạch mục đồ thị đang chờ." : "Đã từ chối mục đồ thị đang chờ." };
  }

  const request = buildGraphToolRequest(options);
  let approvalId: number | undefined;
  const config = await loadConfig(paths);
  const result = await runAgentToolRequest({
    config,
    paths,
    request,
    approver: async (requestToApprove: ActionPermissionRequest, proposed: ActionPermissionResult) => {
      const store = await SqliteMemoryStore.open(paths);
      try {
        const approval = store.addPendingActionApproval({
          channel: "ui",
          category: requestToApprove.category,
          action: requestToApprove.action,
          target: requestToApprove.target,
          reason: requestToApprove.reason,
          proposedReason: proposed.reason,
          payloadJson: requestToApprove.payloadJson,
          ttlMs: 15 * 60 * 1000,
        });
        approvalId = approval.id;
        return { approved: false, reason: `Đã đưa phê duyệt vào hàng chờ Bestie UI: ${approval.id}` };
      } finally {
        store.close();
      }
    },
  });

  const actionStatus = result.ok ? "executed" : approvalId ? "queued" : "executed";
  if (!result.ok && !approvalId) {
    throw new Error(result.message);
  }

  return {
    ...(await getUiKnowledgeGraphSummary(paths)),
    action: options.action,
    actionStatus,
    message: approvalId ? `Đã đưa phê duyệt vào hàng chờ: ${approvalId}.` : result.message,
    ...(approvalId === undefined ? {} : { approvalId }),
    toolResult: result,
  };
}

function buildGraphToolRequest(options: UiKnowledgeGraphActionOptions): AgentToolRequest {
  const reason = options.reason?.trim() || defaultActionReason(options.action);
  if (options.action === "merge_entity") {
    return { tool: "internal.merge_knowledge_entities", arguments: { primaryId: positiveInteger(options.primaryId, "ID entity chính"), duplicateId: positiveInteger(options.duplicateId, "ID entity trùng"), reason } };
  }
  if (options.action === "forget_entity") {
    return { tool: "internal.forget_knowledge_entity", arguments: { id: positiveInteger(options.id, "ID entity"), reason } };
  }
  if (options.action === "forget_relation") {
    return { tool: "internal.forget_knowledge_relation", arguments: { id: positiveInteger(options.id, "ID relation"), reason } };
  }
  if (options.action === "update_relation") {
    const args: Record<string, unknown> = { id: positiveInteger(options.id, "ID relation"), reason };
    if (options.confidence !== undefined) args.confidence = validConfidence(options.confidence);
    if (options.evidence !== undefined) args.evidence = options.evidence;
    if (options.scope !== undefined) args.scope = options.scope;
    if (options.sensitivity !== undefined) args.sensitivity = options.sensitivity;
    if (args.confidence === undefined && args.evidence === undefined && args.scope === undefined && args.sensitivity === undefined) {
      throw new Error("Cập nhật relation cần confidence, evidence, scope hoặc sensitivity.");
    }
    return { tool: "internal.update_knowledge_relation", arguments: args };
  }
  throw new Error(`Action đồ thị tri thức không được hỗ trợ: ${options.action}`);
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} phải là số nguyên dương.`);
  }
  return value;
}

function validConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Confidence phải là số từ 0 đến 1.");
  }
  return value;
}

function defaultActionReason(action: UiKnowledgeGraphAction): string {
  if (action === "merge_entity") return "Người dùng yêu cầu gộp entity từ UI Đồ thị Tri thức.";
  if (action === "forget_entity") return "Người dùng yêu cầu xóa entity từ UI Đồ thị Tri thức.";
  if (action === "forget_relation") return "Người dùng yêu cầu xóa relation từ UI Đồ thị Tri thức.";
  if (action === "update_relation") return "Người dùng yêu cầu cập nhật metadata relation từ UI Đồ thị Tri thức.";
  return "Người dùng yêu cầu review mục đồ thị tri thức đang chờ từ UI.";
}

function buildKnowledgeGraphSummary(paths: RuntimePaths, store: SqliteMemoryStore, entities: KnowledgeEntity[], relations: KnowledgeRelationWithEntities[], pending: PendingKnowledgeItem[], databaseExists: boolean): UiKnowledgeGraphSummary {
  const allEntities = store.listKnowledgeEntities({ limit: 10_000 });
  const allRelations = store.listKnowledgeRelations(10_000);
  const allPending = store.listPendingKnowledgeItems(10_000);
  const analysis = analyzeKnowledgeGraph({ entities: allEntities, relations: allRelations, pending: allPending });
  const trustContext = buildTrustContext(analysis, allRelations);
  const uiEntities = entities.map((entity) => toUiKnowledgeEntity(store, entity, trustContext));
  const uiRelations = relations.map((relation) => toUiKnowledgeRelation(store, relation, trustContext));
  return {
    ok: true,
    database: { exists: databaseExists, path: paths.memoryDbPath },
    state: store.getMemoryState(),
    counts: {
      entities: allEntities.length,
      relations: allRelations.length,
      pending: allPending.length,
    },
    entities: uiEntities,
    relations: uiRelations,
    pending: pending.map((item) => toUiPendingKnowledgeItem(store, item)),
    analysis,
    review: planKnowledgeGraphReview(analysis, 8),
    trust: summarizeKnowledgeTrust([...uiEntities.map((entity) => entity.trust), ...uiRelations.map((relation) => relation.trust)]),
  };
}

function emptyKnowledgeGraphSummary(paths: RuntimePaths): UiKnowledgeGraphSummary {
  const analysis = analyzeKnowledgeGraph({ entities: [], relations: [], pending: [] });
  return {
    ok: true,
    database: { exists: false, path: paths.memoryDbPath },
    state: { paused: false },
    counts: { entities: 0, relations: 0, pending: 0 },
    entities: [],
    relations: [],
    pending: [],
    analysis,
    review: planKnowledgeGraphReview(analysis, 8),
    trust: summarizeKnowledgeTrust([]),
  };
}

function toUiKnowledgeEntity(store: SqliteMemoryStore, entity: KnowledgeEntity, trustContext: KnowledgeTrustContext): UiKnowledgeEntity {
  const source = buildKnowledgeSourceAttribution(entity.sourceMemoryId, entity.sourceMessageId);
  const auditTrail = store.listKnowledgeAuditEvents("entity", entity.id, 12).map(toUiKnowledgeAuditEvent);
  return {
    id: entity.id,
    canonicalName: entity.canonicalName,
    kind: entity.kind,
    aliases: entity.aliases,
    sensitivity: entity.sensitivity,
    scope: entity.scope,
    confidence: entity.confidence,
    ...(entity.sourceMemoryId === undefined ? {} : { sourceMemoryId: entity.sourceMemoryId }),
    ...(entity.sourceMessageId === undefined ? {} : { sourceMessageId: entity.sourceMessageId }),
    source,
    trust: buildKnowledgeTrustMetrics({ confidence: entity.confidence, updatedAt: entity.updatedAt, sourceMemoryId: entity.sourceMemoryId, sourceMessageId: entity.sourceMessageId, sourceKind: source.kind, auditTrail, relationCount: trustContext.entityRelationCounts.get(entity.id) ?? 0 }),
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    auditTrail,
  };
}

function toUiKnowledgeRelation(store: SqliteMemoryStore, relation: KnowledgeRelationWithEntities, trustContext: KnowledgeTrustContext): UiKnowledgeRelation {
  const source = buildKnowledgeSourceAttribution(relation.sourceMemoryId, relation.sourceMessageId);
  const auditTrail = store.listKnowledgeAuditEvents("relation", relation.id, 12).map(toUiKnowledgeAuditEvent);
  return {
    id: relation.id,
    sourceEntityId: relation.sourceEntityId,
    sourceName: relation.sourceEntity.canonicalName,
    sourceKind: relation.sourceEntity.kind,
    relationType: relation.relationType,
    targetEntityId: relation.targetEntityId,
    targetName: relation.targetEntity.canonicalName,
    targetKind: relation.targetEntity.kind,
    ...(relation.evidence === undefined ? {} : { evidence: relation.evidence }),
    sensitivity: relation.sensitivity,
    scope: relation.scope,
    confidence: relation.confidence,
    ...(relation.sourceMemoryId === undefined ? {} : { sourceMemoryId: relation.sourceMemoryId }),
    ...(relation.sourceMessageId === undefined ? {} : { sourceMessageId: relation.sourceMessageId }),
    source,
    trust: buildKnowledgeTrustMetrics({ confidence: relation.confidence, updatedAt: relation.updatedAt, sourceMemoryId: relation.sourceMemoryId, sourceMessageId: relation.sourceMessageId, sourceKind: source.kind, auditTrail, conflicting: trustContext.conflictingRelationIds.has(relation.id) }),
    createdAt: relation.createdAt,
    updatedAt: relation.updatedAt,
    auditTrail,
  };
}

function toUiPendingKnowledgeItem(store: SqliteMemoryStore, item: PendingKnowledgeItem): UiPendingKnowledgeItem {
  return {
    id: item.id,
    ...(item.reason === undefined ? {} : { reason: item.reason }),
    ...(item.source === undefined ? {} : { source: item.source }),
    sourceAttribution: buildPendingKnowledgeSourceAttribution(item),
    explicitConsent: item.explicitConsent,
    createdAt: item.createdAt,
    payloadSummary: summarizePendingKnowledgePayload(item.payload),
    auditTrail: store.listKnowledgeAuditEvents("pending", item.id, 12).map(toUiKnowledgeAuditEvent),
  };
}

interface KnowledgeTrustContext {
  entityRelationCounts: Map<number, number>;
  conflictingRelationIds: Set<number>;
}

function buildTrustContext(analysis: KnowledgeGraphAnalysis, relations: KnowledgeRelationWithEntities[]): KnowledgeTrustContext {
  const entityRelationCounts = new Map<number, number>();
  for (const relation of relations) {
    entityRelationCounts.set(relation.sourceEntityId, (entityRelationCounts.get(relation.sourceEntityId) ?? 0) + 1);
    entityRelationCounts.set(relation.targetEntityId, (entityRelationCounts.get(relation.targetEntityId) ?? 0) + 1);
  }
  return {
    entityRelationCounts,
    conflictingRelationIds: new Set(analysis.conflictingRelations.flatMap((conflict) => conflict.relationIds)),
  };
}

function buildPendingKnowledgeSourceAttribution(item: PendingKnowledgeItem): UiKnowledgeSourceAttribution {
  const payloadSource = readPendingPayloadSourceMessageId(item.payload);
  return buildKnowledgeSourceAttribution(undefined, payloadSource ?? item.source);
}

function readPendingPayloadSourceMessageId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  const values = [record.sourceMessageId];
  if (Array.isArray(record.entities)) values.push(...record.entities.map((entity) => typeof entity === "object" && entity !== null ? (entity as Record<string, unknown>).sourceMessageId : undefined));
  if (Array.isArray(record.relations)) values.push(...record.relations.map((relation) => typeof relation === "object" && relation !== null ? (relation as Record<string, unknown>).sourceMessageId : undefined));
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function buildKnowledgeSourceAttribution(sourceMemoryId: number | undefined, sourceMessageId: string | undefined): UiKnowledgeSourceAttribution {
  const kind = knowledgeTrustSourceKind({ sourceMemoryId, sourceMessageId });
  if (kind === "memory" && sourceMemoryId !== undefined) {
    return { kind: "memory", label: `Memory #${sourceMemoryId}`, memoryId: sourceMemoryId, ...(sourceMessageId === undefined ? {} : { sourceMessageId }) };
  }
  if (sourceMessageId !== undefined) {
    const uiChat = parseUiChatSource(sourceMessageId);
    if (kind === "ui_chat" && uiChat) {
      return { kind: "ui_chat", label: `UI chat session #${uiChat.chatSessionId}, message #${uiChat.chatMessageId}`, sourceMessageId, ...uiChat };
    }
    return { kind: "message", label: `Message ${sourceMessageId}`, sourceMessageId };
  }
  return { kind: "manual", label: "Thủ công hoặc suy luận" };
}

function parseUiChatSource(sourceMessageId: string): { chatSessionId: number; chatMessageId: number; chatRunId?: number } | undefined {
  const match = sourceMessageId.match(/^ui-chat:(\d+):message:(\d+)(?::run:(\d+))?$/);
  if (!match) return undefined;
  return { chatSessionId: Number(match[1]), chatMessageId: Number(match[2]), ...(match[3] === undefined ? {} : { chatRunId: Number(match[3]) }) };
}

function toUiKnowledgeAuditEvent(event: KnowledgeAuditEvent): UiKnowledgeAuditEvent {
  return {
    id: event.id,
    eventType: event.eventType,
    ...(event.actor === undefined ? {} : { actor: event.actor }),
    ...(event.channel === undefined ? {} : { channel: event.channel }),
    ...(event.reason === undefined ? {} : { reason: event.reason }),
    ...(event.payloadSummary === undefined ? {} : { payloadSummary: event.payloadSummary }),
    createdAt: event.createdAt,
  };
}

function summarizePendingKnowledgePayload(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return typeof payload === "string" ? payload.slice(0, 120) : "payload đồ thị đang chờ";
  }

  const record = payload as Record<string, unknown>;
  const entityCount = Array.isArray(record.entities) ? record.entities.length : 0;
  const relationCount = Array.isArray(record.relations) ? record.relations.length : 0;
  return `${entityCount} entity, ${relationCount} relation`;
}

function pendingKnowledgeMatches(item: PendingKnowledgeItem, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return false;
  return [item.reason, item.source, summarizePendingKnowledgePayload(item.payload)].some((value) => value?.toLocaleLowerCase().includes(normalized));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
