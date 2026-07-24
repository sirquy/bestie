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
  diagnostics?: KnowledgePolicyDiagnostics;
}

export interface KnowledgePolicyDiagnostics {
  blockedBy: KnowledgePolicyBlockReason[];
}

export type KnowledgePolicyBlockReason = "explicit_secret_sensitivity" | "password_assignment" | "api_key_assignment" | "token_assignment" | "openai_key" | "bearer_token" | "long_secret_like_value" | "payment_card_like" | "secret_like_value";

export function explainKnowledgePolicyDiagnostics(diagnostics: KnowledgePolicyDiagnostics | undefined): string | undefined {
  const blockedBy = diagnostics?.blockedBy ?? [];
  if (blockedBy.length === 0) {
    return undefined;
  }

  const labels = [...new Set(blockedBy)].map(knowledgePolicyBlockReasonLabel);
  return `Blocked because the payload looks like it contains ${formatHumanList(labels)}. Remove the sensitive value from entities, relations, and evidence, then retry with only the durable non-secret fact.`;
}

export function isKnowledgeEntityKind(value: string | undefined): value is KnowledgeEntityKind {
  return value !== undefined && (KNOWLEDGE_ENTITY_KINDS as string[]).includes(value);
}

export function evaluateKnowledgePayload(payload: unknown, sensitivity: KnowledgeSensitivity = "normal", explicitConsent = false): KnowledgePolicyResult {
  const text = JSON.stringify(payload);
  if (!text || text === "{}" || text === "[]") {
    return { decision: "never", sensitivity: "normal", reason: "Empty knowledge graph payload is ignored." };
  }

  const blockedBy = knowledgePolicyBlockReasons(text, sensitivity);
  if (blockedBy.length > 0) {
    return { decision: "never", sensitivity: "secret", reason: "Secrets, tokens, passwords, and payment details must never be stored in the knowledge graph.", diagnostics: { blockedBy } };
  }

  if (sensitivity === "sensitive" && !explicitConsent) {
    return { decision: "pending", sensitivity: "sensitive", reason: "Sensitive knowledge graph items require approval before storage." };
  }

  return { decision: "store", sensitivity, reason: "Durable non-secret knowledge graph item is allowed by the local memory policy." };
}

function knowledgePolicyBlockReasons(content: string, sensitivity: KnowledgeSensitivity): KnowledgePolicyBlockReason[] {
  const reasons = [
    sensitivity === "secret" ? "explicit_secret_sensitivity" : undefined,
    /password\s*[:=]/i.test(content) ? "password_assignment" : undefined,
    /api[_ -]?key\s*[:=]/i.test(content) ? "api_key_assignment" : undefined,
    /token\s*[:=]/i.test(content) ? "token_assignment" : undefined,
    /sk-[A-Za-z0-9_-]{12,}/.test(content) ? "openai_key" : undefined,
    /Bearer\s+[A-Za-z0-9._~+/=-]+/i.test(content) ? "bearer_token" : undefined,
    /\b(?=[A-Za-z0-9]{32,}\b)(?=[A-Za-z0-9]*\d)[A-Za-z0-9]+\b/.test(content) ? "long_secret_like_value" : undefined,
    containsPaymentCardLikeValue(content) ? "payment_card_like" : undefined,
  ].filter((reason): reason is KnowledgePolicyBlockReason => reason !== undefined);

  if (reasons.length === 0 && containsSecretLikeValue(content)) {
    reasons.push("secret_like_value");
  }

  return [...new Set(reasons)];
}

function knowledgePolicyBlockReasonLabel(reason: KnowledgePolicyBlockReason): string {
  if (reason === "explicit_secret_sensitivity") return "content marked as secret";
  if (reason === "password_assignment") return "a password field";
  if (reason === "api_key_assignment") return "an API key field";
  if (reason === "token_assignment") return "a token field";
  if (reason === "openai_key") return "an API key value";
  if (reason === "bearer_token") return "a bearer token";
  if (reason === "long_secret_like_value") return "a long token-like value";
  if (reason === "payment_card_like") return "payment card details";
  return "a secret-like value";
}

function formatHumanList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "secret-like content";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function containsPaymentCardLikeValue(content: string): boolean {
  const candidates = content.match(/(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g) ?? [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && !/^(\d)\1+$/.test(digits) && passesLuhnCheck(digits);
  });
}

function passesLuhnCheck(digits: string): boolean {
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (doubleDigit) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}
