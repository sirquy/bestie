import type { RuntimePaths } from "../runtime/paths.js";
import { SqliteMemoryStore, type StoredMemory } from "./sqlite-store.js";

const DEFAULT_RELEVANT_MEMORY_LIMIT = 32;
const DEFAULT_ANCHOR_MEMORY_LIMIT = 32;
const MAX_COMPACT_QUERY_TOKENS = 8;
const MAX_FALLBACK_QUERY_TOKENS = 4;
const MEMORY_QUERY_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "cho", "cua", "của", "did", "do", "does", "for", "from", "gi", "gì", "he", "hiện", "hoi", "hỏi", "i", "in", "is", "it", "ko", "khong", "không", "la", "là", "me", "minh", "mình", "mot", "một", "nay", "này", "nhỉ", "noi", "nói", "of", "on", "or", "that", "the", "thi", "thì", "toi", "tôi", "to", "ve", "về", "was", "were", "what", "when", "where", "which", "who", "why", "with", "you",
]);

export interface LoadRelevantMemoriesOptions {
  query?: string;
  limit?: number;
  anchorLimit?: number;
  namespace?: string;
}

export async function loadRelevantMemories(paths: RuntimePaths, options: LoadRelevantMemoriesOptions = {}): Promise<StoredMemory[]> {
  const store = await SqliteMemoryStore.open(paths);

  try {
    if (store.getMemoryState().paused) {
      return [];
    }

    const memories = selectRelevantMemories(store, options);
    store.recordMemoryAccess(memories.map((memory) => memory.id));
    return memories;
  } finally {
    store.close();
  }
}

export function selectRelevantMemories(store: Pick<SqliteMemoryStore, "searchMemories" | "listActiveMemories">, options: LoadRelevantMemoriesOptions = {}): StoredMemory[] {
  const limit = normalizePositiveInteger(options.limit, DEFAULT_RELEVANT_MEMORY_LIMIT);
  const anchorLimit = normalizePositiveInteger(options.anchorLimit, DEFAULT_ANCHOR_MEMORY_LIMIT);
  const query = options.query?.trim() ?? "";
  const searched = query ? searchRelevantMemoryCandidates(store, query, limit, options.namespace ?? "primary") : [];
  const namespace = options.namespace ?? "primary";
  const anchors = store.listActiveMemories(Math.max(anchorLimit, anchorLimit * 4), namespace).sort(compareMemoryAnchorPriority).slice(0, anchorLimit);
  const byId = new Map<number, StoredMemory>();

  for (const memory of [...searched, ...anchors]) {
    byId.set(memory.id, memory);
    if (byId.size >= limit) {
      break;
    }
  }

  return [...byId.values()];
}

function searchRelevantMemoryCandidates(store: Pick<SqliteMemoryStore, "searchMemories">, query: string, limit: number, namespace: string): StoredMemory[] {
  const byId = new Map<number, StoredMemory>();
  for (const candidateQuery of buildMemoryContextSearchQueries(query)) {
    for (const memory of store.searchMemories(candidateQuery, limit, namespace)) {
      byId.set(memory.id, memory);
      if (byId.size >= limit) {
        return [...byId.values()];
      }
    }
  }
  return [...byId.values()];
}

function buildMemoryContextSearchQueries(query: string): string[] {
  const tokens = Array.from(query.matchAll(/[\p{L}\p{N}_]+/gu), (match) => match[0])
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 2 && !MEMORY_QUERY_STOP_WORDS.has(token));
  const deduped = [...new Set(tokens)];
  if (deduped.length === 0) {
    return [query];
  }

  const compact = deduped.slice(0, MAX_COMPACT_QUERY_TOKENS).join(" ");
  const fallbacks = deduped
    .filter((token) => token.length >= 4)
    .sort((left, right) => right.length - left.length)
    .slice(0, MAX_FALLBACK_QUERY_TOKENS);

  return [...new Set([compact, ...fallbacks])];
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.trunc(value));
}

function compareMemoryAnchorPriority(left: StoredMemory, right: StoredMemory): number {
  const pinned = Number(right.pinned) - Number(left.pinned);
  if (pinned !== 0) return pinned;

  const importance = right.importance - left.importance;
  if (importance !== 0) return importance;

  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}
