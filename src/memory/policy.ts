export type MemoryDecision = "store" | "pending" | "never";

export type MemoryType =
  | "preference"
  | "communication_preference"
  | "user_fact"
  | "project_context"
  | "durable_decision"
  | "sensitive_personal"
  | "secret"
  | "one_off";

export interface MemoryCandidate {
  type: MemoryType;
  content: string;
  explicitConsent?: boolean;
}

export interface MemoryPolicyResult {
  decision: MemoryDecision;
  sensitivity: "normal" | "sensitive" | "secret";
  reason: string;
}

const AUTO_STORE_TYPES = new Set<MemoryType>([
  "preference",
  "communication_preference",
  "user_fact",
  "project_context",
  "durable_decision",
]);

const PENDING_TYPES = new Set<MemoryType>(["sensitive_personal"]);

export function evaluateMemoryCandidate(candidate: MemoryCandidate): MemoryPolicyResult {
  const content = candidate.content.trim();

  if (!content) {
    return { decision: "never", sensitivity: "normal", reason: "Empty memory content is ignored." };
  }

  if (candidate.type === "secret" || containsSecretLikeContent(content)) {
    return { decision: "never", sensitivity: "secret", reason: "Secrets, tokens, passwords, and payment details must never be stored." };
  }

  if (candidate.type === "one_off") {
    return { decision: "never", sensitivity: "normal", reason: "One-off venting is not durable memory without an explicit request." };
  }

  if (PENDING_TYPES.has(candidate.type)) {
    return {
      decision: candidate.explicitConsent ? "store" : "pending",
      sensitivity: "sensitive",
      reason: candidate.explicitConsent
        ? "Sensitive memory has explicit consent and can be stored with sensitivity metadata."
        : "Sensitive memory requires user approval before storage.",
    };
  }

  if (AUTO_STORE_TYPES.has(candidate.type)) {
    return { decision: "store", sensitivity: "normal", reason: "Durable non-sensitive memory is allowed by the MVP policy." };
  }

  return { decision: "pending", sensitivity: "sensitive", reason: "Unknown memory type requires review before storage." };
}

function containsSecretLikeContent(content: string): boolean {
  return [
    /password\s*[:=]/i,
    /api[_ -]?key\s*[:=]/i,
    /token\s*[:=]/i,
    /sk-[A-Za-z0-9_-]{12,}/,
    /(?:\d[ -]*?){13,19}/,
  ].some((pattern) => pattern.test(content));
}
