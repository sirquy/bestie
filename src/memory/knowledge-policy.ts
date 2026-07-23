import { containsSecretLikeValue } from "../runtime/secret-redaction.js";
import type { KnowledgeEntityKind, KnowledgeSensitivity } from "./sqlite-store.js";

export const KNOWLEDGE_ENTITY_KINDS: KnowledgeEntityKind[] = [
  "person",
  "project",
  "preference",
  "tool",
  "skill",
  "topic",
  "organization",
  "location",
  "decision",
  "concept",
];

export interface KnowledgePolicyResult {
  decision: "store" | "pending" | "never";
  sensitivity: KnowledgeSensitivity;
  reason: string;
}

export function isKnowledgeEntityKind(value: string | undefined): value is KnowledgeEntityKind {
  return value !== undefined && (KNOWLEDGE_ENTITY_KINDS as string[]).includes(value);
}

export function evaluateKnowledgePayload(payload: unknown, sensitivity: KnowledgeSensitivity = "normal", explicitConsent = false): KnowledgePolicyResult {
  const text = JSON.stringify(payload);
  if (!text || text === "{}" || text === "[]") {
    return { decision: "never", sensitivity: "normal", reason: "Empty knowledge graph payload is ignored." };
  }

  if (sensitivity === "secret" || containsSecretLikeValue(text) || containsSecretLikePattern(text)) {
    return { decision: "never", sensitivity: "secret", reason: "Secrets, tokens, passwords, and payment details must never be stored in the knowledge graph." };
  }

  if (sensitivity === "sensitive" && !explicitConsent) {
    return { decision: "pending", sensitivity: "sensitive", reason: "Sensitive knowledge graph items require approval before storage." };
  }

  return { decision: "store", sensitivity, reason: "Durable non-secret knowledge graph item is allowed by the local memory policy." };
}

function containsSecretLikePattern(content: string): boolean {
  return [
    /password\s*[:=]/i,
    /api[_ -]?key\s*[:=]/i,
    /token\s*[:=]/i,
    /sk-[A-Za-z0-9_-]{12,}/,
    /(?:\d[ -]*?){13,19}/,
  ].some((pattern) => pattern.test(content));
}
