import { redactSecrets } from "../runtime/logger.js";

export function formatChatFailureContext(error: unknown, knownSecrets: string[] = []): string {
  const message = error instanceof Error ? error.message : "Unknown chat error.";
  return `[System: The previous assistant response failed before completion. Error: ${redactSecrets(message, knownSecrets)}]`;
}
