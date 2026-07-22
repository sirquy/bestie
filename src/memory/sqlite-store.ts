import Database from "better-sqlite3";
import { mkdir } from "node:fs/promises";

import { getRuntimePaths, type RuntimePaths } from "../runtime/paths.js";
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
  createdAt: string;
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

  listRecentMessagesForChannel(channel: string, userId: string, limit = 20): StoredMessage[] {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE channel = ? AND user_id = ? ORDER BY id DESC LIMIT ?")
      .all(channel, userId, limit) as MessageRow[];

    return rows.reverse().map(mapMessageRow);
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
      INSERT INTO memories (type, content, sensitivity, importance, source_message_id, source, explicit_consent, policy_reason, pinned, scope, confidence, expires_at, superseded_by)
      VALUES (@type, @content, @sensitivity, @importance, @sourceMessageId, @source, @explicitConsent, @policyReason, @pinned, @scope, @confidence, @expiresAt, @supersededBy)
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
      confidence: memory.confidence ?? 1,
      expiresAt: memory.expiresAt ?? defaultExpiresAtForScope(scope),
      supersededBy: memory.supersededBy ?? null,
    });

    const inserted = this.getMemory(Number(result.lastInsertRowid));
    this.upsertMemorySearchIndex(inserted);
    return inserted;
  }

  addPendingMemory(memory: { type: string; content: string; reason?: string; source?: string; explicitConsent?: boolean }): PendingMemory {
    const result = this.db
      .prepare("INSERT INTO pending_memories (type, content, reason, source, explicit_consent) VALUES (@type, @content, @reason, @source, @explicitConsent)")
      .run({
        type: memory.type,
        content: memory.content,
        reason: memory.reason ?? null,
        source: memory.source ?? "manual",
        explicitConsent: memory.explicitConsent ? 1 : 0,
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

  listActiveMemories(limit?: number): StoredMemory[] {
    const rows = limit === undefined
      ? (this.db.prepare("SELECT * FROM memories WHERE status = 'active' ORDER BY importance DESC, updated_at DESC").all() as MemoryRow[])
      : (this.db.prepare("SELECT * FROM memories WHERE status = 'active' ORDER BY importance DESC, updated_at DESC LIMIT ?").all(limit) as MemoryRow[]);

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

  searchMemories(query: string, limit?: number): StoredMemory[] {
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
            ORDER BY bm25(memory_search), memories.importance DESC, memories.updated_at DESC
          `)
              .all({ query: ftsQuery }) as MemoryRow[])
          : (this.db
              .prepare(`
            SELECT memories.*
            FROM memory_search
            JOIN memories ON memories.id = memory_search.memory_id
            WHERE memory_search MATCH @query
              AND memories.status = 'active'
            ORDER BY bm25(memory_search), memories.importance DESC, memories.updated_at DESC
            LIMIT @limit
          `)
              .all({ query: ftsQuery, limit }) as MemoryRow[]);

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
          AND (content LIKE @query ESCAPE '\' OR type LIKE @query ESCAPE '\')
        ORDER BY importance DESC, updated_at DESC
      `)
          .all({ query: `%${escapeLike(normalizedQuery)}%` }) as MemoryRow[])
      : (this.db
          .prepare(`
        SELECT * FROM memories
        WHERE status = 'active'
          AND (content LIKE @query ESCAPE '\\' OR type LIKE @query ESCAPE '\\')
        ORDER BY importance DESC, updated_at DESC
        LIMIT @limit
      `)
          .all({ query: `%${escapeLike(normalizedQuery)}%`, limit }) as MemoryRow[]);

    return rows.map(mapMemoryRow);
  }

  // --- UI chat sessions ---

  createUiChatSession(title = "New chat"): UiChatSession {
    const result = this.db.prepare("INSERT INTO ui_chat_sessions (title) VALUES (?)").run(title.trim() || "New chat");
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

  addUiChatMessage(sessionId: number, role: "user" | "assistant", content: string, runId?: number): UiChatMessage {
    const transaction = this.db.transaction(() => {
      const result = this.db
        .prepare("INSERT INTO ui_chat_messages (session_id, run_id, role, content) VALUES (?, ?, ?, ?)")
        .run(sessionId, runId ?? null, role, content);
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
      const fork = this.createUiChatSession(title ?? `${source.title} fork`);
      for (const message of messages) {
        this.addUiChatMessage(fork.id, message.role, message.content);
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

interface UiChatSessionRow {
  id: number;
  title: string;
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

function mapPendingMemoryRow(row: PendingMemoryRow): PendingMemory {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    reason: row.reason ?? undefined,
    source: row.source ?? undefined,
    explicitConsent: row.explicit_consent === 1,
    createdAt: row.created_at,
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

function mapUiChatSessionRow(row: UiChatSessionRow): UiChatSession {
  return {
    id: row.id,
    title: row.title,
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
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id ?? undefined,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
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

function applyMemoryMigrations(db: Database.Database): void {
  addColumnIfMissing(db, "memories", "source", "TEXT DEFAULT 'manual'");
  addColumnIfMissing(db, "memories", "explicit_consent", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "memories", "policy_reason", "TEXT");
  addColumnIfMissing(db, "memories", "pinned", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "memories", "scope", "TEXT DEFAULT 'global'");
  addColumnIfMissing(db, "memories", "confidence", "REAL DEFAULT 1.0");
  addColumnIfMissing(db, "memories", "expires_at", "TEXT");
  addColumnIfMissing(db, "memories", "superseded_by", "INTEGER");
  addColumnIfMissing(db, "memories", "last_accessed_at", "TEXT");
  addColumnIfMissing(db, "memories", "access_count", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "pending_memories", "source", "TEXT DEFAULT 'manual'");
  addColumnIfMissing(db, "pending_memories", "explicit_consent", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "pending_action_approvals", "payload_json", "TEXT");
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
  addColumnIfMissing(db, "ui_chat_messages", "run_id", "INTEGER");
  addColumnIfMissing(db, "ui_chat_events", "run_id", "INTEGER");
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
