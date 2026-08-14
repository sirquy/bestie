import type { RuntimePaths } from "../runtime/paths.js";
import { analyzeKnowledgeGraph } from "./knowledge-governance.js";
import { buildKnowledgeTrustMetrics, compareKnowledgeTrustPriority } from "./knowledge-trust.js";
import { SqliteMemoryStore, type KnowledgeEntity, type KnowledgeGraphSearchResult, type KnowledgeRelationWithEntities } from "./sqlite-store.js";

const DEFAULT_RELEVANT_KNOWLEDGE_LIMIT = 12;
const MAX_KNOWLEDGE_CANDIDATE_QUERIES = 8;
const KNOWLEDGE_QUERY_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "cho", "cua", "của", "did", "do", "does", "for", "from", "gi", "gì", "he", "hiện", "hoi", "hỏi", "i", "in", "is", "it", "ko", "khong", "không", "la", "là", "me", "minh", "mình", "mot", "một", "nay", "này", "nhỉ", "noi", "nói", "of", "on", "or", "that", "the", "thi", "thì", "toi", "tôi", "to", "ve", "về", "was", "were", "what", "when", "where", "which", "who", "why", "with", "you",
]);

export interface LoadRelevantKnowledgeGraphOptions {
  limit?: number;
}

export async function loadRelevantKnowledgeGraph(paths: RuntimePaths, query: string, options: LoadRelevantKnowledgeGraphOptions = {}): Promise<KnowledgeGraphSearchResult | undefined> {
  const store = await SqliteMemoryStore.open(paths);

  try {
    if (store.getMemoryState().paused) {
      return undefined;
    }

    const graph = selectRelevantKnowledgeGraph(store, query, options);
    return graph.entities.length === 0 && graph.relations.length === 0 ? undefined : graph;
  } finally {
    store.close();
  }
}

export function selectRelevantKnowledgeGraph(
  store: Pick<SqliteMemoryStore, "searchKnowledgeGraph">,
  query: string,
  options: LoadRelevantKnowledgeGraphOptions = {},
): KnowledgeGraphSearchResult {
  const limit = normalizePositiveInteger(options.limit, DEFAULT_RELEVANT_KNOWLEDGE_LIMIT);
  const candidateLimit = Math.max(limit * 3, DEFAULT_RELEVANT_KNOWLEDGE_LIMIT);
  const entities = new Map<number, KnowledgeEntity>();
  const relations = new Map<number, KnowledgeRelationWithEntities>();

  for (const candidateQuery of buildKnowledgeContextSearchQueries(query)) {
    const graph = store.searchKnowledgeGraph(candidateQuery, candidateLimit);
    for (const entity of graph.entities) entities.set(entity.id, entity);
    for (const relation of graph.relations) relations.set(relation.id, relation);
  }

  const analysis = analyzeKnowledgeGraph({ entities: [...entities.values()], relations: [...relations.values()], pending: [] });
  const conflictingRelationIds = new Set(analysis.conflictingRelations.flatMap((conflict) => conflict.relationIds));

  return {
    query: query.trim(),
    entities: [...entities.values()]
      .filter((entity) => entity.sensitivity !== "secret")
      .filter((entity) => buildKnowledgeTrustMetrics(entity).score >= 55)
      .sort(compareKnowledgeTrustPriority)
      .slice(0, limit),
    relations: [...relations.values()]
      .filter((relation) => !conflictingRelationIds.has(relation.id))
      .filter((relation) => relation.sensitivity !== "secret" && relation.sourceEntity.sensitivity !== "secret" && relation.targetEntity.sensitivity !== "secret")
      .filter((relation) => buildKnowledgeTrustMetrics(relation).score >= 55)
      .sort(compareKnowledgeTrustPriority)
      .slice(0, limit),
  };
}

function buildKnowledgeContextSearchQueries(query: string): string[] {
  const normalized = query.trim();
  if (!normalized) return [];

  const tokens = Array.from(normalized.matchAll(/[\p{L}\p{N}_]+/gu), (match) => match[0]!.toLocaleLowerCase())
    .filter((token) => token.length >= 2 && !KNOWLEDGE_QUERY_STOP_WORDS.has(token));
  const uniqueTokens = [...new Set(tokens)];
  if (uniqueTokens.length === 0) return [normalized];

  return [...new Set([uniqueTokens.slice(0, MAX_KNOWLEDGE_CANDIDATE_QUERIES).join(" "), ...uniqueTokens.slice(0, MAX_KNOWLEDGE_CANDIDATE_QUERIES)])];
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}
