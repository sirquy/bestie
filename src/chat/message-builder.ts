import type { StoredMemory } from "../memory/sqlite-store.js";
import type { ChatMessage } from "../llm/types.js";

const MAX_RECENT_TURNS = 12;
export const MEMORY_CONTEXT_CHAR_LIMIT = 12_000;
const MEMORY_CONTEXT_PREFIX = "Approved local memories for this user. Use them when relevant; do not claim perfect memory.";

export function buildChatMessages(systemPrompt: string, recentTurns: ChatMessage[], userInput: string, memories: StoredMemory[] = []): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt },
    ...buildMemoryContextMessages(memories),
    ...recentTurns.slice(-MAX_RECENT_TURNS),
    { role: "user", content: userInput },
  ];
}

function buildMemoryContextMessages(memories: StoredMemory[]): ChatMessage[] {
  const memoryLines = memories
    .filter((memory) => memory.status === "active")
    .sort(compareMemoryContextPriority)
    .map((memory) => `- #${memory.id} [${memory.type}] ${memory.content}`);

  if (memoryLines.length === 0) {
    return [];
  }

  return [
    {
      role: "system",
      content: `${MEMORY_CONTEXT_PREFIX}\n${memoryLines.join("\n")}`,
    },
  ];
}

function compareMemoryContextPriority(left: StoredMemory, right: StoredMemory): number {
  const importance = right.importance - left.importance;
  if (importance !== 0) {
    return importance;
  }

  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

export function appendConversationTurn(recentTurns: ChatMessage[], userInput: string, assistantText: string): ChatMessage[] {
  const nextTurns: ChatMessage[] = [
    ...recentTurns,
    { role: "user", content: userInput },
    { role: "assistant", content: assistantText },
  ];

  return nextTurns.slice(-MAX_RECENT_TURNS);
}