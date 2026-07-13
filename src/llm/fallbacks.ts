import { ProviderFallbackError, type ProviderFallbackAttempt } from "./errors.js";
import { readRecentLogs } from "../runtime/logger.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { redactSecretLikeValues } from "../runtime/secret-redaction.js";

export type ProviderFallbackTarget = Pick<ProviderFallbackAttempt, "provider" | "model">;

const DIAGNOSTIC_ERROR_MAX_CHARS = 160;

export class ProviderFallbackRecorder {
  readonly attempts: ProviderFallbackAttempt[] = [];
  #lastError: unknown;

  record(target: ProviderFallbackTarget, error: unknown): void {
    this.#lastError = error;
    this.attempts.push({ ...target, error: describeProviderError(error) });
  }

  toError(): ProviderFallbackError {
    return new ProviderFallbackError(this.attempts, this.#lastError);
  }
}

export function fallbackLogDetail(error: unknown): { fallbackAttempts?: ProviderFallbackAttempt[] } {
  return error instanceof ProviderFallbackError ? { fallbackAttempts: error.attempts } : {};
}

export async function formatProviderFallbackHealth(paths: RuntimePaths, lineCount = 40): Promise<string | undefined> {
  const attempts = (await readRecentLogs(paths, lineCount)).flatMap((line) => readFallbackAttemptEventFromLogLine(line)?.attempts ?? []);
  if (attempts.length === 0) {
    return undefined;
  }

  const counts = new Map<string, number>();
  for (const attempt of attempts) {
    const key = `${attempt.provider}/${attempt.model}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const summary = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([target, count]) => `${target} x${count}`)
    .join(", ");

  return `provider fallback failures recent ${attempts.length}${summary ? ` (${summary})` : ""}`;
}

export async function formatProviderFallbackDiagnostics(paths: RuntimePaths, lineCount = 80, limit = 5): Promise<string> {
  const events = (await readRecentLogs(paths, lineCount))
    .flatMap((line) => {
      const event = readFallbackAttemptEventFromLogLine(line);
      return event ? [event] : [];
    })
    .slice(-limit)
    .reverse();

  if (events.length === 0) {
    return "Provider diagnostics -> no recent fallback failures found.";
  }

  return [
    `Provider diagnostics -> recent fallback chains ${events.length}`,
    ...events.map((event) => `${event.timestamp ?? "unknown time"}: ${event.attempts.map((attempt) => `${attempt.provider}/${attempt.model}: ${formatDiagnosticError(attempt.error)}`).join(" | ")}`),
  ].join("\n");
}

function describeProviderError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown provider error.";
}

function formatDiagnosticError(error: string): string {
  const normalized = redactSecretLikeValues(error).replace(/\s+/g, " ").trim();
  if (normalized.length <= DIAGNOSTIC_ERROR_MAX_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, DIAGNOSTIC_ERROR_MAX_CHARS - 3)}...`;
}

function readFallbackAttemptEventFromLogLine(line: string): { timestamp?: string; attempts: ProviderFallbackAttempt[] } | undefined {
  try {
    const entry = JSON.parse(line) as { timestamp?: unknown; detail?: { fallbackAttempts?: unknown } };
    const attempts = entry.detail?.fallbackAttempts;
    if (!Array.isArray(attempts)) {
      return undefined;
    }

    const validAttempts = attempts.filter(isProviderFallbackAttempt);
    return validAttempts.length > 0
      ? { timestamp: typeof entry.timestamp === "string" ? entry.timestamp : undefined, attempts: validAttempts }
      : undefined;
  } catch {
    return undefined;
  }
}

function isProviderFallbackAttempt(value: unknown): value is ProviderFallbackAttempt {
  return typeof value === "object"
    && value !== null
    && typeof (value as ProviderFallbackAttempt).provider === "string"
    && typeof (value as ProviderFallbackAttempt).model === "string"
    && typeof (value as ProviderFallbackAttempt).error === "string";
}