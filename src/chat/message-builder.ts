import type { StoredMemory } from "../memory/sqlite-store.js";
import type { ChatMessage } from "../llm/types.js";
import type { MemoryRetrievalPolicy } from "../runtime/config.js";

const MAX_RECENT_TURNS = 12;
export const MEMORY_CONTEXT_CHAR_LIMIT = 12_000;
const MEMORY_CONTEXT_PREFIX = "Approved local memories for this user. Use them when relevant; do not claim perfect memory.";
const GOVERNED_MEMORY_CONTEXT_PREFIX = "Approved local memories for this user, organized by memory governance. Use current high-confidence memories first; treat flagged stale, superseded, or conflicting memories cautiously. Do not claim perfect memory.";

export interface BuildChatMessagesOptions {
  memoryRetrievalPolicy?: MemoryRetrievalPolicy;
}

export function buildChatMessages(systemPrompt: string, recentTurns: ChatMessage[], userInput: string, memories: StoredMemory[] = [], options: BuildChatMessagesOptions = {}): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt },
    ...buildMemoryContextMessages(memories, options.memoryRetrievalPolicy ?? "full"),
    ...recentTurns.slice(-MAX_RECENT_TURNS),
    { role: "user", content: userInput },
  ];
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