import { setTimeout as delay } from "node:timers/promises";

import { DEFAULT_LLM_MAX_RETRIES, DEFAULT_LLM_RETRY_DELAY_MS, DEFAULT_LLM_TIMEOUT_MS, type AppConfig } from "../runtime/config.js";
import { loadRequiredSecret } from "../runtime/env.js";
import { appendLog } from "../runtime/logger.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { redactSecretLikeValues } from "../runtime/secret-redaction.js";
import { ProviderAuthError, ProviderNetworkError, ProviderRateLimitError, ProviderResponseError, ProviderTimeoutError } from "./errors.js";
import { ProviderFallbackRecorder } from "./fallbacks.js";
import type { ChatCompletionOptions, ChatCompletionRequestBody, ChatMessage, ChatMessageContent } from "./types.js";

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
  const requestBody = buildProviderRequestBody(config, options);
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
  requestBody: unknown,
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
    response = await fetchImpl(buildChatCompletionUrl(config), {
      method: "POST",
      headers: buildChatCompletionHeaders(config, apiKey),
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

  const shouldStream = isRecord(requestBody) && requestBody.stream === true;
  if (shouldStream) {
    return isAnthropicProvider(config.llm.provider) ? parseAnthropicStreamingResponse(response, onToken) : parseOpenAiStreamingResponse(response, onToken);
  }

  const responseBody = await parseJsonResponse(response);
  const content = isAnthropicProvider(config.llm.provider) ? extractAnthropicAssistantText(responseBody) : extractOpenAiAssistantText(responseBody);

  if (!content) {
    throw new ProviderResponseError("missing assistant message content.");
  }

  return content;
}

function buildProviderRequestBody(config: AppConfig, options: ChatCompletionOptions): unknown {
  return isAnthropicProvider(config.llm.provider) ? buildAnthropicMessagesRequestBody(config, options) : buildChatCompletionRequestBody(config, options);
}

function buildChatCompletionUrl(config: AppConfig): string {
  const baseUrl = config.llm.baseUrl.replace(/\/+$/, "");
  return isAnthropicProvider(config.llm.provider) ? `${baseUrl}/messages` : `${baseUrl}/chat/completions`;
}

function buildChatCompletionHeaders(config: AppConfig, apiKey: string): Record<string, string> {
  if (isAnthropicProvider(config.llm.provider)) {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    };
  }

  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };
}

function isAnthropicProvider(provider: string): boolean {
  return ["anthropic", "claude"].includes(provider.toLowerCase());
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

export interface AnthropicMessagesRequestBody {
  model: string;
  messages: Array<{ role: "user" | "assistant"; content: AnthropicMessageContent }>;
  system?: string;
  temperature?: number;
  max_tokens: number;
  stream?: boolean;
}

type AnthropicContentPart = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } };
type AnthropicMessageContent = string | AnthropicContentPart[];

export function buildAnthropicMessagesRequestBody(config: AppConfig, options: ChatCompletionOptions): AnthropicMessagesRequestBody {
  const system = options.messages
    .filter((message) => message.role === "system")
    .map((message) => contentToPlainText(message.content))
    .filter(Boolean)
    .join("\n\n");
  const messages = options.messages
    .filter((message): message is ChatMessage & { role: "user" | "assistant" } => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: toAnthropicContent(message.content),
    }));

  return {
    model: config.llm.model,
    messages,
    ...(system ? { system } : {}),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    max_tokens: options.maxTokens ?? 1024,
    ...(options.stream ? { stream: true } : {}),
  };
}

function toAnthropicContent(content: ChatMessageContent): AnthropicMessageContent {
  if (typeof content === "string") {
    return content;
  }

  return content.flatMap<AnthropicContentPart>((part) => {
    if (part.type === "text") {
      return [{ type: "text" as const, text: part.text }];
    }

    const match = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return [{ type: "text" as const, text: `[Unsupported image URL: ${part.image_url.url.slice(0, 80)}]` }];
    }

    return [{ type: "image" as const, source: { type: "base64" as const, media_type: match[1], data: match[2] } }];
  });
}

function contentToPlainText(content: ChatMessageContent): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function parseOpenAiStreamingResponse(response: Response, onToken?: (token: string) => void): Promise<string> {
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

async function parseAnthropicStreamingResponse(response: Response, onToken?: (token: string) => void): Promise<string> {
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
        const token = parseAnthropicStreamingLine(line);
        if (token === undefined) {
          continue;
        }

        content += token;
        onToken?.(token);
      }
    }

    const finalToken = parseAnthropicStreamingLine(buffer);
    if (finalToken !== undefined) {
      content += finalToken;
      onToken?.(finalToken);
    }
  } catch (error) {
    throw new ProviderNetworkError(error instanceof Error ? error.message : "Unknown streaming error.");
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

function parseAnthropicStreamingLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return undefined;
  }

  const payload = trimmed.slice("data:".length).trim();
  if (!payload || payload === "[DONE]") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!isRecord(parsed) || parsed.type !== "content_block_delta" || !isRecord(parsed.delta)) {
      return undefined;
    }

    return parsed.delta.type === "text_delta" && typeof parsed.delta.text === "string" ? parsed.delta.text : undefined;
  } catch {
    return undefined;
  }
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ProviderResponseError("response body is not valid JSON.");
  }
}

function extractOpenAiAssistantText(responseBody: unknown): string | undefined {
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

function extractAnthropicAssistantText(responseBody: unknown): string | undefined {
  if (!isRecord(responseBody) || !Array.isArray(responseBody.content)) {
    return undefined;
  }

  const content = responseBody.content
    .filter((part): part is { type: string; text: string } => isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");

  return content.trim().length > 0 ? content : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
