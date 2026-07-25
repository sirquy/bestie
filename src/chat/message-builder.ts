import type { KnowledgeGraphSearchResult, StoredMemory } from "../memory/sqlite-store.js";
import type { ChatMessage } from "../llm/types.js";
import type { AppConfig, MemoryRetrievalPolicy } from "../runtime/config.js";
import { compareKnowledgeTrustPriority, formatKnowledgeTrustFlags } from "../memory/knowledge-trust.js";

export const MAX_RECENT_TURNS = 240;
const MIN_RECENT_TURNS = 4;
const MAX_CONFIGURED_RECENT_TURNS = 400;
export const MEMORY_CONTEXT_CHAR_LIMIT = 48_000;
export const KNOWLEDGE_CONTEXT_CHAR_LIMIT = 24_000;
const MEMORY_CONTEXT_PREFIX = "Approved local memories for this user. Use them when relevant; do not claim perfect memory.";
const GOVERNED_MEMORY_CONTEXT_PREFIX = "Approved local memories for this user, organized by memory governance. Use current high-confidence memories first; treat flagged stale, superseded, or conflicting memories cautiously. Do not claim perfect memory.";
const KNOWLEDGE_CONTEXT_PREFIX = "Relevant approved local knowledge graph facts, ordered by trust. Use high-trust facts first; treat low-trust, stale, weak-source, or conflicting facts cautiously. Do not claim perfect memory.";

export interface BuildChatMessagesOptions {
  memoryRetrievalPolicy?: MemoryRetrievalPolicy;
  knowledgeGraph?: KnowledgeGraphSearchResult;
  conversationSummary?: ChatMessage[];
  recentMessageLimit?: number;
}

export function buildChatMessages(systemPrompt: string, recentTurns: ChatMessage[], userInput: string, memories: StoredMemory[] = [], options: BuildChatMessagesOptions = {}): ChatMessage[] {
  const recentMessageLimit = normalizeRecentMessageLimit(options.recentMessageLimit);
  return [
    { role: "system", content: systemPrompt },
    ...buildMemoryContextMessages(memories, options.memoryRetrievalPolicy ?? "full"),
    ...buildKnowledgeContextMessages(options.knowledgeGraph),
    ...(options.conversationSummary ?? []),
    ...recentTurns.slice(-recentMessageLimit),
    { role: "user", content: userInput },
  ];
}

export function getRecentMessageLimit(config: Pick<AppConfig, "memory"> | undefined): number {
  return normalizeRecentMessageLimit(config?.memory?.recentMessageLimit);
}

function buildKnowledgeContextMessages(graph: KnowledgeGraphSearchResult | undefined): ChatMessage[] {
  if (!graph || (graph.entities.length === 0 && graph.relations.length === 0)) {
    return [];
  }

  const lines = [
    ...graph.relations.map((relation) => ({ kind: "relation" as const, item: relation })),
    ...graph.entities.map((entity) => ({ kind: "entity" as const, item: entity })),
  ].sort((left, right) => compareKnowledgeTrustPriority(left.item, right.item)).map((fact) => fact.kind === "relation" ? formatKnowledgeRelationLine(fact.item) : formatKnowledgeEntityLine(fact.item));

  if (lines.length === 0) {
    return [];
  }

  return [{ role: "system", content: buildBoundedContextBlock(KNOWLEDGE_CONTEXT_PREFIX, lines, KNOWLEDGE_CONTEXT_CHAR_LIMIT, "lower-trust knowledge graph facts") }];
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

  const prefix = policy === "governed" ? GOVERNED_MEMORY_CONTEXT_PREFIX : MEMORY_CONTEXT_PREFIX;

  return [
    {
      role: "system",
      content: buildBoundedContextBlock(prefix, memoryLines, MEMORY_CONTEXT_CHAR_LIMIT, "lower-priority memory entries"),
    },
  ];
}

function buildBoundedContextBlock(prefix: string, lines: string[], maxChars: number, omittedLabel: string): string {
  const selected: string[] = [];
  let usedChars = prefix.length;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const omittedCount = lines.length - index - 1;
    const omittedLine = omittedCount > 0 ? formatOmittedContextLine(omittedCount, omittedLabel) : "";
    const reservedChars = omittedLine ? 1 + omittedLine.length : 0;
    const nextChars = 1 + line.length;

    if (usedChars + nextChars + reservedChars <= maxChars) {
      selected.push(line);
      usedChars += nextChars;
      continue;
    }

    if (selected.length === 0) {
      const truncatedLine = truncateContextLine(line, Math.max(0, maxChars - prefix.length - reservedChars - 1));
      if (truncatedLine) selected.push(truncatedLine);
    }
    break;
  }

  const omittedCount = Math.max(0, lines.length - selected.length);
  const nextLines = [...selected];
  if (omittedCount > 0) {
    nextLines.push(formatOmittedContextLine(omittedCount, omittedLabel));
  }

  const content = `${prefix}\n${nextLines.join("\n")}`;
  return content.length <= maxChars ? content : content.slice(0, maxChars).trimEnd();
}

function formatOmittedContextLine(count: number, label: string): string {
  return `- [context truncated: ${count} ${label} omitted]`;
}

function truncateContextLine(line: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (line.length <= maxChars) return line;
  if (maxChars <= 3) return line.slice(0, maxChars);
  return `${line.slice(0, maxChars - 3).trimEnd()}...`;
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

  const usage = right.accessCount - left.accessCount;
  if (usage !== 0) {
    return usage;
  }

  const lastAccessed = parseOptionalTime(right.lastAccessedAt) - parseOptionalTime(left.lastAccessedAt);
  if (lastAccessed !== 0) {
    return lastAccessed;
  }

  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function parseOptionalTime(value: string | undefined): number {
  return value ? Date.parse(value) : 0;
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

export function appendConversationTurn(recentTurns: ChatMessage[], userInput: string, assistantText: string, recentMessageLimit = MAX_RECENT_TURNS): ChatMessage[] {
  const nextTurns: ChatMessage[] = [
    ...recentTurns,
    { role: "user", content: userInput },
    { role: "assistant", content: assistantText },
  ];

  return nextTurns.slice(-normalizeRecentMessageLimit(recentMessageLimit));
}

function normalizeRecentMessageLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return MAX_RECENT_TURNS;
  }

  return Math.min(MAX_CONFIGURED_RECENT_TURNS, Math.max(MIN_RECENT_TURNS, Math.trunc(value)));
}
