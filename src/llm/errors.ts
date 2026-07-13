import { UserFacingError } from "../runtime/errors.js";

export class ProviderAuthError extends UserFacingError {
  constructor(detail?: string) {
    super(
      detail
        ? `Provider authentication failed (${detail}). Check the configured API key, provider account access, and model permissions.`
        : "Provider authentication failed. Check the configured API key, provider account access, and model permissions.",
      "ProviderAuthError",
    );
  }
}

export class ProviderRateLimitError extends UserFacingError {
  constructor() {
    super("Provider rate limit reached. Wait a bit or check your provider quota.", "ProviderRateLimitError");
  }
}

export class ProviderNetworkError extends UserFacingError {
  constructor(message: string) {
    super(`Could not reach the provider endpoint: ${message}`, "ProviderNetworkError");
  }
}

export class ProviderTimeoutError extends UserFacingError {
  constructor(timeoutMs: number) {
    super(
      `Provider request timed out after ${formatTimeout(timeoutMs)}. The endpoint is reachable sometimes, but this response took too long. Try again or use a faster model.`,
      "ProviderTimeoutError",
    );
  }
}

export class ProviderResponseError extends UserFacingError {
  constructor(message: string) {
    super(`Provider returned an unusable response: ${message}`, "ProviderResponseError");
  }
}

export interface ProviderFallbackAttempt {
  provider: string;
  model: string;
  error: string;
}

export class ProviderFallbackError extends UserFacingError {
  constructor(
    readonly attempts: ProviderFallbackAttempt[],
    readonly finalError: unknown,
  ) {
    super(formatProviderFallbackMessage(attempts), "ProviderFallbackError");
  }
}

function formatProviderFallbackMessage(attempts: ProviderFallbackAttempt[]): string {
  const summary = attempts
    .map((attempt, index) => `${index + 1}. ${attempt.provider}/${attempt.model}: ${attempt.error}`)
    .join("; ");

  return summary ? `All configured LLM providers failed. Attempts: ${summary}` : "All configured LLM providers failed.";
}

function formatTimeout(timeoutMs: number): string {
  return timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)}s` : `${timeoutMs}ms`;
}
