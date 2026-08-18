import type { ChatCompletionOptions, ChatMessage } from "../llm/types.js";
import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { evaluateMemoryCandidate, type MemoryType } from "./policy.js";
import { SqliteMemoryStore, type PendingMemory, type StoredMemory } from "./sqlite-store.js";

export type MemoryReasoningChatCompletion = (config: AppConfig, apiKey: string, options: ChatCompletionOptions) => Promise<string>;

export interface MemoryReasoningTurn {
  channel: "terminal" | "telegram" | "zalo" | "zalo-personal";
  userId?: string;
  userInput: string;
  assistantText: string;
}

export interface MemoryReasoningResult {
  stored: StoredMemory[];
  pending: PendingMemory[];
  skipped: Array<{ content: string; reason: string }>;
}

interface ParsedMemoryCandidate {
  type: MemoryType;
  content: string;
  reason?: string;
  confidence?: number;
}

const MAX_REASONED_CANDIDATES = 3;

export async function runMemoryReasoningPass(options: {
  config: AppConfig;
  paths: RuntimePaths;
  apiKey: string;
  turn: MemoryReasoningTurn;
  chatCompletion: MemoryReasoningChatCompletion;
}): Promise<MemoryReasoningResult> {
  const store = await SqliteMemoryStore.open(options.paths);

  try {
    if (store.getMemoryState().paused) {
      return emptyReasoningResult();
    }

    const writePolicy = options.config.memory?.writePolicy;
    if (!writePolicy) {
      return emptyReasoningResult();
    }

    if (writePolicy === "deny") {
      return emptyReasoningResult();
    }

    const response = await options.chatCompletion(options.config, options.apiKey, { messages: buildMemoryReasoningMessages(options.turn) });
    const candidates = parseMemoryReasoningCandidates(response).slice(0, MAX_REASONED_CANDIDATES);
    const existingContents = new Set([
      ...store.listActiveMemories(100).map((memory) => normalizeMemoryContent(memory.content)),
      ...store.listPendingMemories(100).map((memory) => normalizeMemoryContent(memory.content)),
    ]);
    const result = emptyReasoningResult();

    for (const candidate of candidates) {
      const normalizedContent = normalizeMemoryContent(candidate.content);
      if (!normalizedContent) {
        continue;
      }

      if (existingContents.has(normalizedContent)) {
        result.skipped.push({ content: candidate.content, reason: "Duplicate memory candidate." });
        continue;
      }

      const policy = evaluateMemoryCandidate({ type: candidate.type, content: candidate.content, explicitConsent: false });
      if (policy.decision === "never" || policy.sensitivity === "secret") {
        result.skipped.push({ content: candidate.content, reason: policy.reason });
        continue;
      }

      const reason = candidate.reason ? `${policy.reason} Reasoned from conversation: ${candidate.reason}` : policy.reason;
      if (writePolicy === "allow" && policy.decision === "store") {
        result.stored.push(store.addMemory({ type: candidate.type, content: candidate.content, sensitivity: policy.sensitivity, source: `reasoning:${options.turn.channel}`, explicitConsent: false, policyReason: reason }));
      } else {
        result.pending.push(store.addPendingMemory({ type: candidate.type, content: candidate.content, reason, source: `reasoning:${options.turn.channel}`, explicitConsent: false }));
      }

      existingContents.add(normalizedContent);
    }

    return result;
  } finally {
    store.close();
  }
}

function buildMemoryReasoningMessages(turn: MemoryReasoningTurn): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are Bestie's memory reasoning pass.",
        "Decide whether the latest completed conversation contains durable memory worth proposing. Memory is for conversational continuity, user preferences, project context, and durable decisions; it is not a transcript archive.",
        "Return only JSON: {\"candidates\":[{\"type\":\"preference|communication_preference|user_fact|project_context|durable_decision|sensitive_personal|one_off|secret\",\"content\":\"...\",\"reason\":\"...\",\"confidence\":0.0}]}",
        "Use candidates: [] when there is nothing durable.",
        "Never propose secrets, tokens, passwords, payment data, or one-off emotions as durable memory.",
        "Do not save the assistant's own acknowledgment, plan, tool result, or success message as memory unless the user explicitly made it a durable preference or decision.",
        "Do not save facts that belong in the knowledge graph as a relationship unless they also affect future conversational behavior.",
        "Prefer concise first-person-neutral facts about the user, project, preferences, or durable decisions. Content must stand alone without needing the original chat log.",
        "Use confidence below 0.65 for weak, inferred, ambiguous, or assistant-originated claims so they can be ignored by policy.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [`Channel: ${turn.channel}`, turn.userId ? `User id: ${turn.userId}` : undefined, `User: ${turn.userInput}`, `Assistant: ${turn.assistantText}`].filter(Boolean).join("\n"),
    },
  ];
}

function parseMemoryReasoningCandidates(text: string): ParsedMemoryCandidate[] {
  const rawJson = extractJsonObject(text.trim());
  if (!rawJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.candidates)) {
      return [];
    }

    return parsed.candidates.flatMap((candidate) => {
      if (!isRecord(candidate) || typeof candidate.type !== "string" || typeof candidate.content !== "string" || !isMemoryType(candidate.type)) {
        return [];
      }

      return [{ type: candidate.type, content: candidate.content.trim(), reason: typeof candidate.reason === "string" ? candidate.reason : undefined, confidence: typeof candidate.confidence === "number" ? candidate.confidence : undefined }];
    });
  } catch {
    return [];
  }
}

function extractJsonObject(text: string): string | undefined {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const value = fenced?.[1]?.trim() ?? text;
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  return start === -1 || end === -1 || end <= start ? undefined : value.slice(start, end + 1);
}

function emptyReasoningResult(): MemoryReasoningResult {
  return { stored: [], pending: [], skipped: [] };
}

function normalizeMemoryContent(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

function isMemoryType(value: string): value is MemoryType {
  return ["preference", "communication_preference", "user_fact", "project_context", "durable_decision", "sensitive_personal", "one_off", "secret"].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
