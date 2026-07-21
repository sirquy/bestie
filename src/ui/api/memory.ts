import { access } from "node:fs/promises";

import { SqliteMemoryStore, type PendingMemory, type StoredMemory } from "../../memory/sqlite-store.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

export interface UiMemorySummary {
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
  };
  memories: UiMemoryItem[];
  pending: UiPendingMemoryItem[];
}

export interface UiMemorySearchResult extends UiMemorySummary {
  query: string;
}

export interface UiMemoryActionOptions {
  action: "approve_pending" | "reject_pending";
  id: number;
  confirm: boolean;
  paths?: RuntimePaths;
}

export interface UiMemoryItem {
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

export interface UiPendingMemoryItem {
  id: number;
  type: string;
  content: string;
  reason?: string;
  source?: string;
  explicitConsent: boolean;
  createdAt: string;
}

export async function getUiMemorySummary(paths: RuntimePaths = getRuntimePaths(), limit = 20): Promise<UiMemorySummary> {
  const databaseExists = await fileExists(paths.memoryDbPath);
  if (!databaseExists) {
    return emptyMemorySummary(paths);
  }

  const store = await SqliteMemoryStore.open(paths);
  try {
    const active = store.listActiveMemories(limit);
    const pending = store.listPendingMemories(limit);
    return buildMemorySummary(paths, store, active, pending, databaseExists);
  } finally {
    store.close();
  }
}

export async function searchUiMemories(query: string, paths: RuntimePaths = getRuntimePaths(), limit = 20): Promise<UiMemorySearchResult> {
  const databaseExists = await fileExists(paths.memoryDbPath);
  if (!databaseExists || query.trim().length === 0) {
    return { ...emptyMemorySummary(paths), query };
  }

  const store = await SqliteMemoryStore.open(paths);
  try {
    const active = store.searchMemories(query, limit);
    const pending = store.searchPendingMemories(query, limit);
    return { ...buildMemorySummary(paths, store, active, pending, databaseExists), query };
  } finally {
    store.close();
  }
}

export async function runUiMemoryAction(options: UiMemoryActionOptions): Promise<UiMemorySummary> {
  if (!options.confirm) {
    throw new Error("Memory actions require confirm=true.");
  }

  const paths = options.paths ?? getRuntimePaths();
  const store = await SqliteMemoryStore.open(paths);
  try {
    if (options.action === "approve_pending") {
      const approved = store.approvePendingMemory(options.id);
      if (!approved) {
        throw new Error(`Pending memory not found: ${options.id}`);
      }
    } else if (options.action === "reject_pending") {
      if (!store.rejectPendingMemory(options.id)) {
        throw new Error(`Pending memory not found: ${options.id}`);
      }
    }

    const active = store.listActiveMemories(20);
    const pending = store.listPendingMemories(20);
    return buildMemorySummary(paths, store, active, pending, true);
  } finally {
    store.close();
  }
}

function buildMemorySummary(paths: RuntimePaths, store: SqliteMemoryStore, memories: StoredMemory[], pending: PendingMemory[], databaseExists: boolean): UiMemorySummary {
  const allActive = store.listActiveMemories();
  return {
    ok: true,
    database: { exists: databaseExists, path: paths.memoryDbPath },
    state: store.getMemoryState(),
    counts: {
      active: allActive.length,
      pending: store.listPendingMemories(1000).length,
      core: allActive.filter((memory) => memory.scope === "core").length,
      project: allActive.filter((memory) => memory.scope === "project").length,
      session: allActive.filter((memory) => memory.scope === "session").length,
    },
    memories: memories.map(toUiMemoryItem),
    pending: pending.map(toUiPendingMemoryItem),
  };
}

function emptyMemorySummary(paths: RuntimePaths): UiMemorySummary {
  return {
    ok: true,
    database: { exists: false, path: paths.memoryDbPath },
    state: { paused: false },
    counts: { active: 0, pending: 0, core: 0, project: 0, session: 0 },
    memories: [],
    pending: [],
  };
}

function toUiMemoryItem(memory: StoredMemory): UiMemoryItem {
  return {
    id: memory.id,
    type: memory.type,
    content: memory.content,
    sensitivity: memory.sensitivity,
    importance: memory.importance,
    ...(memory.source === undefined ? {} : { source: memory.source }),
    pinned: memory.pinned,
    scope: memory.scope,
    confidence: memory.confidence,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

function toUiPendingMemoryItem(memory: PendingMemory): UiPendingMemoryItem {
  return {
    id: memory.id,
    type: memory.type,
    content: memory.content,
    ...(memory.reason === undefined ? {} : { reason: memory.reason }),
    ...(memory.source === undefined ? {} : { source: memory.source }),
    explicitConsent: memory.explicitConsent,
    createdAt: memory.createdAt,
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}