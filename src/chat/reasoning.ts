import type { ReasoningLevel } from "../llm/types.js";

export const REASONING_LEVELS: ReasoningLevel[] = ["off", "low", "medium", "high"];

export function parseReasoningLevel(value: string | undefined): ReasoningLevel | undefined {
  const normalized = value?.trim().toLowerCase();
  return REASONING_LEVELS.includes(normalized as ReasoningLevel) ? normalized as ReasoningLevel : undefined;
}

export function formatReasoningLevel(level: ReasoningLevel): string {
  return level === "off" ? "tắt" : level === "low" ? "thấp" : level === "medium" ? "vừa" : "cao";
}

export function formatReasoningCommandHelp(): string {
  return "Reasoning: /reasoning off|low|medium|high (mặc định: off)";
}
