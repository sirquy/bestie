import type { KnowledgeGraphSearchResult, StoredMemory } from "../memory/sqlite-store.js";
import type { ChatMessage } from "../llm/types.js";
import type { MemoryRetrievalPolicy } from "../runtime/config.js";
import { compareKnowledgeTrustPriority, formatKnowledgeTrustFlags } from "../memory/knowledge-trust.js";

export const MAX_RECENT_TURNS = 40;
export const MEMORY_CONTEXT_CHAR_LIMIT = 12_000;
const MEMORY_CONTEXT_PREFIX = "Approved local memories for this user. Use them when relevant; do not claim perfect memory.";
const GOVERNED_MEMORY_CONTEXT_PREFIX = "Approved local memories for this user, organized by memory governance. Use current high-confidence memories first; treat flagged stale, superseded, or conflicting memories cautiously. Do not claim perfect memory.";
const KNOWLEDGE_CONTEXT_PREFIX = "Relevant approved local knowledge graph facts, ordered by trust. Use high-trust facts first; treat low-trust, stale, weak-source, or conflicting facts cautiously. Do not claim perfect memory.";

export interface BuildChatMessagesOptions {
  memoryRetrievalPolicy?: MemoryRetrievalPolicy;
  knowledgeGraph?: KnowledgeGraphSearchResult;
  conversationSummary?: ChatMessage[];
}

export function buildChatMessages(systemPrompt: string, recentTurns: ChatMessage[], userInput: string, memories: StoredMemory[] = [], options: BuildChatMessagesOptions = {}): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt },
    ...buildMemoryContextMessages(memories, options.memoryRetrievalPolicy ?? "full"),
    ...buildKnowledgeContextMessages(options.knowledgeGraph),
    ...(options.conversationSummary ?? []),
    ...recentTurns.slice(-MAX_RECENT_TURNS),
    { role: "user", content: userInput },
  ];
}

function buildKnowledgeContextMessages(graph: KnowledgeGraphSearchResult | undefined): ChatMessage[] {
  if (!graph || (graph.entities.length === 0 && graph.relations.length === 0)) {
    return [];
  }

  const lines = [
    ...graph.relations.map((relation) => ({ kind: "relation" as const, item: relation })),
    ...graph.entities.map((entity) => ({ kind: "entity" as const, item: entity })),
  ].sort((left, right) => compareKnowledgeTrustPriority(left.item, right.item)).slice(0, 20).map((fact) => fact.kind === "relation" ? formatKnowledgeRelationLine(fact.item) : formatKnowledgeEntityLine(fact.item));

  if (lines.length === 0) {
    return [];
  }

  return [{ role: "system", content: `${KNOWLEDGE_CONTEXT_PREFIX}\n${lines.join("\n")}` }];
}

function formatKnowledgeRelationLine(relation: KnowledgeGraphSearchResult["relations"][number]): string {
  const source = relation.sourceEntity.canonicalName;
  const target = relation.targetEntity.canonicalName;
  const evidence = relation.evidence ? ` evidence: ${relation.evidence}` : "";
  return `- relation #${relation.id}: ${source} --${relation.relationType}--> ${target} (${formatKnowledgeTrustFlags(relation)}${evidence})`;
}

function formatKnowledgeEntityLine(entity: KnowledgeGraphSearchResult["entities"][number]): string {
  const aliases = entity.aliases.length > 0 ? ` aliases:${entity.aliases.join(",")}` : "";
  return `- entity #${entity.id}: [${entity.kind}] ${entity.canonicalName} (${formatKnowledgeTrustFlags(entity)}${aliases})`;
}

function buildMemoryContextMessages(memories: StoredMemory[], policy: MemoryRetrievalPolicy): ChatMessage[] {
  const memoryLines = memories
    .filter((memory) => memory.status === "active")
    .sort(policy === "governed" ? compareGovernedMemoryContextPriority : compareMemoryContextPriority)
    .map((memory) => formatMemoryContextLine(memory, policy));

  if (memoryLines.length === 0) {
    return [];
  }

  return [
    {
      role: "system",
      content: `${policy === "governed" ? GOVERNED_MEMORY_CONTEXT_PREFIX : MEMORY_CONTEXT_PREFIX}\n${memoryLines.join("\n")}`,
    },
  ];
}

function formatMemoryContextLine(memory: StoredMemory, policy: MemoryRetrievalPolicy): string {
  if (policy === "full") {
    return `- #${memory.id} [${memory.type}] ${memory.content}`;
  }

  const flags = [
    memory.pinned ? "pinned" : undefined,
    memory.confidence < 0.5 ? `low-confidence:${memory.confidence}` : undefined,
    memory.expiresAt && Date.parse(memory.expiresAt) <= Date.now() ? `stale:expired ${memory.expiresAt}` : undefined,
    memory.supersededBy ? `superseded-by:#${memory.supersededBy}` : undefined,
    memory.scope !== "core" ? `scope:${memory.scope}` : undefined,
  ].filter((flag): flag is string => flag !== undefined);

  const suffix = flags.length === 0 ? "" : ` (${flags.join(", ")})`;
  return `- #${memory.id} [${memory.type}]${suffix} ${memory.content}`;
}

function compareMemoryContextPriority(left: StoredMemory, right: StoredMemory): number {
  const scope = memoryScopeRank(left) - memoryScopeRank(right);
  if (scope !== 0) {
    return scope;
  }

  const importance = right.importance - left.importance;
  if (importance !== 0) {
    return importance;
  }

  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function compareGovernedMemoryContextPriority(left: StoredMemory, right: StoredMemory): number {
  const pinned = Number(right.pinned) - Number(left.pinned);
  if (pinned !== 0) return pinned;

  const stale = Number(isGovernanceFlagged(left)) - Number(isGovernanceFlagged(right));
  if (stale !== 0) return stale;

  const confidence = right.confidence - left.confidence;
  if (confidence !== 0) return confidence;

  return compareMemoryContextPriority(left, right);
}

function isGovernanceFlagged(memory: StoredMemory): boolean {
  return Boolean(memory.supersededBy || (memory.expiresAt && Date.parse(memory.expiresAt) <= Date.now()) || memory.confidence < 0.5);
}

function memoryScopeRank(memory: StoredMemory): number {
  if (memory.scope === "core") return 0;
  if (memory.scope === "project") return 1;
  return 2;
}

export function appendConversationTurn(recentTurns: ChatMessage[], userInput: string, assistantText: string): ChatMessage[] {
  const nextTurns: ChatMessage[] = [
    ...recentTurns,
    { role: "user", content: userInput },
    { role: "assistant", content: assistantText },
  ];

  return nextTurns.slice(-MAX_RECENT_TURNS);
}
