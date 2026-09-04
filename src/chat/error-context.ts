import { redactSecrets } from "../runtime/logger.js";

export function formatChatFailureContext(error: unknown, knownSecrets: string[] = []): string {
  const message = describeFailure(error);
  return `[System: The previous assistant response failed before completion. Error: ${redactSecrets(message, knownSecrets)}]`;
}

function describeFailure(error: unknown, depth = 0): string {
  if (depth >= 3 || error === undefined || error === null) return "Unknown chat error.";
  if (!(error instanceof Error)) return String(error);

  const cause = "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;
  if (cause === undefined) return error.message || error.name;

  const causeText = describeFailure(cause, depth + 1);
  return causeText === "Unknown chat error." ? error.message : `${error.message}: ${causeText}`;
}
