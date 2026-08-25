import type { Dirent } from "node:fs";
import { execFile } from "node:child_process";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { readRecentLogs } from "../runtime/logger.js";
import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { formatWorkspaceRelativePath, resolveSandboxPath } from "../runtime/workspace.js";
import { reviewActionPermission, type PermissionApprover, type PermissionPolicy } from "../safety/permission-policy.js";
import { analyzeKnowledgeGraph, planKnowledgeGraphReview, type KnowledgeGraphAnalysis, type KnowledgeGraphReviewPlan } from "../memory/knowledge-governance.js";
import { planMemoryRebalance, type MemoryRebalanceRecommendation } from "../memory/rebalance.js";
import { SqliteMemoryStore, type KnowledgeEntity, type KnowledgeGraphSearchResult, type KnowledgeRelationWithEntities, type MemoryHygieneSnapshot, type StoredMemory } from "../memory/sqlite-store.js";

export interface LocalToolOptions {
  config?: AppConfig;
  paths: RuntimePaths;
  approver?: PermissionApprover;
  policy?: PermissionPolicy;
}

export interface ReadRecentAppLogsResult {
  allowed: boolean;
  reason: string;
  lines: string[];
}

export interface LocalMemorySummary {
  id: number;
  type: string;
  content: string;
  sensitivity: string;
  importance: number;
  updatedAt: string;
}

export interface ListActiveMemoriesResult {
  allowed: boolean;
  reason: string;
  memories: LocalMemorySummary[];
}

export interface SearchMemoriesResult extends ListActiveMemoriesResult {
  query: string;
}

export interface InspectMemoryResult {
  allowed: boolean;
  reason: string;
  memory?: StoredMemory;
}

export interface SearchKnowledgeGraphToolResult {
  allowed: boolean;
  reason: string;
  graph: KnowledgeGraphSearchResult;
}

export interface InspectKnowledgeEntityToolResult {
  allowed: boolean;
  reason: string;
  entity?: KnowledgeEntity;
  neighborhood: KnowledgeRelationWithEntities[];
}

export interface AnalyzeKnowledgeGraphToolResult {
  allowed: boolean;
  reason: string;
  analysis: KnowledgeGraphAnalysis;
}

export interface PlanKnowledgeGraphReviewToolResult extends AnalyzeKnowledgeGraphToolResult {
  plan: KnowledgeGraphReviewPlan;
}

export type MemoryAnalysisMode = "all" | "duplicates" | "stale" | "conflicts";

export interface AnalyzeMemoriesResult {
  allowed: boolean;
  reason: string;
  mode: MemoryAnalysisMode;
  checked: number;
  duplicateGroups: Array<{ canonicalId: number; duplicateIds: number[]; reason: string }>;
  staleMemories: Array<{ id: number; reason: string }>;
  conflictGroups: Array<{ ids: number[]; reason: string }>;
}

export interface MemoryHygienePlanResult {
  allowed: boolean;
  reason: string;
  checked: number;
  deleteIds: number[];
  duplicateGroups: AnalyzeMemoriesResult["duplicateGroups"];
  staleMemories: AnalyzeMemoriesResult["staleMemories"];
  conflictGroups: AnalyzeMemoriesResult["conflictGroups"];
  reviewOnlyIds: number[];
}

export interface MemoryHygieneTrendResult {
  allowed: boolean;
  reason: string;
  snapshots: MemoryHygieneSnapshot[];
  latest?: MemoryHygieneSnapshot;
  baseline?: MemoryHygieneSnapshot;
  delta?: number;
  direction: "new" | "up" | "down" | "flat";
}

export interface MemoryRebalancePlanToolResult {
  allowed: boolean;
  reason: string;
  checked: number;
  recommendations: MemoryRebalanceRecommendation[];
  reviewOnlyIds: number[];
  nextCommand: string;
}

export interface ReadLocalFileResult {
  allowed: boolean;
  reason: string;
  path?: string;
  content?: string;
}

export interface ListLocalFilesResult {
  allowed: boolean;
  reason: string;
  path?: string;
  entries: Array<{ name: string; type: "file" | "directory" | "other" }>;
}

export interface SearchLocalFilesResult {
  allowed: boolean;
  reason: string;
  path?: string;
  matches: Array<{ path: string; type: "file" | "directory" }>;
}

export interface ReadManyLocalFilesResult {
  allowed: boolean;
  reason: string;
  files: Array<{ path: string; content: string; truncated: boolean; bytes: number }>;
  skipped: Array<{ path: string; reason: string }>;
  totalBytes: number;
}

export interface ReadMarkdownBundleResult extends ReadManyLocalFilesResult {
  manifest: string[];
  truncatedFiles: string[];
}

export interface ReadGitStatusResult {
  allowed: boolean;
  reason: string;
  output: string;
}

export interface ReadGitDiffResult extends ReadGitStatusResult {
  truncated: boolean;
}

export interface ReadGitLogResult extends ReadGitStatusResult {}

export interface GitReadOptions {
  path?: string;
  repoPath?: string;
}

const MAX_INTERNAL_READ_FILE_BYTES = 64 * 1024;
const MAX_INTERNAL_READ_MANY_FILE_BYTES = 24 * 1024;
const MAX_INTERNAL_READ_MANY_TOTAL_BYTES = 160 * 1024;
const MAX_INTERNAL_READ_MANY_FILES = 40;
const MAX_INTERNAL_LIST_FILES_ENTRIES = 200;
const MAX_INTERNAL_SEARCH_FILES_ENTRIES = 200;
const MAX_INTERNAL_SEARCH_VISITED_ENTRIES = 5_000;
const MAX_INTERNAL_GIT_DIFF_BYTES = 96 * 1024;
const MAX_INTERNAL_GIT_LOG_COMMITS = 30;
const DEFAULT_MEMORY_TOOL_LIMIT = 50;
const MAX_MEMORY_TOOL_LIMIT = 200;
const execFileAsync = promisify(execFile);

export async function readRecentAppLogsTool(options: LocalToolOptions & { lineCount?: number }): Promise<ReadRecentAppLogsResult> {
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "read_recent_app_logs",
      target: "local app log",
      reason: "Inspect recent redacted runtime events.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason, lines: [] };
  }

  return {
    allowed: true,
    reason: permission.reason,
    lines: await readRecentLogs(options.paths, options.lineCount ?? 20),
  };
}

export async function listActiveMemoriesTool(options: LocalToolOptions & { limit?: number }): Promise<ListActiveMemoriesResult> {
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "list_active_memories",
      target: "local memory store",
      reason: "Inspect approved active local memories.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason, memories: [] };
  }

  const store = await SqliteMemoryStore.open(options.paths);

  try {
    return {
      allowed: true,
      reason: permission.reason,
      memories: store.listActiveMemories(normalizeOptionalMemoryLimit(options.limit)).map((memory) => ({
        id: memory.id,
        type: memory.type,
        content: memory.content,
        sensitivity: memory.sensitivity,
        importance: memory.importance,
        updatedAt: memory.updatedAt,
      })),
    };
  } finally {
    store.close();
  }
}

export async function searchMemoriesTool(options: LocalToolOptions & { query: string; limit?: number }): Promise<SearchMemoriesResult> {
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "search_active_memories",
      target: "local memory store",
      reason: "Search approved active local memories.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason, query: options.query, memories: [] };
  }

  const store = await SqliteMemoryStore.open(options.paths);

  try {
    return {
      allowed: true,
      reason: permission.reason,
      query: options.query,
      memories: store.searchMemories(options.query, normalizeOptionalMemoryLimit(options.limit)).map((memory) => ({
        id: memory.id,
        type: memory.type,
        content: memory.content,
        sensitivity: memory.sensitivity,
        importance: memory.importance,
        updatedAt: memory.updatedAt,
      })),
    };
  } finally {
    store.close();
  }
}

export async function inspectMemoryTool(options: LocalToolOptions & { id: number }): Promise<InspectMemoryResult> {
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "inspect_active_memory",
      target: `memory #${options.id}`,
      reason: "Inspect one approved active local memory and its governance metadata.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason };
  }

  const store = await SqliteMemoryStore.open(options.paths);

  try {
    return {
      allowed: true,
      reason: permission.reason,
      memory: store.getActiveMemory(options.id),
    };
  } finally {
    store.close();
  }
}

export async function searchKnowledgeGraphTool(options: LocalToolOptions & { query: string; limit?: number }): Promise<SearchKnowledgeGraphToolResult> {
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "search_knowledge_graph",
      target: "local knowledge graph",
      reason: "Search approved active local knowledge graph entities and relations.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason, graph: { query: options.query, entities: [], relations: [] } };
  }

  const store = await SqliteMemoryStore.open(options.paths);

  try {
    return {
      allowed: true,
      reason: permission.reason,
      graph: store.searchKnowledgeGraph(options.query, normalizeOptionalMemoryLimit(options.limit)),
    };
  } finally {
    store.close();
  }
}

export async function inspectKnowledgeEntityTool(options: LocalToolOptions & { id: number; limit?: number }): Promise<InspectKnowledgeEntityToolResult> {
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "inspect_knowledge_entity",
      target: `knowledge entity #${options.id}`,
      reason: "Inspect one approved active local knowledge graph entity and its one-hop relations.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason, neighborhood: [] };
  }

  const store = await SqliteMemoryStore.open(options.paths);

  try {
    const entity = store.getKnowledgeEntity(options.id);
    return {
      allowed: true,
      reason: permission.reason,
      entity,
      neighborhood: entity ? store.getKnowledgeEntityNeighborhood(entity.id, normalizeOptionalMemoryLimit(options.limit) ?? 20) : [],
    };
  } finally {
    store.close();
  }
}

export async function analyzeKnowledgeGraphTool(options: LocalToolOptions): Promise<AnalyzeKnowledgeGraphToolResult> {
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "analyze_knowledge_graph",
      target: "local knowledge graph",
      reason: "Find duplicate entity candidates, relation conflicts, and pending review items in the local knowledge graph.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  const emptyAnalysis = emptyKnowledgeGraphAnalysis();
  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason, analysis: emptyAnalysis };
  }

  const store = await SqliteMemoryStore.open(options.paths);

  try {
    return {
      allowed: true,
      reason: permission.reason,
      analysis: analyzeKnowledgeGraph({
        entities: store.listKnowledgeEntities({ limit: 10_000 }),
        relations: store.listKnowledgeRelations(10_000),
        pending: store.listPendingKnowledgeItems(10_000),
      }),
    };
  } finally {
    store.close();
  }
}

export async function planKnowledgeGraphReviewTool(options: LocalToolOptions & { limit?: number }): Promise<PlanKnowledgeGraphReviewToolResult> {
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "plan_knowledge_graph_review",
      target: "local knowledge graph",
      reason: "Prioritize safe next review steps for duplicate entities, conflicting relations, and pending graph items.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  const emptyAnalysis = emptyKnowledgeGraphAnalysis();
  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason, analysis: emptyAnalysis, plan: planKnowledgeGraphReview(emptyAnalysis, normalizeOptionalMemoryLimit(options.limit) ?? 10) };
  }

  const store = await SqliteMemoryStore.open(options.paths);

  try {
    const analysis = analyzeKnowledgeGraph({
      entities: store.listKnowledgeEntities({ limit: 10_000 }),
      relations: store.listKnowledgeRelations(10_000),
      pending: store.listPendingKnowledgeItems(10_000),
    });
    return {
      allowed: true,
      reason: permission.reason,
      analysis,
      plan: planKnowledgeGraphReview(analysis, normalizeOptionalMemoryLimit(options.limit) ?? 10),
    };
  } finally {
    store.close();
  }
}

export async function analyzeMemoriesTool(options: LocalToolOptions & { mode?: MemoryAnalysisMode }): Promise<AnalyzeMemoriesResult> {
  const mode = normalizeMemoryAnalysisMode(options.mode);
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "analyze_active_memories",
      target: "local memory store",
      reason: "Find duplicate, stale, and conflicting active memories for cleanup planning.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason, mode, checked: 0, duplicateGroups: [], staleMemories: [], conflictGroups: [] };
  }

  const store = await SqliteMemoryStore.open(options.paths);

  try {
    const memories = store.listActiveMemories();
    return {
      allowed: true,
      reason: permission.reason,
      mode,
      checked: memories.length,
      duplicateGroups: mode === "all" || mode === "duplicates" ? findDuplicateMemoryGroups(memories) : [],
      staleMemories: mode === "all" || mode === "stale" ? findStaleMemories(memories) : [],
      conflictGroups: mode === "all" || mode === "conflicts" ? findConflictMemoryGroups(memories) : [],
    };
  } finally {
    store.close();
  }
}

export async function planMemoryHygieneTool(options: LocalToolOptions): Promise<MemoryHygienePlanResult> {
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "plan_memory_hygiene",
      target: "local memory store",
      reason: "Create a read-only memory hygiene plan from duplicate, stale, and conflict analysis.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason, checked: 0, deleteIds: [], duplicateGroups: [], staleMemories: [], conflictGroups: [], reviewOnlyIds: [] };
  }

  const store = await SqliteMemoryStore.open(options.paths);

  try {
    const memories = store.listActiveMemories();
    const duplicateGroups = findDuplicateMemoryGroups(memories);
    const staleMemories = findStaleMemories(memories);
    const conflictGroups = findConflictMemoryGroups(memories);
    const deleteIds = [...new Set([...duplicateGroups.flatMap((group) => group.duplicateIds), ...staleMemories.map((memory) => memory.id)])].sort((left, right) => left - right);
    const reviewOnlyIds = [...new Set(conflictGroups.flatMap((group) => group.ids))].sort((left, right) => left - right);

    return {
      allowed: true,
      reason: permission.reason,
      checked: memories.length,
      deleteIds,
      duplicateGroups,
      staleMemories,
      conflictGroups,
      reviewOnlyIds,
    };
  } finally {
    store.close();
  }
}

export async function planMemoryRebalanceTool(options: LocalToolOptions): Promise<MemoryRebalancePlanToolResult> {
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "plan_memory_rebalance",
      target: "local memory store",
      reason: "Create a read-only memory tier rebalance plan from active memory metadata.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason, checked: 0, recommendations: [], reviewOnlyIds: [], nextCommand: "bestie memory rebalance --dry-run" };
  }

  const store = await SqliteMemoryStore.open(options.paths);

  try {
    const plan = planMemoryRebalance(store.listActiveMemories());
    return {
      allowed: true,
      reason: permission.reason,
      ...plan,
      nextCommand: plan.recommendations.some((recommendation) => !recommendation.reviewOnly) ? "bestie memory rebalance --apply --yes" : "bestie memory rebalance --dry-run",
    };
  } finally {
    store.close();
  }
}

export async function readMemoryHygieneTrendTool(options: LocalToolOptions & { limit?: number }): Promise<MemoryHygieneTrendResult> {
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "read_memory_hygiene_trend",
      target: "local memory hygiene snapshots",
      reason: "Inspect recent memory hygiene score snapshots for maintenance reporting.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason, snapshots: [], direction: "new" };
  }

  const store = await SqliteMemoryStore.open(options.paths);

  try {
    const snapshots = store.listMemoryHygieneSnapshots(normalizeMemoryTrendLimit(options.limit));
    const latest = snapshots[0];
    const baseline = snapshots.at(-1);

    if (!latest || !baseline || latest.id === baseline.id) {
      return { allowed: true, reason: permission.reason, snapshots, latest, baseline, direction: "new" };
    }

    const delta = latest.score - baseline.score;
    return {
      allowed: true,
      reason: permission.reason,
      snapshots,
      latest,
      baseline,
      delta,
      direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    };
  } finally {
    store.close();
  }
}

function normalizeOptionalMemoryLimit(limit: number | undefined): number | undefined {
  return limit === undefined ? undefined : normalizeMemoryLimit(limit);
}

function emptyKnowledgeGraphAnalysis(): KnowledgeGraphAnalysis {
  return { checkedEntities: 0, checkedRelations: 0, orphanEntities: [], lowConfidenceRelations: [], mergeCandidates: [], conflictingRelations: [], pendingItems: [], score: 100 };
}

function normalizeMemoryTrendLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 8, 2), 52);
}

function normalizeMemoryLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? DEFAULT_MEMORY_TOOL_LIMIT, 1), MAX_MEMORY_TOOL_LIMIT);
}

function normalizeMemoryAnalysisMode(mode: MemoryAnalysisMode | undefined): MemoryAnalysisMode {
  return mode === "duplicates" || mode === "stale" || mode === "conflicts" ? mode : "all";
}

function findDuplicateMemoryGroups(memories: StoredMemory[]): AnalyzeMemoriesResult["duplicateGroups"] {
  const groups = new Map<string, StoredMemory[]>();

  for (const memory of memories) {
    const key = normalizeMemoryContent(memory.content);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), memory]);
  }

  return Array.from(groups.values())
    .filter((group) => group.length > 1)
    .flatMap((group) => {
      const sorted = [...group].sort(compareCanonicalMemory);
      const canonical = sorted[0];
      const duplicateIds = sorted.slice(1).filter((memory) => memory.scope !== "core").map((memory) => memory.id);
      if (duplicateIds.length === 0) return [];
      return {
        canonicalId: canonical.id,
        duplicateIds,
        reason: "Same normalized memory content. Core-scope duplicates are review-only.",
      };
    });
}

function findStaleMemories(memories: StoredMemory[]): AnalyzeMemoriesResult["staleMemories"] {
  const now = Date.now();
  const staleCutoffMs = 180 * 24 * 60 * 60 * 1000;

  return memories.flatMap((memory) => {
    if (memory.pinned) return [];
    if (memory.scope === "core") return [];
    if (memory.supersededBy !== undefined) return [{ id: memory.id, reason: `Superseded by memory #${memory.supersededBy}.` }];
    if (memory.expiresAt && Date.parse(memory.expiresAt) <= now) return [{ id: memory.id, reason: `Expired at ${memory.expiresAt}.` }];
    const scopeCutoffMs = memory.scope === "session" ? 14 * 24 * 60 * 60 * 1000 : staleCutoffMs;
    if (memory.accessCount === 0 && Date.parse(memory.updatedAt) <= now - scopeCutoffMs) return [{ id: memory.id, reason: memory.scope === "session" ? "Session memory not accessed and not updated for at least 14 days." : "Not accessed and not updated for at least 180 days." }];
    return [];
  });
}

function findConflictMemoryGroups(memories: StoredMemory[]): AnalyzeMemoriesResult["conflictGroups"] {
  const conflicts: AnalyzeMemoriesResult["conflictGroups"] = [];

  for (let leftIndex = 0; leftIndex < memories.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < memories.length; rightIndex += 1) {
      const left = memories[leftIndex];
      const right = memories[rightIndex];
      if (left.type !== right.type || left.scope !== right.scope) continue;
      if (!looksContradictory(left.content, right.content)) continue;
      conflicts.push({ ids: [left.id, right.id].sort((leftId, rightId) => leftId - rightId), reason: "Same type and scope contain opposing preference language." });
    }
  }

  return conflicts;
}

function normalizeMemoryContent(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

function compareCanonicalMemory(left: StoredMemory, right: StoredMemory): number {
  const pinned = Number(right.pinned) - Number(left.pinned);
  if (pinned !== 0) return pinned;
  const importance = right.importance - left.importance;
  if (importance !== 0) return importance;
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function looksContradictory(leftContent: string, rightContent: string): boolean {
  const left = normalizeMemoryContent(leftContent);
  const right = normalizeMemoryContent(rightContent);
  return (hasNegation(left) && containsMainPhrase(left, right)) || (hasNegation(right) && containsMainPhrase(right, left));
}

function hasNegation(value: string): boolean {
  return /\b(do not|don't|does not|never|no longer|khong|không|dung|đừng|khong thich|không thích)\b/i.test(value);
}

function containsMainPhrase(negative: string, other: string): boolean {
  const phrase = negative
    .replace(/\b(do not|don't|does not|never|no longer|khong|không|dung|đừng|khong thich|không thích)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return phrase.length >= 8 && other.includes(phrase);
}

export async function readLocalFileTool(options: LocalToolOptions & { path: string; maxBytes?: number }): Promise<ReadLocalFileResult> {
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "read_local_file",
      target: options.path,
      reason: "Read a local project file requested by the agent.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason };
  }

  const resolvedPath = await resolveReadableProjectPath(options, options.path);
  const relativePath = formatWorkspaceRelativePath(options.config, options.paths, resolvedPath);
  if (isIgnoredProjectPath(relativePath)) {
    return { allowed: false, reason: "Path is in an ignored directory.", path: resolvedPath };
  }

  const fileStat = await statReadableProjectPath(resolvedPath);
  if (!fileStat) {
    return { allowed: false, reason: "Path does not exist.", path: resolvedPath };
  }

  if (!fileStat.isFile()) {
    return { allowed: false, reason: "Path is not a regular file.", path: resolvedPath };
  }

  const maxBytes = Math.min(Math.max(options.maxBytes ?? MAX_INTERNAL_READ_FILE_BYTES, 1), MAX_INTERNAL_READ_FILE_BYTES);
  const buffer = await readReadableProjectFile(resolvedPath);
  if (!buffer) {
    return { allowed: false, reason: "Path does not exist.", path: resolvedPath };
  }

  const truncated = buffer.length > maxBytes;
  const content = buffer.subarray(0, maxBytes).toString("utf8");

  return { allowed: true, reason: truncated ? `Read first ${maxBytes} bytes; file is larger.` : permission.reason, path: resolvedPath, content };
}

export async function listLocalFilesTool(options: LocalToolOptions & { path?: string; limit?: number }): Promise<ListLocalFilesResult> {
  const requestedPath = options.path ?? ".";
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "list_local_files",
      target: requestedPath,
      reason: "List local project files requested by the agent.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason, entries: [] };
  }

  const resolvedPath = await resolveReadableListPath(options, requestedPath);
  const directoryStat = await statReadableProjectPath(resolvedPath);
  if (!directoryStat) {
    if (isDefaultListPath(requestedPath)) {
      return { allowed: true, reason: permission.reason, path: resolvedPath, entries: [] };
    }
    return { allowed: false, reason: "Path does not exist.", path: resolvedPath, entries: [] };
  }

  if (!directoryStat.isDirectory()) {
    return { allowed: false, reason: "Path is not a directory.", path: resolvedPath, entries: [] };
  }

  const directoryEntries = await readReadableProjectDirectory(resolvedPath);
  if (!directoryEntries) {
    return { allowed: false, reason: "Path does not exist.", path: resolvedPath, entries: [] };
  }

  const limit = Math.min(Math.max(options.limit ?? 50, 1), MAX_INTERNAL_LIST_FILES_ENTRIES);

  return {
    allowed: true,
    reason: permission.reason,
    path: resolvedPath,
    entries: directoryEntries.slice(0, limit).map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
    })),
  };
}

export async function searchLocalFilesTool(options: LocalToolOptions & { query: string; path?: string; limit?: number }): Promise<SearchLocalFilesResult> {
  const requestedPath = options.path ?? ".";
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "search_local_files",
      target: `${requestedPath} :: ${options.query}`,
      reason: "Search local project file names requested by the agent.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason, matches: [] };
  }

  const query = options.query.trim();
  if (!query) {
    return { allowed: false, reason: "internal.search_files requires a non-empty query.", matches: [] };
  }

  const resolvedPath = await resolveReadableListPath(options, requestedPath);
  const rootStat = await statReadableProjectPath(resolvedPath);
  if (!rootStat) {
    if (isDefaultListPath(requestedPath)) {
      return { allowed: true, reason: permission.reason, path: resolvedPath, matches: [] };
    }
    return { allowed: false, reason: "Path does not exist.", path: resolvedPath, matches: [] };
  }

  const matcher = createFileSearchMatcher(query);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), MAX_INTERNAL_SEARCH_FILES_ENTRIES);
  const matches: SearchLocalFilesResult["matches"] = [];
  let visited = 0;

  async function visit(directoryPath: string): Promise<void> {
    if (matches.length >= limit || visited >= MAX_INTERNAL_SEARCH_VISITED_ENTRIES) {
      return;
    }

    const entries = await readReadableProjectDirectory(directoryPath);
    if (!entries) {
      return;
    }

    for (const entry of entries) {
      if (matches.length >= limit || visited >= MAX_INTERNAL_SEARCH_VISITED_ENTRIES) {
        return;
      }

      if (shouldSkipSearchEntry(entry.name)) {
        continue;
      }

      visited += 1;
      const absoluteEntryPath = resolve(directoryPath, entry.name);
      const relativeEntryPath = formatWorkspaceRelativePath(options.config, options.paths, absoluteEntryPath);
      const type = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : undefined;

      if (type && matcher(relativeEntryPath, entry.name)) {
        matches.push({ path: relativeEntryPath, type });
      }

      if (entry.isDirectory()) {
        await visit(absoluteEntryPath);
      }
    }
  }

  if (rootStat.isDirectory()) {
    await visit(resolvedPath);
  } else if (rootStat.isFile()) {
    const relativeFilePath = formatWorkspaceRelativePath(options.config, options.paths, resolvedPath);
    if (matcher(relativeFilePath, relativeFilePath.split(/[\\/]/).at(-1) ?? relativeFilePath)) {
      matches.push({ path: relativeFilePath, type: "file" });
    }
  }

  return { allowed: true, reason: permission.reason, path: resolvedPath, matches };
}

export async function readManyLocalFilesTool(options: LocalToolOptions & { pathsToRead: string[]; maxBytesPerFile?: number; maxTotalBytes?: number }): Promise<ReadManyLocalFilesResult> {
  const uniquePaths = [...new Set(options.pathsToRead.map((path) => path.trim()).filter(Boolean))];
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "read_many_local_files",
      target: `${uniquePaths.length} local project files`,
      reason: "Read multiple local project files requested by the agent.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason, files: [], skipped: [], totalBytes: 0 };
  }

  const maxBytesPerFile = Math.min(Math.max(options.maxBytesPerFile ?? MAX_INTERNAL_READ_MANY_FILE_BYTES, 1), MAX_INTERNAL_READ_FILE_BYTES);
  const maxTotalBytes = Math.min(Math.max(options.maxTotalBytes ?? MAX_INTERNAL_READ_MANY_TOTAL_BYTES, 1), MAX_INTERNAL_READ_MANY_TOTAL_BYTES);
  const files: ReadManyLocalFilesResult["files"] = [];
  const skipped: ReadManyLocalFilesResult["skipped"] = [];
  let totalBytes = 0;

  for (const inputPath of uniquePaths.slice(0, MAX_INTERNAL_READ_MANY_FILES)) {
    let resolvedPath: string;

    try {
      resolvedPath = await resolveReadableProjectPath(options, inputPath);
    } catch (error) {
      skipped.push({ path: inputPath, reason: error instanceof Error ? error.message : "Path could not be resolved." });
      continue;
    }

    const relativePath = formatWorkspaceRelativePath(options.config, options.paths, resolvedPath);

    if (isIgnoredProjectPath(relativePath)) {
      skipped.push({ path: relativePath, reason: "Path is in an ignored directory." });
      continue;
    }

    const remainingBytes = maxTotalBytes - totalBytes;
    if (remainingBytes <= 0) {
      skipped.push({ path: relativePath, reason: "Total byte budget exhausted." });
      continue;
    }

    const fileStat = await statReadableProjectPath(resolvedPath);
    if (!fileStat) {
      skipped.push({ path: relativePath, reason: "Path does not exist." });
      continue;
    }

    if (!fileStat.isFile()) {
      skipped.push({ path: relativePath, reason: "Path is not a regular file." });
      continue;
    }

    const readBudget = Math.min(maxBytesPerFile, remainingBytes);
    const buffer = await readReadableProjectFile(resolvedPath);
    if (!buffer) {
      skipped.push({ path: relativePath, reason: "Path does not exist." });
      continue;
    }

    const truncated = buffer.length > readBudget;
    const contentBuffer = buffer.subarray(0, readBudget);
    totalBytes += contentBuffer.length;
    files.push({ path: relativePath, content: contentBuffer.toString("utf8"), truncated, bytes: contentBuffer.length });
  }

  for (const inputPath of uniquePaths.slice(MAX_INTERNAL_READ_MANY_FILES)) {
    skipped.push({ path: inputPath, reason: `File count limit exceeded (${MAX_INTERNAL_READ_MANY_FILES}).` });
  }

  return { allowed: true, reason: permission.reason, files, skipped, totalBytes };
}

export async function readMarkdownBundleTool(options: LocalToolOptions & { path?: string; limit?: number; maxBytesPerFile?: number; maxTotalBytes?: number }): Promise<ReadMarkdownBundleResult> {
  const requestedPath = options.path ?? ".";
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "read_markdown_bundle",
      target: requestedPath,
      reason: "Discover and read local project Markdown files requested by the agent.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason, files: [], skipped: [], totalBytes: 0, manifest: [], truncatedFiles: [] };
  }

  const resolvedPath = await resolveReadableProjectPath(options, requestedPath);
  const rootStat = await statReadableProjectPath(resolvedPath);
  if (!rootStat) {
    return { allowed: false, reason: "Path does not exist.", files: [], skipped: [], totalBytes: 0, manifest: [], truncatedFiles: [] };
  }

  const limit = Math.min(Math.max(options.limit ?? MAX_INTERNAL_READ_MANY_FILES, 1), MAX_INTERNAL_READ_MANY_FILES);
  const markdownPaths = (await discoverMarkdownFiles(options, resolvedPath)).sort(compareMarkdownBundlePaths).slice(0, limit);
  const readResult = await readManyLocalFilesTool({
    paths: options.paths,
    pathsToRead: markdownPaths,
    maxBytesPerFile: options.maxBytesPerFile,
    maxTotalBytes: options.maxTotalBytes,
    approver: options.approver,
    policy: options.policy,
  });

  return {
    ...readResult,
    reason: permission.reason,
    manifest: markdownPaths,
    truncatedFiles: readResult.files.filter((file) => file.truncated).map((file) => file.path),
  };
}

export async function readGitStatusTool(options: LocalToolOptions & GitReadOptions): Promise<ReadGitStatusResult> {
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "read_git_status",
      target: options.repoPath ?? options.path ?? "local git status",
      reason: "Inspect local repository status requested by the agent.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason, output: "" };
  }

  const output = await runGitReadCommand(options, ["status", "--short"]);
  if (!output.ok) {
    return { allowed: false, reason: output.message, output: "" };
  }

  return { allowed: true, reason: permission.reason, output: output.output };
}

export async function readGitDiffTool(options: LocalToolOptions & GitReadOptions & { staged?: boolean; maxBytes?: number }): Promise<ReadGitDiffResult> {
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "read_git_diff",
      target: options.repoPath ?? options.path ?? (options.staged ? "staged git diff" : "local git diff"),
      reason: "Inspect local repository diff requested by the agent.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason, output: "", truncated: false };
  }

  const maxBytes = Math.min(Math.max(options.maxBytes ?? MAX_INTERNAL_GIT_DIFF_BYTES, 1), MAX_INTERNAL_GIT_DIFF_BYTES);
  const output = await runGitReadCommand(options, ["--no-pager", "diff", ...(options.staged ? ["--staged"] : [])]);
  if (!output.ok) {
    return { allowed: false, reason: output.message, output: "", truncated: false };
  }

  const buffer = Buffer.from(output.output, "utf8");
  const truncated = buffer.length > maxBytes;
  return { allowed: true, reason: truncated ? `Read first ${maxBytes} bytes; diff is larger.` : permission.reason, output: buffer.subarray(0, maxBytes).toString("utf8"), truncated };
}

export async function readGitLogTool(options: LocalToolOptions & GitReadOptions & { limit?: number }): Promise<ReadGitLogResult> {
  const permission = await reviewActionPermission(
    {
      category: "read",
      action: "read_git_log",
      target: options.repoPath ?? options.path ?? "local git log",
      reason: "Inspect local repository commit history requested by the agent.",
      trusted: true,
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );

  if (permission.decision !== "allow") {
    return { allowed: false, reason: permission.reason, output: "" };
  }

  const limit = Math.min(Math.max(options.limit ?? 10, 1), MAX_INTERNAL_GIT_LOG_COMMITS);
  const output = await runGitReadCommand(options, ["--no-pager", "log", `--max-count=${limit}`, "--oneline", "--decorate"]);
  if (!output.ok) {
    return { allowed: false, reason: output.message, output: "" };
  }

  return { allowed: true, reason: permission.reason, output: output.output };
}

async function runGitReadCommand(options: LocalToolOptions, args: string[]): Promise<{ ok: true; output: string } | { ok: false; message: string }> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: await resolveGitReadDirectory(options), encoding: "utf8", timeout: 10_000, maxBuffer: MAX_INTERNAL_GIT_DIFF_BYTES * 2 });
    return { ok: true, output: stdout.trimEnd() };
  } catch (error) {
    if (error instanceof Error) {
      return { ok: false, message: `Git read command failed: ${error.message}` };
    }
    return { ok: false, message: "Git read command failed: Unknown git error." };
  }
}

async function discoverMarkdownFiles(options: LocalToolOptions, startPath: string): Promise<string[]> {
  const markdownPaths: string[] = [];

  async function visit(currentPath: string): Promise<void> {
    const currentStat = await statReadableProjectPath(currentPath);
    if (!currentStat) {
      return;
    }

    const relativePath = formatWorkspaceRelativePath(options.config, options.paths, currentPath);

    if (relativePath && isIgnoredProjectPath(relativePath)) {
      return;
    }

    if (currentStat.isFile()) {
      if (relativePath.toLowerCase().endsWith(".md")) {
        markdownPaths.push(relativePath);
      }
      return;
    }

    if (!currentStat.isDirectory()) {
      return;
    }

    const entries = await readReadableProjectDirectory(currentPath);
    if (!entries) {
      return;
    }

    for (const entry of entries) {
      if (shouldSkipSearchEntry(entry.name)) {
        continue;
      }

      await visit(resolve(currentPath, entry.name));
    }
  }

  await visit(startPath);
  return markdownPaths;
}

async function statReadableProjectPath(path: string): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function readReadableProjectFile(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function readReadableProjectDirectory(path: string): Promise<Array<Dirent<string>> | undefined> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function compareMarkdownBundlePaths(left: string, right: string): number {
  const priority = (value: string): number => {
    const normalized = value.toLowerCase();
    const rootOrder = ["readme.md", "project.md", "agents.md", "gemini.md"];
    const rootIndex = rootOrder.indexOf(normalized);
    if (rootIndex >= 0) return rootIndex;
    if (!normalized.includes("/")) return 10;
    if (normalized.startsWith("docs/")) return 20;
    return 30;
  };

  return priority(left) - priority(right) || left.localeCompare(right);
}

function createFileSearchMatcher(query: string): (relativePath: string, name: string) => boolean {
  const normalizedQuery = query.toLowerCase();

  if (normalizedQuery.includes("*")) {
    const pattern = `^${normalizedQuery.split("*").map(escapeRegex).join(".*")}$`;
    const regex = new RegExp(pattern);
    return (relativePath, name) => regex.test(name.toLowerCase()) || regex.test(relativePath.toLowerCase());
  }

  return (relativePath, name) => name.toLowerCase().includes(normalizedQuery) || relativePath.toLowerCase().includes(normalizedQuery);
}

function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function shouldSkipSearchEntry(name: string): boolean {
  return [".git", "node_modules", "dist", "coverage"].includes(name);
}

function isIgnoredProjectPath(relativePath: string): boolean {
  return relativePath.split(/[\\/]/).some(shouldSkipSearchEntry);
}

function resolveReadableProjectPath(options: LocalToolOptions, inputPath: string): Promise<string> {
  return resolveSandboxPath({ config: options.config, paths: options.paths, inputPath, defaultBase: "root", access: "read" });
}

async function resolveGitReadDirectory(options: LocalToolOptions): Promise<string> {
  const requestedPath = "repoPath" in options && typeof options.repoPath === "string"
    ? options.repoPath
    : "path" in options && typeof options.path === "string"
      ? options.path
      : undefined;
  if (requestedPath?.trim()) {
    return resolveSandboxPath({ config: options.config, paths: options.paths, inputPath: requestedPath, defaultBase: "root", access: "read" });
  }

  const explicitWorkspace = process.env.BESTIE_WORKSPACE_DIR ?? options.config?.workspace?.defaultPath;
  if (explicitWorkspace?.trim()) {
    return isAbsolute(explicitWorkspace) ? resolve(explicitWorkspace) : resolve(options.paths.rootDir, explicitWorkspace);
  }

  const candidates = [options.paths.rootDir, process.cwd()].map((value) => resolve(value));

  for (const candidate of candidates) {
    if (await isGitWorkingTree(candidate)) {
      return candidate;
    }
  }

  return options.paths.rootDir;
}

async function isGitWorkingTree(directory: string): Promise<boolean> {
  try {
    await access(resolve(directory, ".git"));
    return true;
  } catch {
    return false;
  }
}

function resolveReadableListPath(options: LocalToolOptions, inputPath: string): Promise<string> {
  const defaultBase = isDefaultListPath(inputPath) ? "workspace" : "root";
  return resolveSandboxPath({ config: options.config, paths: options.paths, inputPath, defaultBase, access: "read" });
}

function isDefaultListPath(inputPath: string): boolean {
  return inputPath === ".";
}
