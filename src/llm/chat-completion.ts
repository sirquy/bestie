import { GoogleGenAI } from "@google/genai";

import { DEFAULT_LLM_TIMEOUT_MS, type AppConfig } from "../runtime/config.js";
import { appendLog } from "../runtime/logger.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { getProviderAdapter } from "./adapters/registry.js";
import type { FetchLike, GoogleGenAIConstructor, ProviderAdapterContext } from "./adapters/types.js";
export { buildGeminiGenerateContentRequest } from "./adapters/gemini.js";
export { buildAnthropicMessagesRequestBody, buildChatCompletionRequestBody } from "./adapters/http-chat.js";
import { ProviderAuthError, ProviderNetworkError, ProviderRateLimitError, ProviderResponseError, ProviderTimeoutError } from "./errors.js";
import { ProviderFallbackRecorder } from "./fallbacks.js";
import { loadLlmCandidateSecret, resolveLlmFallbackCandidates, resolvePrimaryLlmCandidate, type ResolvedLlmCandidate } from "./resolve-config.js";
import { withRetries } from "./retry.js";
import type { ChatCompletionOptions } from "./types.js";

export type { FetchLike };

export interface ChatCompletionClientOptions {
  fetchImpl?: FetchLike;
  googleGenAIClass?: GoogleGenAIConstructor;
  paths?: RuntimePaths;
  timeoutMs?: number;
}

interface ChatCompletionRetryOptions {
  paths?: RuntimePaths;
  knownSecrets?: string[];
  googleGenAIClass?: GoogleGenAIConstructor;
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
  for (const candidate of resolveLlmFallbackCandidates(config)) {
    try {
      const apiKey = await loadLlmCandidateSecret(candidate, clientOptions.paths);
      return await sendResolvedChatCompletion(candidate, apiKey, options, {
        fetchImpl: clientOptions.fetchImpl ?? fetch,
        googleGenAIClass: clientOptions.googleGenAIClass ?? GoogleGenAI,
        timeoutMs: clientOptions.timeoutMs ?? candidate.timeoutMs,
        paths: clientOptions.paths,
        knownSecrets: apiKey ? [apiKey] : [],
      });
    } catch (error) {
      fallbackRecorder.record({ provider: candidate.provider, model: candidate.model }, error);
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
  retryLogOptions: ChatCompletionRetryOptions = {},
): Promise<string> {
  const candidate = resolvePrimaryLlmCandidate(config);
  return sendResolvedChatCompletion(candidate, apiKey, options, {
    fetchImpl,
    googleGenAIClass: retryLogOptions.googleGenAIClass ?? GoogleGenAI,
    timeoutMs,
    paths: retryLogOptions.paths,
    knownSecrets: retryLogOptions.knownSecrets,
  });
}

async function sendResolvedChatCompletion(
  candidate: ResolvedLlmCandidate,
  apiKey: string,
  options: ChatCompletionOptions,
  context: ProviderAdapterContext,
): Promise<string> {
  const adapter = getProviderAdapter(candidate.provider);
  return withRetries(() => adapter.send(candidate, apiKey, options, context), {
    maxRetries: candidate.maxRetries,
    retryDelayMs: candidate.retryDelayMs,
    shouldRetry: isRetryableProviderError,
    onRetry: (error, attempt) => logProviderRetry(candidate, error, {
        attempt,
        maxRetries: candidate.maxRetries,
        retryDelayMs: candidate.retryDelayMs,
        paths: context.paths,
        knownSecrets: context.knownSecrets ?? (apiKey ? [apiKey] : []),
      }),
  });
}

async function logProviderRetry(
  candidate: ResolvedLlmCandidate,
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
        provider: candidate.provider,
        model: candidate.model,
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

function isRetryableProviderError(error: unknown): boolean {
  return error instanceof ProviderNetworkError
    || error instanceof ProviderRateLimitError
    || (error instanceof ProviderResponseError && error.status !== undefined && error.status >= 500);
}

function isFallbackEligibleProviderError(error: unknown): boolean {
  return error instanceof ProviderAuthError || error instanceof ProviderNetworkError || error instanceof ProviderRateLimitError || error instanceof ProviderResponseError || error instanceof ProviderTimeoutError;
}
