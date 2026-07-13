import type { StoredMemory } from "../memory/sqlite-store.js";
import type { ChatMessage } from "../llm/types.js";

const MAX_RECENT_TURNS = 12;
export const MEMORY_CONTEXT_ITEM_LIMIT = 50;
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
    .slice(0, MEMORY_CONTEXT_ITEM_LIMIT)
    .map((memory) => `- ${memory.type}: ${memory.content}`)
    .filter(createMemoryContextBudgetFilter(MEMORY_CONTEXT_PREFIX.length));

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

function createMemoryContextBudgetFilter(initialChars: number): (line: string) => boolean {
  let usedChars = initialChars;

  return (line) => {
    const nextChars = usedChars + 1 + line.length;
    if (nextChars > MEMORY_CONTEXT_CHAR_LIMIT) {
      return false;
    }

    usedChars = nextChars;
    return true;
  };
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