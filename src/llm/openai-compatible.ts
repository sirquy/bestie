import { setTimeout as delay } from "node:timers/promises";

import { DEFAULT_LLM_MAX_RETRIES, DEFAULT_LLM_RETRY_DELAY_MS, DEFAULT_LLM_TIMEOUT_MS, type AppConfig } from "../runtime/config.js";
import { loadRequiredSecret } from "../runtime/env.js";
import { appendLog } from "../runtime/logger.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { redactSecretLikeValues } from "../runtime/secret-redaction.js";
import { ProviderAuthError, ProviderNetworkError, ProviderRateLimitError, ProviderResponseError, ProviderTimeoutError } from "./errors.js";
import { ProviderFallbackRecorder } from "./fallbacks.js";
import type { ChatCompletionOptions, ChatCompletionRequestBody } from "./types.js";

export type FetchLike = typeof fetch;

const PROVIDER_ERROR_BODY_MAX_CHARS = 240;

export interface ChatCompletionClientOptions {
  fetchImpl?: FetchLike;
  paths?: RuntimePaths;
  timeoutMs?: number;
}

export async function createChatCompletion(
  config: AppConfig,
  options: ChatCompletionOptions,
  clientOptions: ChatCompletionClientOptions = {},
): Promise<string> {
  return sendChatCompletionWithFallbacks(config, options, clientOptions);
}

export async function sendChatCompletionWithFallbacks(
  config: AppConfig,
  options: ChatCompletionOptions,
  clientOptions: ChatCompletionClientOptions = {},
): Promise<string> {
  const fallbackRecorder = new ProviderFallbackRecorder();
  for (const candidate of buildLlmFallbackCandidates(config)) {
    try {
      const apiKey = await loadRequiredSecret(candidate.llm.apiKeyEnv, clientOptions.paths);
      return await sendChatCompletion(candidate, apiKey, options, clientOptions.fetchImpl ?? fetch, clientOptions.timeoutMs ?? candidate.llm.timeoutMs, { paths: clientOptions.paths, knownSecrets: [apiKey] });
    } catch (error) {
      fallbackRecorder.record({ provider: candidate.llm.provider, model: candidate.llm.model }, error);
      if (!isFallbackEligibleProviderError(error)) {
        throw error;
      }
    }
  }

  throw fallbackRecorder.toError();
}

export async function sendChatCompletion(
  config: AppConfig,
  apiKey: string,
  options: ChatCompletionOptions,
  fetchImpl: FetchLike = fetch,
  timeoutMs = config.llm.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
  retryLogOptions: { paths?: RuntimePaths; knownSecrets?: string[] } = {},
): Promise<string> {
  const requestBody = buildChatCompletionRequestBody(config, options);
  const maxRetries = config.llm.maxRetries ?? DEFAULT_LLM_MAX_RETRIES;
  const retryDelayMs = config.llm.retryDelayMs ?? DEFAULT_LLM_RETRY_DELAY_MS;
  let attempt = 0;

  while (true) {
    try {
      return await sendChatCompletionAttempt(config, apiKey, requestBody, fetchImpl, timeoutMs, options.onToken);
    } catch (error) {
      if (!isRetryableProviderError(error) || attempt >= maxRetries) {
        throw error;
      }

      attempt += 1;
      await logProviderRetry(config, error, { attempt, maxRetries, retryDelayMs, paths: retryLogOptions.paths, knownSecrets: retryLogOptions.knownSecrets ?? [apiKey] });
      if (retryDelayMs > 0) {
        await delay(retryDelayMs);
      }
    }
  }
}

async function logProviderRetry(
  config: AppConfig,
  error: unknown,
  options: { attempt: number; maxRetries: number; retryDelayMs: number; paths?: RuntimePaths; knownSecrets: string[] },
): Promise<void> {
  if (!options.paths) {
    return;
  }

  await appendLog(
    {
      event: "llm_provider_retry",
      detail: {
        provider: config.llm.provider,
        model: config.llm.model,
        attempt: options.attempt,
        maxRetries: options.maxRetries,
        retryDelayMs: options.retryDelayMs,
        status: error instanceof ProviderResponseError ? error.status : undefined,
        message: error instanceof Error ? error.message : "Unknown provider error.",
      },
    },
    { paths: options.paths, knownSecrets: options.knownSecrets },
  );
}

async function sendChatCompletionAttempt(
  config: AppConfig,
  apiKey: string,
  requestBody: ChatCompletionRequestBody,
  fetchImpl: FetchLike,
  timeoutMs: number,
  onToken?: (token: string) => void,
): Promise<string> {
  const abortController = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    abortController.abort();
  }, timeoutMs);
  let response: Response;

  // console.log(requestBody)
  try {
    response = await fetchImpl(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    });
  } catch (error) {
    if (didTimeout || isAbortError(error)) {
      throw new ProviderTimeoutError(timeoutMs);
    }

    throw new ProviderNetworkError(error instanceof Error ? error.message : "Unknown network error.");
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderAuthError(await formatProviderHttpError(response));
  }

  if (response.status === 429) {
    throw new ProviderRateLimitError();
  }

  if (!response.ok) {
    throw new ProviderResponseError(await formatProviderHttpError(response), response.status);
  }

  if (requestBody.stream) {
    return parseStreamingResponse(response, onToken);
  }

  const responseBody = await parseJsonResponse(response);
  const content = extractAssistantText(responseBody);

  if (!content) {
    throw new ProviderResponseError("missing assistant message content.");
  }

  return content;
}

async function formatProviderHttpError(response: Response): Promise<string> {
  const status = `${response.status} ${response.statusText}`.trim();
  const body = await readProviderErrorBody(response);

  return body ? `${status}: ${body}` : status;
}

async function readProviderErrorBody(response: Response): Promise<string | undefined> {
  try {
    const body = redactSecretLikeValues((await response.text()).replace(/\s+/g, " ").trim());

    if (!body) {
      return undefined;
    }

    return body.length > PROVIDER_ERROR_BODY_MAX_CHARS ? `${body.slice(0, PROVIDER_ERROR_BODY_MAX_CHARS - 3)}...` : body;
  } catch {
    return undefined;
  }
}

function isRetryableProviderError(error: unknown): boolean {
  return error instanceof ProviderNetworkError
    || error instanceof ProviderRateLimitError
    || (error instanceof ProviderResponseError && error.status !== undefined && error.status >= 500);
}

function isFallbackEligibleProviderError(error: unknown): boolean {
  return error instanceof ProviderAuthError || error instanceof ProviderNetworkError || error instanceof ProviderRateLimitError || error instanceof ProviderResponseError || error instanceof ProviderTimeoutError;
}

function buildLlmFallbackCandidates(config: AppConfig): AppConfig[] {
  return [
    config,
    ...(config.llm.fallbacks ?? []).map((fallback) => ({
      ...config,
      llm: {
        ...config.llm,
        ...fallback,
        provider: fallback.provider ?? config.llm.provider,
        baseUrl: fallback.baseUrl ?? config.llm.baseUrl,
        apiKeyEnv: fallback.apiKeyEnv ?? config.llm.apiKeyEnv,
      },
    })),
  ];
}

export function buildChatCompletionRequestBody(
  config: AppConfig,
  options: ChatCompletionOptions,
): ChatCompletionRequestBody {
  return {
    model: config.llm.model,
    messages: options.messages,
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    ...(options.stream ? { stream: true } : {}),
  };
}

async function parseStreamingResponse(response: Response, onToken?: (token: string) => void): Promise<string> {
  if (!response.body) {
    throw new ProviderResponseError("streaming response body is missing.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const token = parseStreamingLine(line);
        if (token === undefined) {
          continue;
        }

        content += token;
        onToken?.(token);
      }
    }

    const finalToken = parseStreamingLine(buffer);
    if (finalToken !== undefined) {
      content += finalToken;
      onToken?.(finalToken);
    }
  } finally {
    reader.releaseLock();
  }

  if (!content.trim()) {
    throw new ProviderResponseError("missing assistant message content.");
  }

  return content;
}

function parseStreamingLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) {
    return undefined;
  }

  const payload = trimmed.startsWith("data:") ? trimmed.slice("data:".length).trim() : trimmed;
  if (!payload || payload === "[DONE]") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.choices)) {
      return undefined;
    }

    const firstChoice = parsed.choices[0];
    if (!isRecord(firstChoice) || !isRecord(firstChoice.delta)) {
      return undefined;
    }

    const deltaContent = firstChoice.delta.content;
    return typeof deltaContent === "string" ? deltaContent : undefined;
  } catch {
    throw new ProviderResponseError("streaming response chunk is not valid JSON.");
  }
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ProviderResponseError("response body is not valid JSON.");
  }
}

function extractAssistantText(responseBody: unknown): string | undefined {
  if (!isRecord(responseBody) || !Array.isArray(responseBody.choices)) {
    return undefined;
  }

  const firstChoice = responseBody.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    return undefined;
  }

  const content = firstChoice.message.content;
  return typeof content === "string" && content.trim().length > 0 ? content : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
