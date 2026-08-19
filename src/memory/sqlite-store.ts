import Database from "better-sqlite3";
import { mkdir } from "node:fs/promises";

import { getRuntimePaths, type RuntimePaths } from "../runtime/paths.js";
import { evaluateKnowledgePayload, explainKnowledgePolicyDiagnostics, isKnowledgeEntityKind, type KnowledgePolicyDiagnostics } from "./knowledge-policy.js";
import { MEMORY_SCHEMA_SQL } from "./schema.js";

export interface StoredMemory {
  id: number;
  type: string;
  content: string;
  sensitivity: "normal" | "sensitive" | "secret";
  importance: number;
  status: string;
  sourceMessageId?: string;
  source?: string;
  explicitConsent: boolean;
  policyReason?: string;
  pinned: boolean;
  scope: MemoryScope;
  namespace?: string;
  confidence: number;
  expiresAt?: string;
  supersededBy?: number;
  lastAccessedAt?: string;
  accessCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PendingMemory {
  id: number;
  type: string;
  content: string;
  reason?: string;
  source?: string;
  explicitConsent: boolean;
  createdAt: string;
  namespace?: string;
}

export interface PendingActionApproval {
  id: number;
  channel: string;
  userId?: string;
  category: string;
  action: string;
  target?: string;
  reason?: string;
  proposedReason?: string;
  payloadJson?: string;
  status: "pending" | "approved" | "denied" | "expired" | "executed";
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
}

export interface NewPendingActionApproval {
  channel: string;
  userId?: string;
  category: string;
  action: string;
  target?: string;
  reason?: string;
  proposedReason?: string;
  payloadJson?: string;
  ttlMs?: number;
}

export type StoredMessageRole = "user" | "assistant" | "system";

export interface StoredMessage {
  id: number;
  channel?: string;
  userId?: string;
  role: StoredMessageRole;
  content: string;
  createdAt: string;
}

export interface ConversationSummary {
  id: number;
  channel: string;
  userId?: string;
  content: string;
  summarizedMessageId: number;
  updatedAt: string;
}

export interface MemoryState {
  paused: boolean;
}

export interface NewMessage {
  channel?: string;
  userId?: string;
  role: StoredMessageRole;
  content: string;
}

export interface UiChatSession {
  id: number;
  title: string;
  agentId?: string;
  createdAt: string;
  updatedAt: string;
  pinnedAt?: string;
  toolsEnabled: boolean;
  memoryEnabled: boolean;
  providerModelRef?: string;
  messageCount: number;
  eventTypes: string[];
}

export interface UiChatMessage {
  id: number;
  sessionId: number;
  runId?: number;
  role: "user" | "assistant";
  content: string;
  metadataJson?: string;
  attachments?: UiChatMessageAttachment[];
  createdAt: string;
  namespace?: string;
}

export interface UiChatMessageAttachment {
  name: string;
  type?: string;
  size?: number;
  content: string;
}

export interface UiChatEvent {
  id: number;
  sessionId: number;
  runId?: number;
  eventType: string;
  label?: string;
  payloadJson?: string;
  createdAt: string;
}

export interface UiChatRun {
  id: number;
  sessionId: number;
  status: string;
  model?: string;
  providerModelRef?: string;
  userMessageId?: number;
  assistantMessageId?: number;
  metadataJson?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface UiChatBranchLink {
  sessionId: number;
  title: string;
  sourceSessionId: number;
  sourceMessageId: number;
}

export type CronScheduleType = "interval" | "cron_expr" | "once";

export interface CronSchedule {
  id: number;
  name: string;
  scheduleType: CronScheduleType;
  scheduleValue: string;
  prompt: string;
  channel?: string;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  nextRunAt: string;
  lastResult?: string;
  lastError?: string;
  runCount: number;
}

export interface NewCronSchedule {
  name: string;
  scheduleType: CronScheduleType;
  scheduleValue: string;
  prompt: string;
  channel?: string;
  enabled?: boolean;
  nextRunAt: string;
}

export interface CronLog {
  id: number;
  scheduleId: number;
  startedAt: string;
  finishedAt?: string;
  result?: string;
  output?: string;
  error?: string;
}

export interface MemoryHygieneSnapshot {
  id: number;
  score: number;
  label: string;
  checked: number;
  deleteCandidates: number;
  reviewOnly: number;
  duplicateGroups: number;
  staleMemories: number;
  conflictGroups: number;
  source: string;
  createdAt: string;
}

export interface NewMemoryHygieneSnapshot {
  score: number;
  label: string;
  checked: number;
  deleteCandidates: number;
  reviewOnly: number;
  duplicateGroups: number;
  staleMemories: number;
  conflictGroups: number;
  source?: string;
}

export type KnowledgeEntityKind = "person" | "project" | "preference" | "tool" | "skill" | "topic" | "organization" | "location" | "decision" | "concept";
export type KnowledgeSensitivity = "normal" | "sensitive" | "secret";

export interface KnowledgeEntity {
  id: number;
  canonicalName: string;
  kind: KnowledgeEntityKind;
  aliases: string[];
  sensitivity: KnowledgeSensitivity;
  scope: MemoryScope;
  namespace?: string;
  confidence: number;
  sourceMemoryId?: number;
  sourceMessageId?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeRelation {
  id: number;
  sourceEntityId: number;
  relationType: string;
  targetEntityId: number;
  evidence?: string;
  sensitivity: KnowledgeSensitivity;
  scope: MemoryScope;
  namespace?: string;
  confidence: number;
  sourceMemoryId?: number;
  sourceMessageId?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeRelationWithEntities extends KnowledgeRelation {
  sourceEntity: KnowledgeEntity;
  targetEntity: KnowledgeEntity;
}

export type KnowledgeAuditSubjectType = "entity" | "relation" | "pending";

export interface KnowledgeAuditEvent {
  id: number;
  subjectType: KnowledgeAuditSubjectType;
  subjectId: number;
  eventType: string;
  actor?: string;
  channel?: string;
  reason?: string;
  payloadSummary?: string;
  createdAt: string;
}

interface NewKnowledgeAuditEvent {
  subjectType: KnowledgeAuditSubjectType;
  subjectId: number;
  eventType: string;
  actor?: string;
  channel?: string;
  reason?: string;
  payloadSummary?: string;
}

export interface PendingKnowledgeItem {
  id: number;
  payload: unknown;
  reason?: string;
  source?: string;
  explicitConsent: boolean;
  createdAt: string;
  namespace?: string;
}

export interface ApprovedKnowledgeItem {
  status: "approved";
  entities: KnowledgeEntity[];
  relations: KnowledgeRelation[];
}

export interface BlockedPendingKnowledgeItem {
  status: "blocked";
  reason: string;
  diagnostics?: KnowledgePolicyDiagnostics;
  explanation?: string;
}

export type PendingKnowledgeApprovalResult = ApprovedKnowledgeItem | BlockedPendingKnowledgeItem;

export interface SanitizedPendingKnowledgeItem {
  status: "sanitized";
  item: PendingKnowledgeItem;
  previousDiagnostics?: KnowledgePolicyDiagnostics;
}

export type PendingKnowledgeSanitizeResult = SanitizedPendingKnowledgeItem | BlockedPendingKnowledgeItem;

export interface KnowledgeEntityMergeResult {
  primary: KnowledgeEntity;
  duplicate: KnowledgeEntity;
  redirectedRelations: number;
  mergedRelations: number;
}

export interface KnowledgeGraphSearchResult {
  query: string;
  entities: KnowledgeEntity[];
  relations: KnowledgeRelationWithEntities[];
}

export interface NewKnowledgeEntity {
  canonicalName: string;
  kind: KnowledgeEntityKind;
  aliases?: string[];
  sensitivity?: KnowledgeSensitivity;
  scope?: MemoryScope;
  namespace?: string;
  confidence?: number;
  sourceMemoryId?: number;
  sourceMessageId?: string;
}

export interface NewKnowledgeRelation {
  sourceEntityId: number;
  relationType: string;
  targetEntityId: number;
  evidence?: string;
  sensitivity?: KnowledgeSensitivity;
  scope?: MemoryScope;
  namespace?: string;
  confidence?: number;
  sourceMemoryId?: number;
  sourceMessageId?: string;
}

export interface KnowledgeRelationUpdate {
  evidence?: string;
  sensitivity?: KnowledgeSensitivity;
  scope?: MemoryScope;
  confidence?: number;
}

interface ParsedPendingKnowledgeRelation extends Omit<NewKnowledgeRelation, "sourceEntityId" | "targetEntityId" | "relationType"> {
  sourceEntityId?: number;
  sourceName?: string;
  sourceKind?: KnowledgeEntityKind;
  relationType: string;
  targetEntityId?: number;
  targetName?: string;
  targetKind?: KnowledgeEntityKind;
}

export interface NewMemory {
  type: string;
  content: string;
  sensitivity?: "normal" | "sensitive";
  importance?: number;
  sourceMessageId?: string;
  source?: string;
  explicitConsent?: boolean;
  policyReason?: string;
  pinned?: boolean;
  scope?: MemoryScope;
  namespace?: string;
  confidence?: number;
  expiresAt?: string;
  supersededBy?: number;
}

export type MemoryScope = "core" | "project" | "session";
const SESSION_MEMORY_DEFAULT_TTL_DAYS = 14;

export function isMemoryScope(value: string | undefined): value is MemoryScope {
  return value === "core" || value === "project" || value === "session";
}

export class SqliteMemoryStore {
  private constructor(private readonly db: Database.Database) {}

  static async open(paths: RuntimePaths = getRuntimePaths()): Promise<SqliteMemoryStore> {
    await mkdir(paths.dataDir, { recursive: true });
    const db = new Database(paths.memoryDbPath);
    db.pragma("journal_mode = WAL");
    db.exec(MEMORY_SCHEMA_SQL);
    applyMemoryMigrations(db);
    initializeMemorySearchIndex(db);
    return new SqliteMemoryStore(db);
  }

  getMemoryState(): MemoryState {
    const row = this.db.prepare("SELECT value FROM memory_state WHERE key = 'paused'").get() as { value: string } | undefined;

    return { paused: row?.value === "true" };
  }

  setMemoryPaused(paused: boolean): MemoryState {
    this.db
      .prepare(`
        INSERT INTO memory_state (key, value, updated_at)
        VALUES ('paused', @value, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `)
      .run({ value: paused ? "true" : "false" });

    return this.getMemoryState();
  }

  getMemoryStateValue(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM memory_state WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMemoryStateValue(key: string, value: string): void {
    this.db
      .prepare(`
        INSERT INTO memory_state (key, value, updated_at)
        VALUES (@key, @value, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `)
      .run({ key, value });
  }

  addMessage(message: NewMessage): StoredMessage {
    const result = this.db
      .prepare("INSERT INTO messages (channel, user_id, role, content) VALUES (@channel, @userId, @role, @content)")
      .run({
        channel: message.channel ?? null,
        userId: message.userId ?? null,
        role: message.role,
        content: message.content,
      });

    return this.getMessage(Number(result.lastInsertRowid));
  }

  listAllMessages(): StoredMessage[] {
    const rows = this.db.prepare("SELECT * FROM messages ORDER BY id ASC").all() as MessageRow[];

    return rows.map(mapMessageRow);
  }

  listRecentMessages(limit = 20, role?: StoredMessageRole): StoredMessage[] {
    const rows = role
      ? (this.db.prepare("SELECT * FROM messages WHERE role = ? ORDER BY id DESC LIMIT ?").all(role, limit) as MessageRow[])
      : (this.db.prepare("SELECT * FROM messages ORDER BY id DESC LIMIT ?").all(limit) as MessageRow[]);

    return rows.reverse().map(mapMessageRow);
  }

  listRecentMessagesForChannel(channel: string, userId?: string, limit = 20): StoredMessage[] {
    const rows = userId === undefined
      ? this.db.prepare("SELECT * FROM messages WHERE channel = ? AND user_id IS NULL ORDER BY id DESC LIMIT ?").all(channel, limit) as MessageRow[]
      : this.db.prepare("SELECT * FROM messages WHERE channel = ? AND user_id = ? ORDER BY id DESC LIMIT ?").all(channel, userId, limit) as MessageRow[];

    return rows.reverse().map(mapMessageRow);
  }

  listMessagesForChannel(channel: string, userId?: string): StoredMessage[] {
    const rows = userId === undefined
      ? this.db.prepare("SELECT * FROM messages WHERE channel = ? AND user_id IS NULL ORDER BY id ASC").all(channel) as MessageRow[]
      : this.db.prepare("SELECT * FROM messages WHERE channel = ? AND user_id = ? ORDER BY id ASC").all(channel, userId) as MessageRow[];

    return rows.map(mapMessageRow);
  }

  getConversationSummary(channel: string, userId?: string): ConversationSummary | undefined {
    const row = this.db
      .prepare("SELECT * FROM conversation_summaries WHERE channel = ? AND user_id = ?")
      .get(channel, conversationSummaryUserId(userId)) as ConversationSummaryRow | undefined;

    return row ? mapConversationSummaryRow(row) : undefined;
  }

  listConversationSummaries(options: { channel?: string; userId?: string; limit?: number } = {}): ConversationSummary[] {
    const limit = options.limit ?? 20;
    const rows = options.channel === undefined
      ? this.db
        .prepare("SELECT * FROM conversation_summaries WHERE (@userId IS NULL OR user_id = @userId) ORDER BY updated_at DESC, id DESC LIMIT @limit")
        .all({ userId: options.userId === undefined ? null : conversationSummaryUserId(options.userId), limit }) as ConversationSummaryRow[]
      : this.db
        .prepare("SELECT * FROM conversation_summaries WHERE channel = @channel AND (@userId IS NULL OR user_id = @userId) ORDER BY updated_at DESC, id DESC LIMIT @limit")
        .all({ channel: options.channel, userId: options.userId === undefined ? null : conversationSummaryUserId(options.userId), limit }) as ConversationSummaryRow[];

    return rows.map(mapConversationSummaryRow);
  }

  upsertConversationSummary(summary: { channel: string; userId?: string; content: string; summarizedMessageId: number }): ConversationSummary {
    this.db
      .prepare(`
        INSERT INTO conversation_summaries (channel, user_id, content, summarized_message_id, updated_at)
        VALUES (@channel, @userId, @content, @summarizedMessageId, CURRENT_TIMESTAMP)
        ON CONFLICT(channel, user_id) DO UPDATE SET
          content = excluded.content,
          summarized_message_id = excluded.summarized_message_id,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run({ channel: summary.channel, userId: conversationSummaryUserId(summary.userId), content: summary.content, summarizedMessageId: summary.summarizedMessageId });

    return this.getConversationSummary(summary.channel, summary.userId)!;
  }

  searchMessages(query: string, limit = 20, role?: StoredMessageRole): StoredMessage[] {
    const normalizedQuery = query.trim();

    if (normalizedQuery.length === 0) {
      return [];
    }

    const rows = this.db
      .prepare(`
        SELECT * FROM messages
        WHERE content LIKE @query ESCAPE '\\'
          AND (@role IS NULL OR role = @role)
        ORDER BY id DESC
        LIMIT @limit
      `)
      .all({ query: `%${escapeLike(normalizedQuery)}%`, limit, role: role ?? null }) as MessageRow[];

    return rows.reverse().map(mapMessageRow);
  }

  addMemory(memory: NewMemory): StoredMemory {
    const scope = memory.scope ?? defaultMemoryScope(memory.type);
    const statement = this.db.prepare(`
      INSERT INTO memories (type, content, sensitivity, importance, source_message_id, source, explicit_consent, policy_reason, pinned, scope, namespace, confidence, expires_at, superseded_by)
      VALUES (@type, @content, @sensitivity, @importance, @sourceMessageId, @source, @explicitConsent, @policyReason, @pinned, @scope, @namespace, @confidence, @expiresAt, @supersededBy)
    `);
    const result = statement.run({
      type: memory.type,
      content: memory.content,
      sensitivity: memory.sensitivity ?? "normal",
      importance: memory.importance ?? 3,
      sourceMessageId: memory.sourceMessageId ?? null,
      source: memory.source ?? "manual",
      explicitConsent: memory.explicitConsent ? 1 : 0,
      policyReason: memory.policyReason ?? null,
      pinned: memory.pinned ? 1 : 0,
      scope,
      namespace: memory.namespace ?? "primary",
      confidence: memory.confidence ?? 1,
      expiresAt: memory.expiresAt ?? defaultExpiresAtForScope(scope),
      supersededBy: memory.supersededBy ?? null,
    });

    const inserted = this.getMemory(Number(result.lastInsertRowid));
    this.upsertMemorySearchIndex(inserted);
    return inserted;
  }

  addPendingMemory(memory: { type: string; content: string; reason?: string; source?: string; explicitConsent?: boolean; namespace?: string }): PendingMemory {
    const result = this.db
      .prepare("INSERT INTO pending_memories (type, content, reason, source, explicit_consent, namespace) VALUES (@type, @content, @reason, @source, @explicitConsent, @namespace)")
      .run({
        type: memory.type,
        content: memory.content,
        reason: memory.reason ?? null,
        source: memory.source ?? "manual",
        explicitConsent: memory.explicitConsent ? 1 : 0,
        namespace: memory.namespace ?? "primary",
      });

    const pending = this.getPendingMemory(Number(result.lastInsertRowid));

    if (!pending) {
      throw new Error(`Pending memory not found after insert: ${String(result.lastInsertRowid)}`);
    }

    return pending;
  }

  listPendingMemories(limit = 20): PendingMemory[] {
    const rows = this.db.prepare("SELECT * FROM pending_memories ORDER BY created_at DESC LIMIT ?").all(limit) as PendingMemoryRow[];

    return rows.map(mapPendingMemoryRow);
  }

  searchPendingMemories(query: string, limit = 20): PendingMemory[] {
    const normalizedQuery = query.trim();

    if (normalizedQuery.length === 0) {
      return [];
    }

    const rows = this.db
      .prepare(`
        SELECT * FROM pending_memories
        WHERE content LIKE @query ESCAPE '\\'
          OR type LIKE @query ESCAPE '\\'
          OR reason LIKE @query ESCAPE '\\'
        ORDER BY created_at DESC
        LIMIT @limit
      `)
      .all({ query: `%${escapeLike(normalizedQuery)}%`, limit }) as PendingMemoryRow[];

    return rows.map(mapPendingMemoryRow);
  }

  getPendingMemoryById(id: number): PendingMemory | undefined {
    return this.getPendingMemory(id);
  }

  approvePendingMemory(id: number): StoredMemory | undefined {
    const pending = this.getPendingMemory(id);

    if (!pending) {
      return undefined;
    }

    const transaction = this.db.transaction(() => {
      const memory = this.addMemory({
        type: pending.type,
        content: pending.content,
        sensitivity: "sensitive",
        source: pending.source,
        explicitConsent: true,
        policyReason: pending.reason,
        namespace: pending.namespace,
      });
      this.db.prepare("DELETE FROM pending_memories WHERE id = ?").run(id);
      return memory;
    });

    return transaction();
  }

  rejectPendingMemory(id: number): boolean {
    const result = this.db.prepare("DELETE FROM pending_memories WHERE id = ?").run(id);

    return result.changes > 0;
  }

  rejectAllPendingMemories(): number {
    const result = this.db.prepare("DELETE FROM pending_memories").run();

    return result.changes;
  }

  addPendingActionApproval(approval: NewPendingActionApproval): PendingActionApproval {
    const expiresAt = new Date(Date.now() + (approval.ttlMs ?? 5 * 60 * 1000)).toISOString();
    const result = this.db
      .prepare(`
        INSERT INTO pending_action_approvals (channel, user_id, category, action, target, reason, proposed_reason, payload_json, expires_at)
        VALUES (@channel, @userId, @category, @action, @target, @reason, @proposedReason, @payloadJson, @expiresAt)
      `)
      .run({
        channel: approval.channel,
        userId: approval.userId ?? null,
        category: approval.category,
        action: approval.action,
        target: approval.target ?? null,
        reason: approval.reason ?? null,
        proposedReason: approval.proposedReason ?? null,
        payloadJson: approval.payloadJson ?? null,
        expiresAt,
      });

    const pending = this.getPendingActionApproval(Number(result.lastInsertRowid));

    if (!pending) {
      throw new Error(`Pending action approval not found after insert: ${String(result.lastInsertRowid)}`);
    }

    return pending;
  }

  listPendingActionApprovals(channel: string, userId?: string, limit = 20): PendingActionApproval[] {
    this.expirePendingActionApprovals();
    const rows = this.db
      .prepare(`
        SELECT * FROM pending_action_approvals
        WHERE channel = @channel
          AND status = 'pending'
          AND (@userId IS NULL OR user_id = @userId)
        ORDER BY id DESC
        LIMIT @limit
      `)
      .all({ channel, userId: userId ?? null, limit }) as PendingActionApprovalRow[];

    return rows.map(mapPendingActionApprovalRow);
  }

  getPendingActionApprovalById(id: number): PendingActionApproval | undefined {
    this.expirePendingActionApprovals();
    return this.getPendingActionApproval(id);
  }

  approvePendingActionApproval(id: number): PendingActionApproval | undefined {
    return this.decidePendingActionApproval(id, "approved");
  }

  denyPendingActionApproval(id: number): PendingActionApproval | undefined {
    return this.decidePendingActionApproval(id, "denied");
  }

  markActionApprovalExecuted(id: number): boolean {
    const result = this.db
      .prepare("UPDATE pending_action_approvals SET status = 'executed', decided_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'approved'")
      .run(id);

    return result.changes > 0;
  }

  expirePendingActionApprovals(now = new Date()): number {
    const result = this.db
      .prepare("UPDATE pending_action_approvals SET status = 'expired', decided_at = CURRENT_TIMESTAMP WHERE status = 'pending' AND expires_at <= ?")
      .run(now.toISOString());

    return result.changes;
  }

  updateMemoryContent(id: number, content: string): StoredMemory | undefined {
    const result = this.db
      .prepare("UPDATE memories SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'")
      .run(content, id);

    if (result.changes === 0) {
      return undefined;
    }

    const memory = this.getMemory(id);
    this.upsertMemorySearchIndex(memory);
    return memory;
  }

  setMemoryPinned(id: number, pinned: boolean): StoredMemory | undefined {
    const result = this.db
      .prepare("UPDATE memories SET pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'")
      .run(pinned ? 1 : 0, id);

    return result.changes === 0 ? undefined : this.getMemory(id);
  }

  setMemoryScope(id: number, scope: MemoryScope): StoredMemory | undefined {
    const result = this.db
      .prepare("UPDATE memories SET scope = ?, expires_at = CASE WHEN ? = 'session' AND expires_at IS NULL THEN ? ELSE expires_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'")
      .run(scope, scope, defaultExpiresAtForScope(scope), id);

    return result.changes === 0 ? undefined : this.getMemory(id);
  }

  supersedeMemory(oldId: number, newId: number): StoredMemory | undefined {
    if (oldId === newId || !this.getActiveMemory(newId)) {
      return undefined;
    }

    const result = this.db
      .prepare("UPDATE memories SET superseded_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'")
      .run(newId, oldId);

    return result.changes === 0 ? undefined : this.getMemory(oldId);
  }

  forgetMemory(id: number): boolean {
    const result = this.db
      .prepare("UPDATE memories SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'")
      .run(id);

    if (result.changes === 0) {
      return false;
    }

    this.deleteMemorySearchIndex(id);
    return true;
  }

  listAllMemories(): StoredMemory[] {
    const rows = this.db.prepare("SELECT * FROM memories ORDER BY id ASC").all() as MemoryRow[];

    return rows.map(mapMemoryRow);
  }

  getActiveMemory(id: number): StoredMemory | undefined {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ? AND status = 'active'").get(id) as MemoryRow | undefined;

    return row ? mapMemoryRow(row) : undefined;
  }

  listActiveMemories(limit?: number, namespace = "primary"): StoredMemory[] {
    const rows = limit === undefined
      ? (this.db.prepare("SELECT * FROM memories WHERE status = 'active' AND namespace = ? ORDER BY importance DESC, updated_at DESC").all(namespace) as MemoryRow[])
      : (this.db.prepare("SELECT * FROM memories WHERE status = 'active' AND namespace = ? ORDER BY importance DESC, updated_at DESC LIMIT ?").all(namespace, limit) as MemoryRow[]);

    return rows.map(mapMemoryRow);
  }

  listActiveMemoriesByScope(scope: MemoryScope): StoredMemory[] {
    const rows = this.db.prepare("SELECT * FROM memories WHERE status = 'active' AND scope = ? ORDER BY importance DESC, updated_at DESC").all(scope) as MemoryRow[];

    return rows.map(mapMemoryRow);
  }

  addMemoryHygieneSnapshot(snapshot: NewMemoryHygieneSnapshot): MemoryHygieneSnapshot {
    const result = this.db.prepare(`
      INSERT INTO memory_hygiene_snapshots (score, label, checked, delete_candidates, review_only, duplicate_groups, stale_memories, conflict_groups, source)
      VALUES (@score, @label, @checked, @deleteCandidates, @reviewOnly, @duplicateGroups, @staleMemories, @conflictGroups, @source)
    `).run({ ...snapshot, source: snapshot.source ?? "manual" });

    return this.getMemoryHygieneSnapshot(Number(result.lastInsertRowid))!;
  }

  getMemoryHygieneSnapshot(id: number): MemoryHygieneSnapshot | undefined {
    const row = this.db.prepare("SELECT * FROM memory_hygiene_snapshots WHERE id = ?").get(id) as MemoryHygieneSnapshotRow | undefined;
    return row ? mapMemoryHygieneSnapshotRow(row) : undefined;
  }

  listMemoryHygieneSnapshots(limit = 2): MemoryHygieneSnapshot[] {
    const rows = this.db.prepare("SELECT * FROM memory_hygiene_snapshots ORDER BY id DESC LIMIT ?").all(limit) as MemoryHygieneSnapshotRow[];
    return rows.map(mapMemoryHygieneSnapshotRow);
  }

  searchMemories(query: string, limit?: number, namespace = "primary"): StoredMemory[] {
    const normalizedQuery = query.trim();

    if (normalizedQuery.length === 0) {
      return [];
    }

    const ftsQuery = normalizeMemoryFtsQuery(normalizedQuery);
    if (ftsQuery && hasMemorySearchIndex(this.db)) {
      try {
        const rows = limit === undefined
          ? (this.db
              .prepare(`
            SELECT memories.*
            FROM memory_search
            JOIN memories ON memories.id = memory_search.memory_id
            WHERE memory_search MATCH @query
              AND memories.status = 'active'
              AND memories.namespace = @namespace
            ORDER BY bm25(memory_search), memories.importance DESC, memories.updated_at DESC
          `)
              .all({ query: ftsQuery, namespace }) as MemoryRow[])
          : (this.db
              .prepare(`
            SELECT memories.*
            FROM memory_search
            JOIN memories ON memories.id = memory_search.memory_id
            WHERE memory_search MATCH @query
              AND memories.status = 'active'
              AND memories.namespace = @namespace
            ORDER BY bm25(memory_search), memories.importance DESC, memories.updated_at DESC
            LIMIT @limit
          `)
              .all({ query: ftsQuery, limit, namespace }) as MemoryRow[]);

        return rows.map(mapMemoryRow);
      } catch {
        // Fall through to LIKE search if the local SQLite build rejects FTS syntax.
      }
    }

    const rows = limit === undefined
      ? (this.db
          .prepare(`
        SELECT * FROM memories
        WHERE status = 'active'
          AND namespace = @namespace
          AND (content LIKE @query ESCAPE '\' OR type LIKE @query ESCAPE '\')
        ORDER BY importance DESC, updated_at DESC
      `)
          .all({ query: `%${escapeLike(normalizedQuery)}%`, namespace }) as MemoryRow[])
      : (this.db
          .prepare(`
        SELECT * FROM memories
        WHERE status = 'active'
          AND namespace = @namespace
          AND (content LIKE @query ESCAPE '\\' OR type LIKE @query ESCAPE '\\')
        ORDER BY importance DESC, updated_at DESC
        LIMIT @limit
      `)
          .all({ query: `%${escapeLike(normalizedQuery)}%`, limit, namespace }) as MemoryRow[]);

    return rows.map(mapMemoryRow);
  }

  recordMemoryAccess(memoryIds: number[]): void {
    const ids = [...new Set(memoryIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length === 0) return;

    const placeholders = ids.map(() => "?").join(", ");
    this.db
      .prepare(`UPDATE memories SET last_accessed_at = CURRENT_TIMESTAMP, access_count = COALESCE(access_count, 0) + 1 WHERE status = 'active' AND id IN (${placeholders})`)
      .run(...ids);
  }

  upsertKnowledgeEntity(entity: NewKnowledgeEntity): KnowledgeEntity {
    const canonicalName = normalizeKnowledgeName(entity.canonicalName);
    if (!canonicalName) {
      throw new Error("Knowledge entity canonicalName is required.");
    }

    const aliases = normalizeKnowledgeAliases(entity.aliases ?? []);
    const namespace = entity.namespace ?? "primary";
    const existing = this.getKnowledgeEntityByName(canonicalName, entity.kind, namespace);
    if (existing) {
      const mergedAliases = normalizeKnowledgeAliases([...existing.aliases, ...aliases]);
      this.db
        .prepare(`
          UPDATE knowledge_entities
          SET aliases_json = @aliasesJson,
              sensitivity = @sensitivity,
              scope = @scope,
              confidence = MAX(confidence, @confidence),
              source_memory_id = COALESCE(source_memory_id, @sourceMemoryId),
              source_message_id = COALESCE(source_message_id, @sourceMessageId),
              status = 'active',
              updated_at = CURRENT_TIMESTAMP
          WHERE id = @id
        `)
      .run({
        id: existing.id,
        aliasesJson: JSON.stringify(mergedAliases),
          sensitivity: maxKnowledgeSensitivity(existing.sensitivity, entity.sensitivity ?? "normal"),
          scope: entity.scope ?? existing.scope,
          confidence: clampKnowledgeConfidence(entity.confidence),
          sourceMemoryId: entity.sourceMemoryId ?? null,
          sourceMessageId: entity.sourceMessageId ?? null,
        });
      const updated = this.getKnowledgeEntity(existing.id)!;
      this.addKnowledgeAuditEvent({ subjectType: "entity", subjectId: updated.id, eventType: "updated", actor: "system", reason: "Knowledge entity upsert refreshed an existing entity.", payloadSummary: summarizeKnowledgeEntityAudit(updated) });
      return updated;
    }

    const result = this.db
      .prepare(`
        INSERT INTO knowledge_entities (canonical_name, kind, aliases_json, sensitivity, scope, namespace, confidence, source_memory_id, source_message_id)
        VALUES (@canonicalName, @kind, @aliasesJson, @sensitivity, @scope, @namespace, @confidence, @sourceMemoryId, @sourceMessageId)
      `)
      .run({
        canonicalName,
        kind: entity.kind,
        aliasesJson: JSON.stringify(aliases),
        sensitivity: entity.sensitivity ?? "normal",
        scope: entity.scope ?? "core",
        namespace,
        confidence: clampKnowledgeConfidence(entity.confidence),
        sourceMemoryId: entity.sourceMemoryId ?? null,
        sourceMessageId: entity.sourceMessageId ?? null,
      });

    const created = this.getKnowledgeEntity(Number(result.lastInsertRowid))!;
    this.addKnowledgeAuditEvent({ subjectType: "entity", subjectId: created.id, eventType: "created", actor: "system", reason: "Knowledge entity was created.", payloadSummary: summarizeKnowledgeEntityAudit(created) });
    return created;
  }

  upsertKnowledgeRelation(relation: NewKnowledgeRelation): KnowledgeRelation | undefined {
    const source = this.getKnowledgeEntity(relation.sourceEntityId);
    const target = this.getKnowledgeEntity(relation.targetEntityId);
    const namespace = relation.namespace ?? source?.namespace ?? "primary";
    if (!source || !target || source.namespace !== namespace || target.namespace !== namespace) {
      return undefined;
    }

    const relationType = normalizeKnowledgeRelationType(relation.relationType);
    if (!relationType) {
      throw new Error("Knowledge relationType is required.");
    }

    const existing = this.getKnowledgeRelationByTriple(relation.sourceEntityId, relationType, relation.targetEntityId);
    if (existing) {
      this.db
        .prepare(`
          UPDATE knowledge_relations
          SET evidence = COALESCE(@evidence, evidence),
              sensitivity = @sensitivity,
              scope = @scope,
              namespace = @namespace,
              confidence = MAX(confidence, @confidence),
              source_memory_id = COALESCE(source_memory_id, @sourceMemoryId),
              source_message_id = COALESCE(source_message_id, @sourceMessageId),
              status = 'active',
              updated_at = CURRENT_TIMESTAMP
          WHERE id = @id
        `)
        .run({
          id: existing.id,
          evidence: relation.evidence?.trim() || null,
          sensitivity: maxKnowledgeSensitivity(existing.sensitivity, relation.sensitivity ?? "normal"),
          scope: relation.scope ?? existing.scope,
          namespace,
          confidence: clampKnowledgeConfidence(relation.confidence),
          sourceMemoryId: relation.sourceMemoryId ?? null,
          sourceMessageId: relation.sourceMessageId ?? null,
        });
      const updated = this.getKnowledgeRelation(existing.id);
      if (updated) {
        this.addKnowledgeAuditEvent({ subjectType: "relation", subjectId: updated.id, eventType: "updated", actor: "system", reason: "Knowledge relation upsert refreshed an existing relation.", payloadSummary: summarizeKnowledgeRelationAudit(updated) });
      }
      return updated;
    }

    const result = this.db
      .prepare(`
        INSERT INTO knowledge_relations (source_entity_id, relation_type, target_entity_id, evidence, sensitivity, scope, namespace, confidence, source_memory_id, source_message_id)
        VALUES (@sourceEntityId, @relationType, @targetEntityId, @evidence, @sensitivity, @scope, @namespace, @confidence, @sourceMemoryId, @sourceMessageId)
      `)
      .run({
        sourceEntityId: relation.sourceEntityId,
        relationType,
        targetEntityId: relation.targetEntityId,
        evidence: relation.evidence?.trim() || null,
        sensitivity: relation.sensitivity ?? "normal",
        scope: relation.scope ?? "core",
        namespace,
        confidence: clampKnowledgeConfidence(relation.confidence),
        sourceMemoryId: relation.sourceMemoryId ?? null,
        sourceMessageId: relation.sourceMessageId ?? null,
      });

    const created = this.getKnowledgeRelation(Number(result.lastInsertRowid));
    if (created) {
      this.addKnowledgeAuditEvent({ subjectType: "relation", subjectId: created.id, eventType: "created", actor: "system", reason: "Knowledge relation was created.", payloadSummary: summarizeKnowledgeRelationAudit(created) });
    }
    return created;
  }

  addPendingKnowledgeItem(item: { payload: unknown; reason?: string; source?: string; explicitConsent?: boolean; namespace?: string }): PendingKnowledgeItem {
    const result = this.db
      .prepare("INSERT INTO pending_knowledge_items (payload_json, reason, source, explicit_consent, namespace) VALUES (@payloadJson, @reason, @source, @explicitConsent, @namespace)")
      .run({ payloadJson: JSON.stringify(item.payload), reason: item.reason ?? null, source: item.source ?? "manual", explicitConsent: item.explicitConsent ? 1 : 0, namespace: item.namespace ?? "primary" });

    const pending = this.getPendingKnowledgeItem(Number(result.lastInsertRowid))!;
    this.addKnowledgeAuditEvent({ subjectType: "pending", subjectId: pending.id, eventType: "queued", actor: "system", channel: pending.source, reason: pending.reason, payloadSummary: summarizePendingKnowledgeAudit(pending) });
    return pending;
  }

  getPendingKnowledgeItem(id: number): PendingKnowledgeItem | undefined {
    const row = this.db.prepare("SELECT * FROM pending_knowledge_items WHERE id = ?").get(id) as PendingKnowledgeItemRow | undefined;
    return row ? mapPendingKnowledgeItemRow(row) : undefined;
  }

  listPendingKnowledgeItems(limit = 20): PendingKnowledgeItem[] {
    const rows = this.db.prepare("SELECT * FROM pending_knowledge_items ORDER BY created_at DESC LIMIT ?").all(limit) as PendingKnowledgeItemRow[];
    return rows.map(mapPendingKnowledgeItemRow);
  }

  approvePendingKnowledgeItem(id: number): PendingKnowledgeApprovalResult | undefined {
    const pending = this.getPendingKnowledgeItem(id);
    if (!pending) {
      return undefined;
    }

    const policy = evaluateKnowledgePayload(pending.payload, "normal", pending.explicitConsent);
    if (policy.decision === "never" || policy.sensitivity === "secret") {
      const explanation = explainKnowledgePolicyDiagnostics(policy.diagnostics);
      const blocked: BlockedPendingKnowledgeItem = {
        status: "blocked",
        reason: policy.reason,
        ...(policy.diagnostics ? { diagnostics: policy.diagnostics } : {}),
        ...(explanation ? { explanation } : {}),
      };
      this.addKnowledgeAuditEvent({ subjectType: "pending", subjectId: id, eventType: "blocked", actor: "system", channel: pending.source, reason: blocked.explanation ?? blocked.reason, payloadSummary: summarizePendingKnowledgeAudit(pending) });
      return blocked;
    }

    const parsed = parsePendingKnowledgePayload(pending.payload);
    const transaction = this.db.transaction(() => {
      const entities: KnowledgeEntity[] = [];
      const relations: KnowledgeRelation[] = [];
      const entityIdsByKey = new Map<string, number>();

      for (const entity of parsed.entities) {
        const stored = this.upsertKnowledgeEntity(entity);
        entities.push(stored);
        entityIdsByKey.set(knowledgeEntityKey(stored.canonicalName, stored.kind), stored.id);
      }

      for (const relation of parsed.relations) {
        const sourceEntityId = relation.sourceEntityId ?? resolvePendingKnowledgeEntityId(this, entityIdsByKey, relation.sourceName, relation.sourceKind);
        const targetEntityId = relation.targetEntityId ?? resolvePendingKnowledgeEntityId(this, entityIdsByKey, relation.targetName, relation.targetKind);
        if (!sourceEntityId || !targetEntityId) {
          continue;
        }
        const stored = this.upsertKnowledgeRelation({ ...relation, sourceEntityId, targetEntityId });
        if (stored) {
          relations.push(stored);
        }
      }

      this.db.prepare("DELETE FROM pending_knowledge_items WHERE id = ?").run(id);
      this.addKnowledgeAuditEvent({ subjectType: "pending", subjectId: id, eventType: "approved", actor: "owner", channel: pending.source, reason: pending.reason, payloadSummary: summarizePendingKnowledgeAudit(pending) });
      for (const entity of entities) {
        this.addKnowledgeAuditEvent({ subjectType: "entity", subjectId: entity.id, eventType: "approved", actor: "owner", channel: pending.source, reason: pending.reason, payloadSummary: summarizeKnowledgeEntityAudit(entity) });
      }
      for (const relation of relations) {
        this.addKnowledgeAuditEvent({ subjectType: "relation", subjectId: relation.id, eventType: "approved", actor: "owner", channel: pending.source, reason: pending.reason, payloadSummary: summarizeKnowledgeRelationAudit(relation) });
      }
      return { status: "approved" as const, entities, relations };
    });

    return transaction();
  }

  sanitizePendingKnowledgeItem(id: number): PendingKnowledgeSanitizeResult | undefined {
    const pending = this.getPendingKnowledgeItem(id);
    if (!pending) {
      return undefined;
    }

    const previousPolicy = evaluateKnowledgePayload(pending.payload, "normal", pending.explicitConsent);
    const sanitizedPayload = sanitizeKnowledgePayload(pending.payload);
    const policy = evaluateKnowledgePayload(sanitizedPayload, "normal", pending.explicitConsent);
    if (policy.decision === "never" || policy.sensitivity === "secret") {
      const explanation = explainKnowledgePolicyDiagnostics(policy.diagnostics);
      const blocked: BlockedPendingKnowledgeItem = {
        status: "blocked",
        reason: policy.reason,
        ...(policy.diagnostics ? { diagnostics: policy.diagnostics } : {}),
        ...(explanation ? { explanation } : {}),
      };
      this.addKnowledgeAuditEvent({ subjectType: "pending", subjectId: id, eventType: "sanitize_blocked", actor: "owner", channel: pending.source, reason: blocked.explanation ?? blocked.reason, payloadSummary: summarizePendingKnowledgeAudit(pending) });
      return blocked;
    }

    const reason = appendPendingKnowledgeReason(pending.reason, "Sanitized by owner: removed secret-like values from the payload.");
    this.db.prepare("UPDATE pending_knowledge_items SET payload_json = ?, reason = ? WHERE id = ?").run(JSON.stringify(sanitizedPayload), reason, id);
    this.addKnowledgeAuditEvent({ subjectType: "pending", subjectId: id, eventType: "sanitized", actor: "owner", channel: pending.source, reason, payloadSummary: summarizePendingKnowledgeAudit({ ...pending, payload: sanitizedPayload, reason }) });
    return {
      status: "sanitized",
      item: this.getPendingKnowledgeItem(id)!,
      ...(previousPolicy.diagnostics ? { previousDiagnostics: previousPolicy.diagnostics } : {}),
    };
  }

  rejectPendingKnowledgeItem(id: number): boolean {
    const pending = this.getPendingKnowledgeItem(id);
    const rejected = this.db.prepare("DELETE FROM pending_knowledge_items WHERE id = ?").run(id).changes > 0;
    if (rejected && pending) {
      this.addKnowledgeAuditEvent({ subjectType: "pending", subjectId: id, eventType: "rejected", actor: "owner", channel: pending.source, reason: pending.reason, payloadSummary: summarizePendingKnowledgeAudit(pending) });
    }
    return rejected;
  }

  getKnowledgeEntity(id: number): KnowledgeEntity | undefined {
    const row = this.db.prepare("SELECT * FROM knowledge_entities WHERE id = ? AND status = 'active'").get(id) as KnowledgeEntityRow | undefined;
    return row ? mapKnowledgeEntityRow(row) : undefined;
  }

  getKnowledgeRelation(id: number): KnowledgeRelation | undefined {
    const row = this.db.prepare("SELECT * FROM knowledge_relations WHERE id = ? AND status = 'active'").get(id) as KnowledgeRelationRow | undefined;
    return row ? mapKnowledgeRelationRow(row) : undefined;
  }

  listKnowledgeEntities(options: { kind?: KnowledgeEntityKind; limit?: number; namespace?: string } = {}): KnowledgeEntity[] {
    const rows = options.kind && options.namespace
      ? (this.db.prepare("SELECT * FROM knowledge_entities WHERE status = 'active' AND kind = @kind AND namespace = @namespace ORDER BY updated_at DESC, id DESC LIMIT @limit").all({ kind: options.kind, namespace: options.namespace, limit: options.limit ?? 100 }) as KnowledgeEntityRow[])
      : options.kind
        ? (this.db.prepare("SELECT * FROM knowledge_entities WHERE status = 'active' AND kind = ? ORDER BY updated_at DESC, id DESC LIMIT ?").all(options.kind, options.limit ?? 100) as KnowledgeEntityRow[])
        : options.namespace
          ? (this.db.prepare("SELECT * FROM knowledge_entities WHERE status = 'active' AND namespace = @namespace ORDER BY updated_at DESC, id DESC LIMIT @limit").all({ namespace: options.namespace, limit: options.limit ?? 100 }) as KnowledgeEntityRow[])
          : (this.db.prepare("SELECT * FROM knowledge_entities WHERE status = 'active' ORDER BY updated_at DESC, id DESC LIMIT ?").all(options.limit ?? 100) as KnowledgeEntityRow[]);
    return rows.map(mapKnowledgeEntityRow);
  }

  listKnowledgeRelations(limit = 100, namespace?: string): KnowledgeRelationWithEntities[] {
    const rows = this.db
      .prepare(`
        SELECT relations.*,
               source.id AS source_id, source.canonical_name AS source_canonical_name, source.kind AS source_kind, source.aliases_json AS source_aliases_json,
               source.sensitivity AS source_sensitivity, source.scope AS source_scope, source.namespace AS source_namespace, source.confidence AS source_confidence, source.source_memory_id AS source_source_memory_id,
               source.source_message_id AS source_source_message_id, source.status AS source_status, source.created_at AS source_created_at, source.updated_at AS source_updated_at,
               target.id AS target_id, target.canonical_name AS target_canonical_name, target.kind AS target_kind, target.aliases_json AS target_aliases_json,
               target.sensitivity AS target_sensitivity, target.scope AS target_scope, target.namespace AS target_namespace, target.confidence AS target_confidence, target.source_memory_id AS target_source_memory_id,
               target.source_message_id AS target_source_message_id, target.status AS target_status, target.created_at AS target_created_at, target.updated_at AS target_updated_at
        FROM knowledge_relations relations
        JOIN knowledge_entities source ON source.id = relations.source_entity_id
        JOIN knowledge_entities target ON target.id = relations.target_entity_id
        WHERE relations.status = 'active' AND source.status = 'active' AND target.status = 'active'
          AND (@namespace IS NULL OR (source.namespace = @namespace AND target.namespace = @namespace))
        ORDER BY relations.updated_at DESC, relations.id DESC
        LIMIT @limit
      `)
      .all({ limit, namespace: namespace ?? null }) as KnowledgeRelationJoinRow[];
    return rows.map(mapKnowledgeRelationJoinRow);
  }

  getKnowledgeEntityNeighborhood(id: number, limit = 20): KnowledgeRelationWithEntities[] {
    const rows = this.db
      .prepare(`
        SELECT relations.*,
               source.id AS source_id, source.canonical_name AS source_canonical_name, source.kind AS source_kind, source.aliases_json AS source_aliases_json,
               source.sensitivity AS source_sensitivity, source.scope AS source_scope, source.namespace AS source_namespace, source.confidence AS source_confidence, source.source_memory_id AS source_source_memory_id,
               source.source_message_id AS source_source_message_id, source.status AS source_status, source.created_at AS source_created_at, source.updated_at AS source_updated_at,
               target.id AS target_id, target.canonical_name AS target_canonical_name, target.kind AS target_kind, target.aliases_json AS target_aliases_json,
               target.sensitivity AS target_sensitivity, target.scope AS target_scope, target.namespace AS target_namespace, target.confidence AS target_confidence, target.source_memory_id AS target_source_memory_id,
               target.source_message_id AS target_source_message_id, target.status AS target_status, target.created_at AS target_created_at, target.updated_at AS target_updated_at
        FROM knowledge_relations relations
        JOIN knowledge_entities source ON source.id = relations.source_entity_id
        JOIN knowledge_entities target ON target.id = relations.target_entity_id
        WHERE relations.status = 'active' AND source.status = 'active' AND target.status = 'active'
          AND (relations.source_entity_id = @id OR relations.target_entity_id = @id)
        ORDER BY relations.confidence DESC, relations.updated_at DESC
        LIMIT @limit
      `)
      .all({ id, limit }) as KnowledgeRelationJoinRow[];
    return rows.map(mapKnowledgeRelationJoinRow);
  }

  searchKnowledgeGraph(query: string, limit = 20, namespace = "primary"): KnowledgeGraphSearchResult {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return { query, entities: [], relations: [] };
    }

    const like = `%${escapeLike(normalizedQuery)}%`;
    const entities = (this.db
      .prepare(`
        SELECT * FROM knowledge_entities
        WHERE status = 'active'
          AND namespace = @namespace
          AND (canonical_name LIKE @query ESCAPE '\\' OR kind LIKE @query ESCAPE '\\' OR aliases_json LIKE @query ESCAPE '\\')
        ORDER BY confidence DESC, updated_at DESC
        LIMIT @limit
      `)
      .all({ query: like, limit, namespace }) as KnowledgeEntityRow[]).map(mapKnowledgeEntityRow);

    const relations = (this.db
      .prepare(`
        SELECT relations.*,
               source.id AS source_id, source.canonical_name AS source_canonical_name, source.kind AS source_kind, source.aliases_json AS source_aliases_json,
               source.sensitivity AS source_sensitivity, source.scope AS source_scope, source.namespace AS source_namespace, source.confidence AS source_confidence, source.source_memory_id AS source_source_memory_id,
               source.source_message_id AS source_source_message_id, source.status AS source_status, source.created_at AS source_created_at, source.updated_at AS source_updated_at,
               target.id AS target_id, target.canonical_name AS target_canonical_name, target.kind AS target_kind, target.aliases_json AS target_aliases_json,
               target.sensitivity AS target_sensitivity, target.scope AS target_scope, target.namespace AS target_namespace, target.confidence AS target_confidence, target.source_memory_id AS target_source_memory_id,
               target.source_message_id AS target_source_message_id, target.status AS target_status, target.created_at AS target_created_at, target.updated_at AS target_updated_at
        FROM knowledge_relations relations
        JOIN knowledge_entities source ON source.id = relations.source_entity_id
        JOIN knowledge_entities target ON target.id = relations.target_entity_id
        WHERE relations.status = 'active' AND source.status = 'active' AND target.status = 'active'
          AND source.namespace = @namespace AND target.namespace = @namespace
          AND (relations.relation_type LIKE @query ESCAPE '\\' OR relations.evidence LIKE @query ESCAPE '\\' OR source.canonical_name LIKE @query ESCAPE '\\' OR target.canonical_name LIKE @query ESCAPE '\\')
        ORDER BY relations.confidence DESC, relations.updated_at DESC
        LIMIT @limit
      `)
      .all({ query: like, limit, namespace }) as KnowledgeRelationJoinRow[]).map(mapKnowledgeRelationJoinRow);

    return { query: normalizedQuery, entities, relations };
  }

  forgetKnowledgeEntity(id: number): boolean {
    const current = this.getKnowledgeEntity(id);
    const result = this.db.prepare("UPDATE knowledge_entities SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'").run(id);
    if (result.changes > 0 && current) {
      this.addKnowledgeAuditEvent({ subjectType: "entity", subjectId: id, eventType: "forgotten", actor: "owner", reason: "Knowledge entity was forgotten.", payloadSummary: summarizeKnowledgeEntityAudit(current) });
    }
    return result.changes > 0;
  }

  forgetKnowledgeRelation(id: number): boolean {
    const current = this.getKnowledgeRelation(id);
    const result = this.db.prepare("UPDATE knowledge_relations SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'").run(id);
    if (result.changes > 0 && current) {
      this.addKnowledgeAuditEvent({ subjectType: "relation", subjectId: id, eventType: "forgotten", actor: "owner", reason: "Knowledge relation was forgotten.", payloadSummary: summarizeKnowledgeRelationAudit(current) });
    }
    return result.changes > 0;
  }

  updateKnowledgeRelation(id: number, update: KnowledgeRelationUpdate): KnowledgeRelation | undefined {
    const current = this.getKnowledgeRelation(id);
    if (!current) {
      return undefined;
    }

    const hasEvidence = Object.prototype.hasOwnProperty.call(update, "evidence");
    const hasSensitivity = update.sensitivity !== undefined;
    const hasScope = update.scope !== undefined;
    const hasConfidence = update.confidence !== undefined;
    if (!hasEvidence && !hasSensitivity && !hasScope && !hasConfidence) {
      return undefined;
    }

    this.db
      .prepare(`
        UPDATE knowledge_relations
        SET evidence = @evidence,
            sensitivity = @sensitivity,
            scope = @scope,
            confidence = @confidence,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = @id AND status = 'active'
      `)
      .run({
        id,
        evidence: hasEvidence ? update.evidence?.trim() || null : current.evidence ?? null,
        sensitivity: update.sensitivity ?? current.sensitivity,
        scope: update.scope ?? current.scope,
        confidence: hasConfidence ? clampKnowledgeConfidence(update.confidence) : current.confidence,
      });

    const updated = this.getKnowledgeRelation(id);
    if (updated) {
      this.addKnowledgeAuditEvent({ subjectType: "relation", subjectId: id, eventType: "updated", actor: "owner", reason: "Knowledge relation metadata was updated.", payloadSummary: summarizeKnowledgeRelationAudit(updated) });
    }
    return updated;
  }

  mergeKnowledgeEntities(primaryId: number, duplicateId: number): KnowledgeEntityMergeResult | undefined {
    if (primaryId === duplicateId) {
      return undefined;
    }

    const primary = this.getKnowledgeEntity(primaryId);
    const duplicate = this.getKnowledgeEntity(duplicateId);
    if (!primary || !duplicate || primary.kind !== duplicate.kind) {
      return undefined;
    }

    const transaction = this.db.transaction(() => {
      const updatedPrimary = this.upsertKnowledgeEntity({
        canonicalName: primary.canonicalName,
        kind: primary.kind,
        aliases: [...primary.aliases, duplicate.canonicalName, ...duplicate.aliases],
        sensitivity: maxKnowledgeSensitivity(primary.sensitivity, duplicate.sensitivity),
        scope: primary.scope,
        confidence: Math.max(primary.confidence, duplicate.confidence),
        sourceMemoryId: primary.sourceMemoryId ?? duplicate.sourceMemoryId,
        sourceMessageId: primary.sourceMessageId ?? duplicate.sourceMessageId,
      });

      const duplicateRelations = this.getKnowledgeEntityNeighborhood(duplicateId, 10_000);
      let redirectedRelations = 0;
      let mergedRelations = 0;
      for (const relation of duplicateRelations) {
        const sourceEntityId = relation.sourceEntityId === duplicateId ? primaryId : relation.sourceEntityId;
        const targetEntityId = relation.targetEntityId === duplicateId ? primaryId : relation.targetEntityId;
        if (sourceEntityId === targetEntityId) {
          if (this.forgetKnowledgeRelation(relation.id)) {
            mergedRelations += 1;
          }
          continue;
        }

        const stored = this.upsertKnowledgeRelation({
          sourceEntityId,
          relationType: relation.relationType,
          targetEntityId,
          evidence: relation.evidence,
          sensitivity: relation.sensitivity,
          scope: relation.scope,
          confidence: relation.confidence,
          sourceMemoryId: relation.sourceMemoryId,
          sourceMessageId: relation.sourceMessageId,
        });
        if (this.forgetKnowledgeRelation(relation.id)) {
          redirectedRelations += stored?.id === relation.id ? 0 : 1;
          if (stored && stored.id !== relation.id) {
            mergedRelations += 1;
          }
        }
      }

      this.forgetKnowledgeEntity(duplicateId);
      this.addKnowledgeAuditEvent({ subjectType: "entity", subjectId: primaryId, eventType: "merged", actor: "owner", reason: `Merged duplicate entity #${duplicateId} into #${primaryId}.`, payloadSummary: `redirected ${redirectedRelations}, merged ${mergedRelations}` });
      this.addKnowledgeAuditEvent({ subjectType: "entity", subjectId: duplicateId, eventType: "merged_into", actor: "owner", reason: `Merged into entity #${primaryId}.`, payloadSummary: summarizeKnowledgeEntityAudit(duplicate) });
      return { primary: updatedPrimary, duplicate, redirectedRelations, mergedRelations };
    });

    return transaction();
  }

  getKnowledgeGraphStats(): { entities: number; relations: number; pending: number } {
    const entities = this.db.prepare("SELECT COUNT(*) AS count FROM knowledge_entities WHERE status = 'active'").get() as { count: number };
    const relations = this.db.prepare("SELECT COUNT(*) AS count FROM knowledge_relations WHERE status = 'active'").get() as { count: number };
    const pending = this.db.prepare("SELECT COUNT(*) AS count FROM pending_knowledge_items").get() as { count: number };
    return { entities: entities.count, relations: relations.count, pending: pending.count };
  }

  listKnowledgeAuditEvents(subjectType: KnowledgeAuditSubjectType, subjectId: number, limit = 20): KnowledgeAuditEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM knowledge_audit_events WHERE subject_type = ? AND subject_id = ? ORDER BY id DESC LIMIT ?")
      .all(subjectType, subjectId, limit) as KnowledgeAuditEventRow[];
    return rows.map(mapKnowledgeAuditEventRow);
  }

  private addKnowledgeAuditEvent(event: NewKnowledgeAuditEvent): KnowledgeAuditEvent {
    const result = this.db
      .prepare("INSERT INTO knowledge_audit_events (subject_type, subject_id, event_type, actor, channel, reason, payload_summary) VALUES (@subjectType, @subjectId, @eventType, @actor, @channel, @reason, @payloadSummary)")
      .run({ subjectType: event.subjectType, subjectId: event.subjectId, eventType: event.eventType, actor: event.actor ?? "system", channel: event.channel ?? null, reason: event.reason ?? null, payloadSummary: event.payloadSummary ?? null });
    const row = this.db.prepare("SELECT * FROM knowledge_audit_events WHERE id = ?").get(Number(result.lastInsertRowid)) as KnowledgeAuditEventRow;
    return mapKnowledgeAuditEventRow(row);
  }

  private getKnowledgeEntityByName(canonicalName: string, kind: KnowledgeEntityKind, namespace = "primary"): KnowledgeEntity | undefined {
    const row = this.db
      .prepare("SELECT * FROM knowledge_entities WHERE canonical_name = ? AND kind = ? AND namespace = ?")
      .get(canonicalName, kind, namespace) as KnowledgeEntityRow | undefined;
    return row ? mapKnowledgeEntityRow(row) : undefined;
  }

  private getKnowledgeRelationByTriple(sourceEntityId: number, relationType: string, targetEntityId: number): KnowledgeRelation | undefined {
    const row = this.db
      .prepare("SELECT * FROM knowledge_relations WHERE source_entity_id = ? AND relation_type = ? AND target_entity_id = ?")
      .get(sourceEntityId, relationType, targetEntityId) as KnowledgeRelationRow | undefined;
    return row ? mapKnowledgeRelationRow(row) : undefined;
  }

  // --- UI chat sessions ---

  createUiChatSession(title = "New chat", agentId?: string): UiChatSession {
    const result = this.db.prepare("INSERT INTO ui_chat_sessions (title, agent_id) VALUES (?, ?)").run(title.trim() || "New chat", agentId?.trim() || null);
    return this.getUiChatSession(Number(result.lastInsertRowid));
  }

  listUiChatSessions(limit = 30): UiChatSession[] {
    const rows = this.db
      .prepare(`
        SELECT ui_chat_sessions.*, COUNT(DISTINCT ui_chat_messages.id) AS message_count, GROUP_CONCAT(DISTINCT ui_chat_events.event_type) AS event_types
        FROM ui_chat_sessions
        LEFT JOIN ui_chat_messages ON ui_chat_messages.session_id = ui_chat_sessions.id
        LEFT JOIN ui_chat_events ON ui_chat_events.session_id = ui_chat_sessions.id
        GROUP BY ui_chat_sessions.id
        ORDER BY ui_chat_sessions.pinned_at IS NULL ASC, ui_chat_sessions.pinned_at DESC, ui_chat_sessions.updated_at DESC, ui_chat_sessions.id DESC
        LIMIT ?
      `)
      .all(limit) as UiChatSessionRow[];

    return rows.map(mapUiChatSessionRow);
  }

  searchUiChatSessions(options: { query?: string; eventType?: string; limit?: number } = {}): UiChatSession[] {
    const query = options.query?.trim();
    const eventType = options.eventType?.trim();
    const rows = this.db
      .prepare(`
        SELECT ui_chat_sessions.*, COUNT(DISTINCT ui_chat_messages.id) AS message_count, GROUP_CONCAT(DISTINCT ui_chat_events.event_type) AS event_types
        FROM ui_chat_sessions
        LEFT JOIN ui_chat_messages ON ui_chat_messages.session_id = ui_chat_sessions.id
        LEFT JOIN ui_chat_events ON ui_chat_events.session_id = ui_chat_sessions.id
        WHERE (@query IS NULL OR ui_chat_sessions.title LIKE @query ESCAPE '\\' OR ui_chat_messages.content LIKE @query ESCAPE '\\')
          AND (@eventType IS NULL OR ui_chat_events.event_type = @eventType)
        GROUP BY ui_chat_sessions.id
        ORDER BY ui_chat_sessions.pinned_at IS NULL ASC, ui_chat_sessions.pinned_at DESC, ui_chat_sessions.updated_at DESC, ui_chat_sessions.id DESC
        LIMIT @limit
      `)
      .all({ query: query ? `%${escapeLike(query)}%` : null, eventType: eventType || null, limit: options.limit ?? 30 }) as UiChatSessionRow[];

    return rows.map(mapUiChatSessionRow);
  }

  getUiChatSession(id: number): UiChatSession {
    const row = this.db
      .prepare(`
        SELECT ui_chat_sessions.*, COUNT(DISTINCT ui_chat_messages.id) AS message_count, GROUP_CONCAT(DISTINCT ui_chat_events.event_type) AS event_types
        FROM ui_chat_sessions
        LEFT JOIN ui_chat_messages ON ui_chat_messages.session_id = ui_chat_sessions.id
        LEFT JOIN ui_chat_events ON ui_chat_events.session_id = ui_chat_sessions.id
        WHERE ui_chat_sessions.id = ?
        GROUP BY ui_chat_sessions.id
      `)
      .get(id) as UiChatSessionRow | undefined;

    if (!row) {
      throw new Error(`UI chat session not found: ${id}`);
    }

    return mapUiChatSessionRow(row);
  }

  updateUiChatSessionTitle(id: number, title: string): UiChatSession {
    this.db.prepare("UPDATE ui_chat_sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(title.trim() || "New chat", id);
    return this.getUiChatSession(id);
  }

  updateUiChatSessionPinned(id: number, pinned: boolean): UiChatSession {
    this.db.prepare("UPDATE ui_chat_sessions SET pinned_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(pinned ? new Date().toISOString() : null, id);
    return this.getUiChatSession(id);
  }

  updateUiChatSessionPreferences(id: number, preferences: { toolsEnabled?: boolean; memoryEnabled?: boolean; providerModelRef?: string | null }): UiChatSession {
    const current = this.getUiChatSession(id);
    this.db.prepare("UPDATE ui_chat_sessions SET tools_enabled = ?, memory_enabled = ?, provider_model_ref = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run((preferences.toolsEnabled ?? current.toolsEnabled) ? 1 : 0, (preferences.memoryEnabled ?? current.memoryEnabled) ? 1 : 0, preferences.providerModelRef === undefined ? current.providerModelRef ?? null : preferences.providerModelRef || null, id);
    return this.getUiChatSession(id);
  }

  deleteUiChatSession(id: number): boolean {
    const result = this.db.prepare("DELETE FROM ui_chat_sessions WHERE id = ?").run(id);
    return result.changes > 0;
  }

  addUiChatMessage(sessionId: number, role: "user" | "assistant", content: string, runId?: number, metadataJson?: string): UiChatMessage {
    const transaction = this.db.transaction(() => {
      const result = this.db
        .prepare("INSERT INTO ui_chat_messages (session_id, run_id, role, content, metadata_json) VALUES (?, ?, ?, ?, ?)")
        .run(sessionId, runId ?? null, role, content, metadataJson ?? null);
      this.db.prepare("UPDATE ui_chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(sessionId);
      return Number(result.lastInsertRowid);
    });

    return this.getUiChatMessage(transaction());
  }

  createUiChatRun(sessionId: number, options: { model?: string; providerModelRef?: string; userMessageId?: number; metadataJson?: string } = {}): UiChatRun {
    const result = this.db
      .prepare("INSERT INTO ui_chat_runs (session_id, status, model, provider_model_ref, user_message_id, metadata_json) VALUES (?, 'running', ?, ?, ?, ?)")
      .run(sessionId, options.model ?? null, options.providerModelRef ?? null, options.userMessageId ?? null, options.metadataJson ?? null);
    return this.getUiChatRun(Number(result.lastInsertRowid));
  }

  finishUiChatRun(id: number, options: { status: string; model?: string; assistantMessageId?: number; metadataJson?: string }): UiChatRun {
    this.db.prepare("UPDATE ui_chat_runs SET status = ?, model = COALESCE(?, model), assistant_message_id = COALESCE(?, assistant_message_id), metadata_json = COALESCE(?, metadata_json), finished_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(options.status, options.model ?? null, options.assistantMessageId ?? null, options.metadataJson ?? null, id);
    return this.getUiChatRun(id);
  }

  listUiChatRuns(sessionId: number, limit = 40): UiChatRun[] {
    const rows = this.db.prepare("SELECT * FROM ui_chat_runs WHERE session_id = ? ORDER BY id DESC LIMIT ?").all(sessionId, limit) as UiChatRunRow[];
    return rows.reverse().map(mapUiChatRunRow);
  }

  listUiChatMessages(sessionId: number, limit = 80): UiChatMessage[] {
    const rows = this.db
      .prepare("SELECT * FROM ui_chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?")
      .all(sessionId, limit) as UiChatMessageRow[];

    return rows.reverse().map(mapUiChatMessageRow);
  }

  deleteUiChatMessagesAfter(sessionId: number, messageId: number): number {
    const result = this.db.prepare("DELETE FROM ui_chat_messages WHERE session_id = ? AND id > ?").run(sessionId, messageId);
    if (result.changes > 0) {
      this.db.prepare("UPDATE ui_chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(sessionId);
    }
    return result.changes;
  }

  forkUiChatSession(sessionId: number, messageId: number, title?: string): UiChatSession {
    const source = this.getUiChatSession(sessionId);
    const messages = this.listUiChatMessages(source.id).filter((message) => message.id <= messageId);
    if (!messages.some((message) => message.id === messageId)) {
      throw new Error(`UI chat message not found in session ${sessionId}: ${messageId}`);
    }

    const transaction = this.db.transaction(() => {
      const fork = this.createUiChatSession(title ?? `${source.title} fork`, source.agentId);
      for (const message of messages) {
        this.addUiChatMessage(fork.id, message.role, message.content, undefined, message.metadataJson);
      }
      this.addUiChatEvent(fork.id, "fork", "Forked chat session", JSON.stringify({ sourceSessionId: source.id, sourceMessageId: messageId }));
      return this.getUiChatSession(fork.id);
    });

    return transaction();
  }

  addUiChatEvent(sessionId: number, eventType: string, label?: string, payloadJson?: string, runId?: number): UiChatEvent {
    const result = this.db
      .prepare("INSERT INTO ui_chat_events (session_id, run_id, event_type, label, payload_json) VALUES (?, ?, ?, ?, ?)")
      .run(sessionId, runId ?? null, eventType, label ?? null, payloadJson ?? null);
    return this.getUiChatEvent(Number(result.lastInsertRowid));
  }

  listUiChatEvents(sessionId: number, limit = 80): UiChatEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM ui_chat_events WHERE session_id = ? ORDER BY id DESC LIMIT ?")
      .all(sessionId, limit) as UiChatEventRow[];

    return rows.reverse().map(mapUiChatEventRow);
  }

  listUiChatBranchLinks(): UiChatBranchLink[] {
    const rows = this.db
      .prepare(`
        SELECT ui_chat_events.session_id, ui_chat_sessions.title, ui_chat_events.payload_json
        FROM ui_chat_events
        INNER JOIN ui_chat_sessions ON ui_chat_sessions.id = ui_chat_events.session_id
        WHERE ui_chat_events.event_type = 'fork' AND ui_chat_events.payload_json IS NOT NULL
        ORDER BY ui_chat_events.id ASC
      `)
      .all() as Array<{ session_id: number; title: string; payload_json: string }>;
    return rows.flatMap((row) => {
      try {
        const payload = JSON.parse(row.payload_json) as { sourceSessionId?: unknown; sourceMessageId?: unknown };
        if (typeof payload.sourceSessionId !== "number" || typeof payload.sourceMessageId !== "number") return [];
        return [{ sessionId: row.session_id, title: row.title, sourceSessionId: payload.sourceSessionId, sourceMessageId: payload.sourceMessageId }];
      } catch {
        return [];
      }
    });
  }

  // --- Cron schedule CRUD ---

  addCronSchedule(schedule: NewCronSchedule): CronSchedule {
    const result = this.db
      .prepare(`
        INSERT INTO cron_schedules (name, schedule_type, schedule_value, prompt, channel, enabled, next_run_at)
        VALUES (@name, @scheduleType, @scheduleValue, @prompt, @channel, @enabled, @nextRunAt)
      `)
      .run({
        name: schedule.name,
        scheduleType: schedule.scheduleType,
        scheduleValue: schedule.scheduleValue,
        prompt: schedule.prompt,
        channel: schedule.channel ?? null,
        enabled: schedule.enabled !== false ? 1 : 0,
        nextRunAt: schedule.nextRunAt,
      });

    return this.getCronSchedule(Number(result.lastInsertRowid));
  }

  getCronSchedule(id: number): CronSchedule {
    const row = this.db.prepare("SELECT * FROM cron_schedules WHERE id = ?").get(id) as CronScheduleRow | undefined;

    if (!row) {
      throw new Error(`Cron schedule not found: ${id}`);
    }

    return mapCronScheduleRow(row);
  }

  listCronSchedules(limit = 50): CronSchedule[] {
    const rows = this.db.prepare("SELECT * FROM cron_schedules ORDER BY next_run_at ASC LIMIT ?").all(limit) as CronScheduleRow[];

    return rows.map(mapCronScheduleRow);
  }

  listEnabledCronSchedules(): CronSchedule[] {
    const rows = this.db.prepare("SELECT * FROM cron_schedules WHERE enabled = 1 ORDER BY next_run_at ASC").all() as CronScheduleRow[];

    return rows.map(mapCronScheduleRow);
  }

  listDueCronJobs(now: string): CronSchedule[] {
    const rows = this.db
      .prepare("SELECT * FROM cron_schedules WHERE enabled = 1 AND next_run_at != '' AND next_run_at <= ? ORDER BY next_run_at ASC")
      .all(now) as CronScheduleRow[];

    return rows.map(mapCronScheduleRow);
  }

  updateCronNextRun(id: number, nextRunAt: string): void {
    this.db.prepare("UPDATE cron_schedules SET next_run_at = ? WHERE id = ?").run(nextRunAt, id);
  }

  updateCronRunResult(id: number, result: string, error?: string): void {
    this.db
      .prepare(`
        UPDATE cron_schedules
        SET last_run_at = datetime('now'), last_result = ?, last_error = ?, run_count = run_count + 1
        WHERE id = ?
      `)
      .run(result, error ?? null, id);
  }

  toggleCronSchedule(id: number, enabled: boolean): CronSchedule {
    this.db.prepare("UPDATE cron_schedules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
    return this.getCronSchedule(id);
  }

  updateCronSchedule(id: number, schedule: NewCronSchedule): CronSchedule {
    this.db
      .prepare(`
        UPDATE cron_schedules
        SET name = @name,
            schedule_type = @scheduleType,
            schedule_value = @scheduleValue,
            prompt = @prompt,
            channel = @channel,
            enabled = @enabled,
            next_run_at = @nextRunAt
        WHERE id = @id
      `)
      .run({
        id,
        name: schedule.name,
        scheduleType: schedule.scheduleType,
        scheduleValue: schedule.scheduleValue,
        prompt: schedule.prompt,
        channel: schedule.channel ?? null,
        enabled: schedule.enabled !== false ? 1 : 0,
        nextRunAt: schedule.nextRunAt,
      });
    return this.getCronSchedule(id);
  }

  removeCronSchedule(id: number): boolean {
    const result = this.db.prepare("DELETE FROM cron_schedules WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // --- Cron log ---

  createCronLog(scheduleId: number): CronLog {
    const result = this.db.prepare("INSERT INTO cron_logs (schedule_id) VALUES (?)").run(scheduleId);
    return this.getCronLog(Number(result.lastInsertRowid));
  }

  getCronLog(id: number): CronLog {
    const row = this.db.prepare("SELECT * FROM cron_logs WHERE id = ?").get(id) as CronLogRow | undefined;

    if (!row) {
      throw new Error(`Cron log not found: ${id}`);
    }

    return mapCronLogRow(row);
  }

  finishCronLog(id: number, result: string, output?: string, error?: string): void {
    this.db
      .prepare("UPDATE cron_logs SET finished_at = datetime('now'), result = ?, output = ?, error = ? WHERE id = ?")
      .run(result, output ?? null, error ?? null, id);
  }

  listCronLogs(scheduleId?: number, limit = 20): CronLog[] {
    if (scheduleId !== undefined) {
      const rows = this.db
        .prepare("SELECT * FROM cron_logs WHERE schedule_id = ? ORDER BY id DESC LIMIT ?")
        .all(scheduleId, limit) as CronLogRow[];
      return rows.map(mapCronLogRow);
    }

    const rows = this.db.prepare("SELECT * FROM cron_logs ORDER BY id DESC LIMIT ?").all(limit) as CronLogRow[];
    return rows.map(mapCronLogRow);
  }

  countActiveCronSchedules(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM cron_schedules WHERE enabled = 1").get() as { count: number };
    return row.count;
  }

  pruneOldCronLogs(maxAgeDays = 30): number {
    const result = this.db
      .prepare(`DELETE FROM cron_logs WHERE started_at < datetime('now', '-' || ? || ' days')`)
      .run(maxAgeDays);
    return result.changes;
  }

  getTableColumns(table: "memories" | "messages" | "pending_memories" | "memory_state"): string[] {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;

    return rows.map((row) => row.name);
  }

  clearAllData(): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM cron_logs").run();
      this.db.prepare("DELETE FROM cron_schedules").run();
      this.db.prepare("DELETE FROM pending_memories").run();
      this.db.prepare("DELETE FROM pending_action_approvals").run();
      this.db.prepare("DELETE FROM ui_chat_messages").run();
      this.db.prepare("DELETE FROM ui_chat_events").run();
      this.db.prepare("DELETE FROM ui_chat_sessions").run();
      this.db.prepare("DELETE FROM memories").run();
      this.db.prepare("DELETE FROM messages").run();
      if (hasMemorySearchIndex(this.db)) {
        this.db.prepare("DELETE FROM memory_search").run();
      }
    });

    transaction();
  }

  close(): void {
    this.db.close();
  }

  private getMessage(id: number): StoredMessage {
    const row = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;

    if (!row) {
      throw new Error(`Message not found after insert: ${id}`);
    }

    return mapMessageRow(row);
  }

  private getPendingMemory(id: number): PendingMemory | undefined {
    const row = this.db.prepare("SELECT * FROM pending_memories WHERE id = ?").get(id) as PendingMemoryRow | undefined;

    return row ? mapPendingMemoryRow(row) : undefined;
  }

  private getMemory(id: number): StoredMemory {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as MemoryRow | undefined;

    if (!row) {
      throw new Error(`Memory not found after insert: ${id}`);
    }

    return mapMemoryRow(row);
  }

  private getPendingActionApproval(id: number): PendingActionApproval | undefined {
    const row = this.db.prepare("SELECT * FROM pending_action_approvals WHERE id = ?").get(id) as PendingActionApprovalRow | undefined;

    return row ? mapPendingActionApprovalRow(row) : undefined;
  }

  private getUiChatMessage(id: number): UiChatMessage {
    const row = this.db.prepare("SELECT * FROM ui_chat_messages WHERE id = ?").get(id) as UiChatMessageRow | undefined;

    if (!row) {
      throw new Error(`UI chat message not found after insert: ${id}`);
    }

    return mapUiChatMessageRow(row);
  }

  private getUiChatEvent(id: number): UiChatEvent {
    const row = this.db.prepare("SELECT * FROM ui_chat_events WHERE id = ?").get(id) as UiChatEventRow | undefined;

    if (!row) {
      throw new Error(`UI chat event not found after insert: ${id}`);
    }

    return mapUiChatEventRow(row);
  }

  private getUiChatRun(id: number): UiChatRun {
    const row = this.db.prepare("SELECT * FROM ui_chat_runs WHERE id = ?").get(id) as UiChatRunRow | undefined;

    if (!row) {
      throw new Error(`UI chat run not found after insert: ${id}`);
    }

    return mapUiChatRunRow(row);
  }

  private decidePendingActionApproval(id: number, status: "approved" | "denied"): PendingActionApproval | undefined {
    this.expirePendingActionApprovals();
    const result = this.db
      .prepare("UPDATE pending_action_approvals SET status = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'")
      .run(status, id);

    return result.changes > 0 ? this.getPendingActionApproval(id) : undefined;
  }

  private upsertMemorySearchIndex(memory: StoredMemory): void {
    if (!hasMemorySearchIndex(this.db)) {
      return;
    }

    this.db.prepare("DELETE FROM memory_search WHERE memory_id = ?").run(memory.id);
    if (memory.status !== "active") {
      return;
    }

    this.db
      .prepare("INSERT INTO memory_search(memory_id, type, content) VALUES (?, ?, ?)")
      .run(memory.id, memory.type, memory.content);
  }

  private deleteMemorySearchIndex(id: number): void {
    if (!hasMemorySearchIndex(this.db)) {
      return;
    }

    this.db.prepare("DELETE FROM memory_search WHERE memory_id = ?").run(id);
  }
}

interface MessageRow {
  id: number;
  channel: string | null;
  user_id: string | null;
  role: StoredMessageRole;
  content: string;
  created_at: string;
}

interface ConversationSummaryRow {
  id: number;
  channel: string;
  user_id: string;
  content: string;
  summarized_message_id: number;
  updated_at: string;
}

interface UiChatSessionRow {
  id: number;
  title: string;
  agent_id?: string | null;
  pinned_at?: string | null;
  tools_enabled?: number | null;
  memory_enabled?: number | null;
  provider_model_ref?: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  event_types: string | null;
}

interface UiChatMessageRow {
  id: number;
  session_id: number;
  run_id: number | null;
  role: "user" | "assistant";
  content: string;
  metadata_json?: string | null;
  created_at: string;
}

interface UiChatEventRow {
  id: number;
  session_id: number;
  run_id: number | null;
  event_type: string;
  label: string | null;
  payload_json: string | null;
  created_at: string;
}

interface UiChatRunRow {
  id: number;
  session_id: number;
  status: string;
  model: string | null;
  provider_model_ref: string | null;
  user_message_id: number | null;
  assistant_message_id: number | null;
  metadata_json: string | null;
  started_at: string;
  finished_at: string | null;
}

interface PendingMemoryRow {
  id: number;
  type: string;
  content: string;
  reason: string | null;
  source: string | null;
  explicit_consent: number | null;
  namespace: string | null;
  created_at: string;
}

interface PendingActionApprovalRow {
  id: number;
  channel: string;
  user_id: string | null;
  category: string;
  action: string;
  target: string | null;
  reason: string | null;
  proposed_reason: string | null;
  payload_json: string | null;
  status: "pending" | "approved" | "denied" | "expired" | "executed";
  created_at: string;
  expires_at: string;
  decided_at: string | null;
}

interface MemoryRow {
  id: number;
  type: string;
  content: string;
  sensitivity: "normal" | "sensitive" | "secret";
  importance: number;
  status: string;
  source_message_id: string | null;
  source: string | null;
  explicit_consent: number | null;
  policy_reason: string | null;
  pinned: number | null;
  scope: string | null;
  namespace: string | null;
  confidence: number | null;
  expires_at: string | null;
  superseded_by: number | null;
  last_accessed_at: string | null;
  access_count: number | null;
  created_at: string;
  updated_at: string;
}

interface CronScheduleRow {
  id: number;
  name: string;
  schedule_type: CronScheduleType;
  schedule_value: string;
  prompt: string;
  channel: string | null;
  enabled: number;
  created_at: string;
  last_run_at: string | null;
  next_run_at: string;
  last_result: string | null;
  last_error: string | null;
  run_count: number;
}

interface CronLogRow {
  id: number;
  schedule_id: number;
  started_at: string;
  finished_at: string | null;
  result: string | null;
  output: string | null;
  error: string | null;
}

interface MemoryHygieneSnapshotRow {
  id: number;
  score: number;
  label: string;
  checked: number;
  delete_candidates: number;
  review_only: number;
  duplicate_groups: number;
  stale_memories: number;
  conflict_groups: number;
  source: string;
  created_at: string;
}

interface KnowledgeEntityRow {
  id: number;
  canonical_name: string;
  kind: KnowledgeEntityKind;
  aliases_json: string | null;
  sensitivity: KnowledgeSensitivity;
  scope: string | null;
  namespace: string | null;
  confidence: number | null;
  source_memory_id: number | null;
  source_message_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface KnowledgeRelationRow {
  id: number;
  source_entity_id: number;
  relation_type: string;
  target_entity_id: number;
  evidence: string | null;
  sensitivity: KnowledgeSensitivity;
  scope: string | null;
  namespace: string | null;
  confidence: number | null;
  source_memory_id: number | null;
  source_message_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface KnowledgeRelationJoinRow extends KnowledgeRelationRow {
  source_id: number;
  source_canonical_name: string;
  source_kind: KnowledgeEntityKind;
  source_aliases_json: string | null;
  source_sensitivity: KnowledgeSensitivity;
  source_scope: string | null;
  source_namespace: string | null;
  source_confidence: number | null;
  source_source_memory_id: number | null;
  source_source_message_id: string | null;
  source_status: string;
  source_created_at: string;
  source_updated_at: string;
  target_id: number;
  target_canonical_name: string;
  target_kind: KnowledgeEntityKind;
  target_aliases_json: string | null;
  target_namespace: string | null;
  target_sensitivity: KnowledgeSensitivity;
  target_scope: string | null;
  target_confidence: number | null;
  target_source_memory_id: number | null;
  target_source_message_id: string | null;
  target_status: string;
  target_created_at: string;
  target_updated_at: string;
}

interface PendingKnowledgeItemRow {
  id: number;
  payload_json: string;
  reason: string | null;
  source: string | null;
  explicit_consent: number | null;
  namespace: string | null;
  created_at: string;
}

interface KnowledgeAuditEventRow {
  id: number;
  subject_type: KnowledgeAuditSubjectType;
  subject_id: number;
  event_type: string;
  actor: string | null;
  channel: string | null;
  reason: string | null;
  payload_summary: string | null;
  created_at: string;
}

function mapMemoryRow(row: MemoryRow): StoredMemory {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    sensitivity: row.sensitivity,
    importance: row.importance,
    status: row.status,
    sourceMessageId: row.source_message_id ?? undefined,
    source: row.source ?? undefined,
    explicitConsent: row.explicit_consent === 1,
    policyReason: row.policy_reason ?? undefined,
    pinned: row.pinned === 1,
    scope: normalizeMemoryScope(row.scope),
    namespace: row.namespace ?? "primary",
    confidence: row.confidence ?? 1,
    expiresAt: row.expires_at ?? undefined,
    supersededBy: row.superseded_by ?? undefined,
    lastAccessedAt: row.last_accessed_at ?? undefined,
    accessCount: row.access_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function defaultMemoryScope(type: string): MemoryScope {
  return type === "project_context" ? "project" : "core";
}

function defaultExpiresAtForScope(scope: MemoryScope): string | null {
  if (scope !== "session") {
    return null;
  }

  return new Date(Date.now() + SESSION_MEMORY_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeMemoryScope(scope: string | null | undefined): MemoryScope {
  if (isMemoryScope(scope ?? undefined)) {
    return scope as MemoryScope;
  }

  return scope === "global" || scope === undefined || scope === null ? "core" : "project";
}

function mapCronScheduleRow(row: CronScheduleRow): CronSchedule {
  return {
    id: row.id,
    name: row.name,
    scheduleType: row.schedule_type,
    scheduleValue: row.schedule_value,
    prompt: row.prompt,
    channel: row.channel ?? undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    lastRunAt: row.last_run_at ?? undefined,
    nextRunAt: row.next_run_at,
    lastResult: row.last_result ?? undefined,
    lastError: row.last_error ?? undefined,
    runCount: row.run_count,
  };
}

function mapCronLogRow(row: CronLogRow): CronLog {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    result: row.result ?? undefined,
    output: row.output ?? undefined,
    error: row.error ?? undefined,
  };
}

function mapMemoryHygieneSnapshotRow(row: MemoryHygieneSnapshotRow): MemoryHygieneSnapshot {
  return {
    id: row.id,
    score: row.score,
    label: row.label,
    checked: row.checked,
    deleteCandidates: row.delete_candidates,
    reviewOnly: row.review_only,
    duplicateGroups: row.duplicate_groups,
    staleMemories: row.stale_memories,
    conflictGroups: row.conflict_groups,
    source: row.source,
    createdAt: row.created_at,
  };
}

function mapKnowledgeEntityRow(row: KnowledgeEntityRow): KnowledgeEntity {
  return {
    id: row.id,
    canonicalName: row.canonical_name,
    kind: row.kind,
    aliases: parseStringArrayJson(row.aliases_json),
    sensitivity: row.sensitivity,
    scope: normalizeMemoryScope(row.scope),
    namespace: row.namespace ?? "primary",
    confidence: row.confidence ?? 1,
    sourceMemoryId: row.source_memory_id ?? undefined,
    sourceMessageId: row.source_message_id ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapKnowledgeRelationRow(row: KnowledgeRelationRow): KnowledgeRelation {
  return {
    id: row.id,
    sourceEntityId: row.source_entity_id,
    relationType: row.relation_type,
    targetEntityId: row.target_entity_id,
    evidence: row.evidence ?? undefined,
    sensitivity: row.sensitivity,
    scope: normalizeMemoryScope(row.scope),
    namespace: row.namespace ?? "primary",
    confidence: row.confidence ?? 1,
    sourceMemoryId: row.source_memory_id ?? undefined,
    sourceMessageId: row.source_message_id ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapKnowledgeRelationJoinRow(row: KnowledgeRelationJoinRow): KnowledgeRelationWithEntities {
  return {
    ...mapKnowledgeRelationRow(row),
    sourceEntity: mapKnowledgeEntityRow({
      id: row.source_id,
      canonical_name: row.source_canonical_name,
      kind: row.source_kind,
      aliases_json: row.source_aliases_json,
      sensitivity: row.source_sensitivity,
      scope: row.source_scope,
      namespace: row.source_namespace,
      confidence: row.source_confidence,
      source_memory_id: row.source_source_memory_id,
      source_message_id: row.source_source_message_id,
      status: row.source_status,
      created_at: row.source_created_at,
      updated_at: row.source_updated_at,
    }),
    targetEntity: mapKnowledgeEntityRow({
      id: row.target_id,
      canonical_name: row.target_canonical_name,
      kind: row.target_kind,
      aliases_json: row.target_aliases_json,
      sensitivity: row.target_sensitivity,
      scope: row.target_scope,
      namespace: row.target_namespace,
      confidence: row.target_confidence,
      source_memory_id: row.target_source_memory_id,
      source_message_id: row.target_source_message_id,
      status: row.target_status,
      created_at: row.target_created_at,
      updated_at: row.target_updated_at,
    }),
  };
}

function mapPendingKnowledgeItemRow(row: PendingKnowledgeItemRow): PendingKnowledgeItem {
  return {
    id: row.id,
    payload: parseJsonValue(row.payload_json),
    reason: row.reason ?? undefined,
    source: row.source ?? undefined,
    explicitConsent: row.explicit_consent === 1,
    createdAt: row.created_at,
    namespace: row.namespace ?? "primary",
  };
}

function mapKnowledgeAuditEventRow(row: KnowledgeAuditEventRow): KnowledgeAuditEvent {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    eventType: row.event_type,
    actor: row.actor ?? undefined,
    channel: row.channel ?? undefined,
    reason: row.reason ?? undefined,
    payloadSummary: row.payload_summary ?? undefined,
    createdAt: row.created_at,
  };
}

function summarizeKnowledgeEntityAudit(entity: KnowledgeEntity): string {
  return `${entity.kind}:${entity.canonicalName} confidence ${entity.confidence}`;
}

function summarizeKnowledgeRelationAudit(relation: KnowledgeRelation): string {
  return `${relation.sourceEntityId} --${relation.relationType}--> ${relation.targetEntityId} confidence ${relation.confidence}`;
}

function summarizePendingKnowledgeAudit(item: PendingKnowledgeItem): string {
  const payload = JSON.stringify(item.payload);
  return payload.length > 220 ? `${payload.slice(0, 217)}...` : payload;
}

function mapPendingMemoryRow(row: PendingMemoryRow): PendingMemory {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    reason: row.reason ?? undefined,
    source: row.source ?? undefined,
    explicitConsent: row.explicit_consent === 1,
    createdAt: row.created_at,
    namespace: row.namespace ?? "primary",
  };
}

function mapPendingActionApprovalRow(row: PendingActionApprovalRow): PendingActionApproval {
  return {
    id: row.id,
    channel: row.channel,
    userId: row.user_id ?? undefined,
    category: row.category,
    action: row.action,
    target: row.target ?? undefined,
    reason: row.reason ?? undefined,
    proposedReason: row.proposed_reason ?? undefined,
    payloadJson: row.payload_json ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at ?? undefined,
  };
}

function mapMessageRow(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    channel: row.channel ?? undefined,
    userId: row.user_id ?? undefined,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

function mapConversationSummaryRow(row: ConversationSummaryRow): ConversationSummary {
  return {
    id: row.id,
    channel: row.channel,
    userId: row.user_id || undefined,
    content: row.content,
    summarizedMessageId: row.summarized_message_id,
    updatedAt: row.updated_at,
  };
}

function conversationSummaryUserId(userId: string | undefined): string {
  return userId ?? "";
}

function mapUiChatSessionRow(row: UiChatSessionRow): UiChatSession {
  return {
    id: row.id,
    title: row.title,
    agentId: row.agent_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pinnedAt: row.pinned_at ?? undefined,
    toolsEnabled: row.tools_enabled !== 0,
    memoryEnabled: row.memory_enabled !== 0,
    providerModelRef: row.provider_model_ref ?? undefined,
    messageCount: row.message_count ?? 0,
    eventTypes: row.event_types ? row.event_types.split(",").filter(Boolean) : [],
  };
}

function mapUiChatMessageRow(row: UiChatMessageRow): UiChatMessage {
  const metadata = parseUiChatMessageMetadata(row.metadata_json ?? undefined);
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id ?? undefined,
    role: row.role,
    content: row.content,
    metadataJson: row.metadata_json ?? undefined,
    ...(metadata.attachments.length ? { attachments: metadata.attachments } : {}),
    createdAt: row.created_at,
  };
}

function parseUiChatMessageMetadata(metadataJson: string | undefined): { attachments: UiChatMessageAttachment[] } {
  if (!metadataJson) return { attachments: [] };
  try {
    const parsed = JSON.parse(metadataJson) as { attachments?: unknown };
    if (!Array.isArray(parsed.attachments)) return { attachments: [] };
    return { attachments: parsed.attachments.filter(isUiChatMessageAttachment).slice(0, 10) };
  } catch {
    return { attachments: [] };
  }
}

function isUiChatMessageAttachment(value: unknown): value is UiChatMessageAttachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Record<string, unknown>;
  return typeof attachment.name === "string"
    && typeof attachment.content === "string"
    && (attachment.type === undefined || typeof attachment.type === "string")
    && (attachment.size === undefined || typeof attachment.size === "number");
}

function mapUiChatEventRow(row: UiChatEventRow): UiChatEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id ?? undefined,
    eventType: row.event_type,
    label: row.label ?? undefined,
    payloadJson: row.payload_json ?? undefined,
    createdAt: row.created_at,
  };
}

function mapUiChatRunRow(row: UiChatRunRow): UiChatRun {
  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status,
    model: row.model ?? undefined,
    providerModelRef: row.provider_model_ref ?? undefined,
    userMessageId: row.user_message_id ?? undefined,
    assistantMessageId: row.assistant_message_id ?? undefined,
    metadataJson: row.metadata_json ?? undefined,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function normalizeMemoryFtsQuery(query: string): string {
  return Array.from(query.matchAll(/[\p{L}\p{N}_]+/gu), (match) => match[0])
    .filter(Boolean)
    .map((token) => `${token.replaceAll('"', '""')}*`)
    .join(" ");
}

function normalizeKnowledgeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeKnowledgeAliases(values: string[]): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const value of values) {
    const alias = normalizeKnowledgeName(value);
    const key = alias.toLocaleLowerCase();
    if (!alias || seen.has(key)) {
      continue;
    }
    seen.add(key);
    aliases.push(alias);
  }
  return aliases;
}

function normalizeKnowledgeRelationType(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

function sanitizeKnowledgePayload(payload: unknown): unknown {
  if (typeof payload === "string") {
    return sanitizeKnowledgeString(payload);
  }
  if (Array.isArray(payload)) {
    return payload.map(sanitizeKnowledgePayload);
  }
  if (isRecord(payload)) {
    const entries = Object.entries(payload).map(([key, value], index) => {
      const sanitizedKey = /password|api[_ -]?key|token|secret/i.test(key) ? `redactedField${index + 1}` : key;
      return [sanitizedKey, sanitizeKnowledgePayload(value)];
    });
    return Object.fromEntries(entries);
  }
  return payload;
}

function sanitizeKnowledgeString(value: string): string {
  let sanitized = value
    .replace(/\b(?:password|api[_ -]?key|token|secret)\s*[:=]\s*"?[^",\s}]+"?/gi, "[REDACTED SECRET-LIKE VALUE]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED SECRET-LIKE VALUE]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?=[A-Za-z0-9]{32,}\b)(?=[A-Za-z0-9]*\d)[A-Za-z0-9]+\b/g, "[REDACTED SECRET-LIKE VALUE]");

  const paymentCandidates = sanitized.match(/(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g) ?? [];
  for (const candidate of paymentCandidates) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && !/^(\d)\1+$/.test(digits) && passesPendingKnowledgeLuhnCheck(digits)) {
      sanitized = sanitized.split(candidate).join("[REDACTED PAYMENT DETAILS]");
    }
  }
  return sanitized;
}

function passesPendingKnowledgeLuhnCheck(digits: string): boolean {
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function appendPendingKnowledgeReason(current: string | undefined, addition: string): string {
  return current ? `${current} ${addition}` : addition;
}

function parsePendingKnowledgePayload(payload: unknown): { entities: NewKnowledgeEntity[]; relations: ParsedPendingKnowledgeRelation[] } {
  const policy = evaluateKnowledgePayload(payload);
  if (policy.decision === "never" || policy.sensitivity === "secret") {
    return { entities: [], relations: [] };
  }

  if (!isRecord(payload)) {
    return { entities: [], relations: [] };
  }

  return {
    entities: Array.isArray(payload.entities) ? payload.entities.flatMap(parsePendingKnowledgeEntity) : [],
    relations: Array.isArray(payload.relations) ? payload.relations.flatMap(parsePendingKnowledgeRelation) : [],
  };
}

function parsePendingKnowledgeEntity(value: unknown): NewKnowledgeEntity[] {
  if (!isRecord(value)) {
    return [];
  }

  const canonicalName = stringValue(value.canonicalName)?.trim() ?? stringValue(value.name)?.trim();
  const kind = stringValue(value.kind);
  const sensitivity = parseKnowledgeSensitivity(value.sensitivity);
  if (!canonicalName || !isKnowledgeEntityKind(kind) || sensitivity === "secret") {
    return [];
  }

  return [{
    canonicalName,
    kind,
    aliases: Array.isArray(value.aliases) ? value.aliases.filter((alias): alias is string => typeof alias === "string") : undefined,
    sensitivity,
    scope: parseMemoryScope(value.scope),
    confidence: numberValue(value.confidence),
    sourceMemoryId: positiveIntegerValue(value.sourceMemoryId),
    sourceMessageId: stringValue(value.sourceMessageId),
  }];
}

function parsePendingKnowledgeRelation(value: unknown): ParsedPendingKnowledgeRelation[] {
  if (!isRecord(value)) {
    return [];
  }

  const relationType = stringValue(value.relationType)?.trim() ?? stringValue(value.type)?.trim();
  const sourceKind = stringValue(value.sourceKind);
  const targetKind = stringValue(value.targetKind);
  const sensitivity = parseKnowledgeSensitivity(value.sensitivity);
  if (!relationType || sensitivity === "secret") {
    return [];
  }

  const relation: ParsedPendingKnowledgeRelation = {
    sourceEntityId: positiveIntegerValue(value.sourceEntityId) ?? positiveIntegerValue(value.sourceId),
    sourceName: stringValue(value.sourceName)?.trim(),
    sourceKind: isKnowledgeEntityKind(sourceKind) ? sourceKind : undefined,
    relationType,
    targetEntityId: positiveIntegerValue(value.targetEntityId) ?? positiveIntegerValue(value.targetId),
    targetName: stringValue(value.targetName)?.trim(),
    targetKind: isKnowledgeEntityKind(targetKind) ? targetKind : undefined,
    evidence: stringValue(value.evidence)?.trim(),
    sensitivity,
    scope: parseMemoryScope(value.scope),
    confidence: numberValue(value.confidence),
    sourceMemoryId: positiveIntegerValue(value.sourceMemoryId),
    sourceMessageId: stringValue(value.sourceMessageId),
  };

  if ((!relation.sourceEntityId && (!relation.sourceName || !relation.sourceKind)) || (!relation.targetEntityId && (!relation.targetName || !relation.targetKind))) {
    return [];
  }
  return [relation];
}

function resolvePendingKnowledgeEntityId(store: SqliteMemoryStore, entityIdsByKey: Map<string, number>, name: string | undefined, kind: KnowledgeEntityKind | undefined): number | undefined {
  if (!name || !kind) {
    return undefined;
  }
  const key = knowledgeEntityKey(name, kind);
  const existingId = entityIdsByKey.get(key);
  if (existingId) {
    return existingId;
  }
  const entity = store.upsertKnowledgeEntity({ canonicalName: name, kind });
  entityIdsByKey.set(knowledgeEntityKey(entity.canonicalName, entity.kind), entity.id);
  return entity.id;
}

function knowledgeEntityKey(name: string, kind: KnowledgeEntityKind): string {
  return `${kind}:${normalizeKnowledgeName(name).toLocaleLowerCase()}`;
}

function parseKnowledgeSensitivity(value: unknown): KnowledgeSensitivity | undefined {
  return value === "normal" || value === "sensitive" || value === "secret" ? value : undefined;
}

function parseMemoryScope(value: unknown): MemoryScope | undefined {
  const scope = typeof value === "string" ? value : undefined;
  return isMemoryScope(scope) ? scope : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveIntegerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampKnowledgeConfidence(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return 1;
  }
  return Math.min(Math.max(value, 0), 1);
}

function maxKnowledgeSensitivity(left: KnowledgeSensitivity, right: KnowledgeSensitivity): KnowledgeSensitivity {
  const rank: Record<KnowledgeSensitivity, number> = { normal: 0, sensitive: 1, secret: 2 };
  return rank[right] > rank[left] ? right : left;
}

function parseStringArrayJson(value: string | null): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { raw: value };
  }
}

function applyMemoryMigrations(db: Database.Database): void {
  addColumnIfMissing(db, "memories", "source", "TEXT DEFAULT 'manual'");
  addColumnIfMissing(db, "memories", "explicit_consent", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "memories", "policy_reason", "TEXT");
  addColumnIfMissing(db, "memories", "pinned", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "memories", "scope", "TEXT DEFAULT 'global'");
  addColumnIfMissing(db, "memories", "namespace", "TEXT NOT NULL DEFAULT 'primary'");
  addColumnIfMissing(db, "memories", "confidence", "REAL DEFAULT 1.0");
  addColumnIfMissing(db, "memories", "expires_at", "TEXT");
  addColumnIfMissing(db, "memories", "superseded_by", "INTEGER");
  addColumnIfMissing(db, "memories", "last_accessed_at", "TEXT");
  addColumnIfMissing(db, "memories", "access_count", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "pending_memories", "source", "TEXT DEFAULT 'manual'");
  addColumnIfMissing(db, "pending_memories", "explicit_consent", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "pending_memories", "namespace", "TEXT NOT NULL DEFAULT 'primary'");
  addColumnIfMissing(db, "pending_action_approvals", "payload_json", "TEXT");
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      summarized_message_id INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel, user_id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_memory_id INTEGER NOT NULL,
      target_memory_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('duplicate', 'conflict', 'supersedes', 'related')),
      reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (target_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      UNIQUE(source_memory_id, target_memory_id, kind)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      aliases_json TEXT DEFAULT '[]',
      sensitivity TEXT DEFAULT 'normal',
      scope TEXT DEFAULT 'global',
      confidence REAL DEFAULT 1.0,
      source_memory_id INTEGER,
      source_message_id TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(canonical_name, kind),
      FOREIGN KEY (source_memory_id) REFERENCES memories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_entity_id INTEGER NOT NULL,
      relation_type TEXT NOT NULL,
      target_entity_id INTEGER NOT NULL,
      evidence TEXT,
      sensitivity TEXT DEFAULT 'normal',
      scope TEXT DEFAULT 'global',
      confidence REAL DEFAULT 1.0,
      source_memory_id INTEGER,
      source_message_id TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_entity_id) REFERENCES knowledge_entities(id) ON DELETE CASCADE,
      FOREIGN KEY (target_entity_id) REFERENCES knowledge_entities(id) ON DELETE CASCADE,
      FOREIGN KEY (source_memory_id) REFERENCES memories(id) ON DELETE SET NULL,
      UNIQUE(source_entity_id, relation_type, target_entity_id)
    );

    CREATE TABLE IF NOT EXISTS pending_knowledge_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload_json TEXT NOT NULL,
      reason TEXT,
      source TEXT DEFAULT 'manual',
      explicit_consent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS knowledge_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_type TEXT NOT NULL CHECK(subject_type IN ('entity', 'relation', 'pending')),
      subject_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      actor TEXT DEFAULT 'system',
      channel TEXT,
      reason TEXT,
      payload_summary TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  addColumnIfMissing(db, "knowledge_entities", "aliases_json", "TEXT DEFAULT '[]'");
  addColumnIfMissing(db, "knowledge_entities", "sensitivity", "TEXT DEFAULT 'normal'");
  addColumnIfMissing(db, "knowledge_entities", "scope", "TEXT DEFAULT 'global'");
  addColumnIfMissing(db, "knowledge_entities", "namespace", "TEXT NOT NULL DEFAULT 'primary'");
  addColumnIfMissing(db, "knowledge_entities", "confidence", "REAL DEFAULT 1.0");
  addColumnIfMissing(db, "knowledge_entities", "source_memory_id", "INTEGER");
  addColumnIfMissing(db, "knowledge_entities", "source_message_id", "TEXT");
  addColumnIfMissing(db, "knowledge_entities", "status", "TEXT DEFAULT 'active'");
  addColumnIfMissing(db, "knowledge_relations", "evidence", "TEXT");
  addColumnIfMissing(db, "knowledge_relations", "sensitivity", "TEXT DEFAULT 'normal'");
  addColumnIfMissing(db, "knowledge_relations", "scope", "TEXT DEFAULT 'global'");
  addColumnIfMissing(db, "knowledge_relations", "namespace", "TEXT NOT NULL DEFAULT 'primary'");
  addColumnIfMissing(db, "knowledge_relations", "confidence", "REAL DEFAULT 1.0");
  addColumnIfMissing(db, "knowledge_relations", "source_memory_id", "INTEGER");
  addColumnIfMissing(db, "knowledge_relations", "source_message_id", "TEXT");
  addColumnIfMissing(db, "knowledge_relations", "status", "TEXT DEFAULT 'active'");
  addColumnIfMissing(db, "pending_knowledge_items", "source", "TEXT DEFAULT 'manual'");
  addColumnIfMissing(db, "pending_knowledge_items", "explicit_consent", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "pending_knowledge_items", "namespace", "TEXT NOT NULL DEFAULT 'primary'");
  migrateKnowledgeEntityNamespaceUniqueConstraint(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_hygiene_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      score INTEGER NOT NULL,
      label TEXT NOT NULL,
      checked INTEGER NOT NULL,
      delete_candidates INTEGER NOT NULL,
      review_only INTEGER NOT NULL,
      duplicate_groups INTEGER NOT NULL,
      stale_memories INTEGER NOT NULL,
      conflict_groups INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ui_chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      pinned_at TEXT,
      tools_enabled INTEGER DEFAULT 1,
      memory_enabled INTEGER DEFAULT 1,
      provider_model_ref TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ui_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      run_id INTEGER,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES ui_chat_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES ui_chat_runs(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS ui_chat_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      model TEXT,
      provider_model_ref TEXT,
      user_message_id INTEGER,
      assistant_message_id INTEGER,
      metadata_json TEXT,
      started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      FOREIGN KEY (session_id) REFERENCES ui_chat_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_message_id) REFERENCES ui_chat_messages(id) ON DELETE SET NULL,
      FOREIGN KEY (assistant_message_id) REFERENCES ui_chat_messages(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS ui_chat_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      run_id INTEGER,
      event_type TEXT NOT NULL,
      label TEXT,
      payload_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES ui_chat_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES ui_chat_runs(id) ON DELETE SET NULL
    );
  `);
  addColumnIfMissing(db, "ui_chat_sessions", "pinned_at", "TEXT");
  addColumnIfMissing(db, "ui_chat_sessions", "tools_enabled", "INTEGER DEFAULT 1");
  addColumnIfMissing(db, "ui_chat_sessions", "memory_enabled", "INTEGER DEFAULT 1");
  addColumnIfMissing(db, "ui_chat_sessions", "provider_model_ref", "TEXT");
  addColumnIfMissing(db, "ui_chat_sessions", "agent_id", "TEXT");
  addColumnIfMissing(db, "ui_chat_messages", "run_id", "INTEGER");
  addColumnIfMissing(db, "ui_chat_messages", "metadata_json", "TEXT");
  addColumnIfMissing(db, "ui_chat_events", "run_id", "INTEGER");
}

function migrateKnowledgeEntityNamespaceUniqueConstraint(db: Database.Database): void {
  const indexes = db.prepare("PRAGMA index_list('knowledge_entities')").all() as Array<{ name: string; origin: string }>;
  const legacyUniqueIndex = indexes.find((index) => {
    if (index.origin !== "u") return false;
    const columns = db.prepare(`PRAGMA index_info('${index.name.replace(/'/g, "''")}')`).all() as Array<{ name: string }>;
    return columns.map((column) => column.name).join(",") === "canonical_name,kind";
  });
  if (!legacyUniqueIndex) return;

  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE knowledge_entities_rebuilt (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          canonical_name TEXT NOT NULL,
          kind TEXT NOT NULL,
          aliases_json TEXT DEFAULT '[]',
          sensitivity TEXT DEFAULT 'normal',
          scope TEXT DEFAULT 'global',
          namespace TEXT NOT NULL DEFAULT 'primary',
          confidence REAL DEFAULT 1.0,
          source_memory_id INTEGER,
          source_message_id TEXT,
          status TEXT DEFAULT 'active',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(canonical_name, kind, namespace),
          FOREIGN KEY (source_memory_id) REFERENCES memories(id) ON DELETE SET NULL
        );
        CREATE TABLE knowledge_relations_rebuilt (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_entity_id INTEGER NOT NULL,
          relation_type TEXT NOT NULL,
          target_entity_id INTEGER NOT NULL,
          evidence TEXT,
          sensitivity TEXT DEFAULT 'normal',
          scope TEXT DEFAULT 'global',
          namespace TEXT NOT NULL DEFAULT 'primary',
          confidence REAL DEFAULT 1.0,
          source_memory_id INTEGER,
          source_message_id TEXT,
          status TEXT DEFAULT 'active',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (source_entity_id) REFERENCES knowledge_entities(id) ON DELETE CASCADE,
          FOREIGN KEY (target_entity_id) REFERENCES knowledge_entities(id) ON DELETE CASCADE,
          FOREIGN KEY (source_memory_id) REFERENCES memories(id) ON DELETE SET NULL,
          UNIQUE(source_entity_id, relation_type, target_entity_id)
        );
        INSERT INTO knowledge_entities_rebuilt SELECT id, canonical_name, kind, aliases_json, sensitivity, scope, namespace, confidence, source_memory_id, source_message_id, status, created_at, updated_at FROM knowledge_entities;
        INSERT INTO knowledge_relations_rebuilt SELECT id, source_entity_id, relation_type, target_entity_id, evidence, sensitivity, scope, namespace, confidence, source_memory_id, source_message_id, status, created_at, updated_at FROM knowledge_relations;
        DROP TABLE knowledge_relations;
        DROP TABLE knowledge_entities;
        ALTER TABLE knowledge_entities_rebuilt RENAME TO knowledge_entities;
        ALTER TABLE knowledge_relations_rebuilt RENAME TO knowledge_relations;
      `);
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function initializeMemorySearchIndex(db: Database.Database): void {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_search USING fts5(
        memory_id UNINDEXED,
        type,
        content,
        tokenize = 'porter unicode61'
      )
    `);
    db.prepare("DELETE FROM memory_search").run();
    db.prepare(`
      INSERT INTO memory_search(memory_id, type, content)
      SELECT id, type, content FROM memories WHERE status = 'active'
    `).run();
  } catch {
    // FTS5 is optional across SQLite builds; LIKE search remains the compatibility path.
  }
}

function hasMemorySearchIndex(db: Database.Database): boolean {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_search'").get();
    return Boolean(row);
  } catch {
    return false;
  }
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;

  if (!rows.some((row) => row.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}
