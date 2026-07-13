import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { ElevenLabsClient, ElevenLabsError } from "@elevenlabs/elevenlabs-js";

import { DEFAULT_LLM_MAX_RETRIES, DEFAULT_LLM_RETRY_DELAY_MS, DEFAULT_LLM_TIMEOUT_MS, type AppConfig } from "../runtime/config.js";
import { loadRequiredSecret } from "../runtime/env.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { ProviderAuthError, ProviderNetworkError, ProviderRateLimitError, ProviderResponseError, ProviderTimeoutError } from "./errors.js";
import { ProviderFallbackRecorder, type ProviderFallbackTarget } from "./fallbacks.js";
import { createLocalAudioTranscription } from "./local-transcription.js";
import type { FetchLike } from "./openai-compatible.js";
import { formatProviderHttpError } from "./provider-http.js";

export interface AudioTranscriptionInput {
  bytes: Uint8Array;
  localPath: string;
  mimeType?: string;
}

export interface AudioTranscriptionClientOptions {
  fetchImpl?: FetchLike;
  paths?: RuntimePaths;
  timeoutMs?: number;
  elevenLabsClient?: ElevenLabsSpeechToTextClient;
}

export interface ElevenLabsSpeechToTextClient {
  speechToText: {
    convert: (
      request: {
        file: File;
        modelId: string;
        languageCode?: string;
        tagAudioEvents?: boolean;
        diarize?: boolean;
      },
      requestOptions?: { timeoutInSeconds?: number },
    ) => Promise<unknown>;
  };
}

export async function createAudioTranscription(
  config: AppConfig,
  input: AudioTranscriptionInput,
  options: AudioTranscriptionClientOptions = {},
): Promise<string> {
  if (!config.transcription) {
    throw new ProviderResponseError("transcription provider is not configured.");
  }

  const fallbackRecorder = new ProviderFallbackRecorder();
  for (const candidate of buildTranscriptionFallbackCandidates(config)) {
    try {
      return await createAudioTranscriptionWithProvider(candidate, input, options);
    } catch (error) {
      fallbackRecorder.record(describeTranscriptionCandidate(candidate), error);
      if (!isFallbackEligibleProviderError(error)) {
        throw error;
      }
    }
  }

  throw fallbackRecorder.toError();
}

async function createAudioTranscriptionWithProvider(
  config: AppConfig,
  input: AudioTranscriptionInput,
  options: AudioTranscriptionClientOptions,
): Promise<string> {
  if (!config.transcription) {
    throw new ProviderResponseError("transcription provider is not configured.");
  }

  if (config.transcription.provider === "elevenlabs") {
    const apiKey = await loadRequiredSecret(config.transcription.apiKeyEnv, options.paths);
    return sendElevenLabsAudioTranscription(config, apiKey, input, options.elevenLabsClient, options.timeoutMs ?? config.transcription.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS);
  }

  if (config.transcription.provider === "local-whisper") {
    return createLocalAudioTranscription(config, { localPath: input.localPath });
  }

  if (config.transcription.provider !== "openai-compatible") {
    throw new ProviderResponseError("transcription provider is not configured.");
  }

  const apiKey = await loadRequiredSecret(config.transcription.apiKeyEnv, options.paths);
  return sendAudioTranscription(config, apiKey, input, options.fetchImpl ?? fetch, options.timeoutMs ?? config.transcription.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS);
}

export async function sendElevenLabsAudioTranscription(
  config: AppConfig,
  apiKey: string,
  input: AudioTranscriptionInput,
  client: ElevenLabsSpeechToTextClient = new ElevenLabsClient({ apiKey }) as unknown as ElevenLabsSpeechToTextClient,
  timeoutMs = config.transcription?.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
): Promise<string> {
  const transcription = config.transcription;
  if (!transcription || transcription.provider !== "elevenlabs") {
    throw new ProviderResponseError("ElevenLabs transcription provider is not configured.");
  }

  try {
    const response = await client.speechToText.convert(
      {
        file: buildElevenLabsAudioFile(input),
        modelId: transcription.modelId ?? "scribe_v2",
        ...elevenLabsLanguageCodeFromAgent(config),
        ...(transcription.tagAudioEvents === undefined ? {} : { tagAudioEvents: transcription.tagAudioEvents }),
        ...(transcription.diarize === undefined ? {} : { diarize: transcription.diarize }),
      },
      { timeoutInSeconds: Math.ceil(timeoutMs / 1000) },
    );
    return extractElevenLabsTranscriptionText(response);
  } catch (error) {
    throw mapElevenLabsError(error, timeoutMs);
  }
}

export async function sendAudioTranscription(
  config: AppConfig,
  apiKey: string,
  input: AudioTranscriptionInput,
  fetchImpl: FetchLike = fetch,
  timeoutMs = config.transcription?.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
): Promise<string> {
  if (!config.transcription || config.transcription.provider !== "openai-compatible") {
    throw new ProviderResponseError("transcription provider is not configured.");
  }

  let attempt = 0;
  while (true) {
    try {
      return await sendAudioTranscriptionAttempt(config, apiKey, input, fetchImpl, timeoutMs);
    } catch (error) {
      if (!isRetryableProviderError(error) || attempt >= DEFAULT_LLM_MAX_RETRIES) {
        throw error;
      }

      attempt += 1;
      if (DEFAULT_LLM_RETRY_DELAY_MS > 0) {
        await delay(DEFAULT_LLM_RETRY_DELAY_MS);
      }
    }
  }
}

async function sendAudioTranscriptionAttempt(
  config: AppConfig,
  apiKey: string,
  input: AudioTranscriptionInput,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<string> {
  if (!config.transcription || config.transcription.provider !== "openai-compatible") {
    throw new ProviderResponseError("transcription provider is not configured.");
  }

  const abortController = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    abortController.abort();
  }, timeoutMs);
  let response: Response;

  try {
    response = await fetchImpl(buildTranscriptionUrl(config.transcription.baseUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: buildAudioTranscriptionForm(config, input),
      signal: abortController.signal,
    });
  } catch (error) {
    if (didTimeout || isAbortError(error)) {
      throw new ProviderTimeoutError(timeoutMs);
    }

    throw new ProviderNetworkError(error instanceof Error ? error.message : "Unknown network error.");
  }

  try {
    if (response.status === 401 || response.status === 403) {
      throw new ProviderAuthError();
    }

    if (response.status === 429) {
      throw new ProviderRateLimitError();
    }

    if (!response.ok) {
      throw new ProviderResponseError(await formatProviderHttpError(response));
    }

    const responseBody = await parseJsonResponse(response, timeoutMs, () => didTimeout);
    const text = extractTranscriptionText(responseBody);
    if (!text) {
      throw new ProviderResponseError("missing transcription text.");
    }

    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function buildAudioTranscriptionForm(config: AppConfig, input: AudioTranscriptionInput): FormData {
  const transcription = config.transcription;
  if (!transcription || transcription.provider !== "openai-compatible") {
    throw new ProviderResponseError("transcription provider is not configured.");
  }

  const form = new FormData();
  const mimeType = input.mimeType || "application/octet-stream";
  const fileName = basename(input.localPath) || "telegram-audio.bin";
  form.append("model", transcription.model);
  form.append("file", new Blob([Buffer.from(input.bytes)], { type: mimeType }), fileName);
  form.append("response_format", "json");
  return form;
}

function buildElevenLabsAudioFile(input: AudioTranscriptionInput): File {
  const mimeType = input.mimeType || "application/octet-stream";
  const fileName = basename(input.localPath) || "telegram-audio.bin";
  return new File([Buffer.from(input.bytes)], fileName, { type: mimeType });
}

function buildTranscriptionUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/audio/transcriptions`;
}

async function parseJsonResponse(response: Response, timeoutMs: number, didTimeout: () => boolean): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (didTimeout() || isAbortError(error)) {
      throw new ProviderTimeoutError(timeoutMs);
    }

    throw new ProviderResponseError("response body is not valid JSON.");
  }
}

function extractTranscriptionText(responseBody: unknown): string | undefined {
  if (!isRecord(responseBody)) {
    return undefined;
  }

  const text = responseBody.text;
  return typeof text === "string" && text.trim().length > 0 ? text : undefined;
}

function extractElevenLabsTranscriptionText(responseBody: unknown): string {
  const text = extractTranscriptionText(responseBody);
  if (text) {
    return text;
  }

  if (isRecord(responseBody) && Array.isArray(responseBody.transcripts)) {
    const parts = responseBody.transcripts
      .map((entry) => extractTranscriptionText(entry))
      .filter((entry): entry is string => Boolean(entry));
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }

  throw new ProviderResponseError("missing transcription text.");
}

function elevenLabsLanguageCodeFromAgent(config: AppConfig): { languageCode?: string } {
  const transcription = config.transcription;
  const language = transcription?.provider === "elevenlabs" && transcription.languageCode !== undefined
    ? transcription.languageCode.trim()
    : config.agent.language.trim();
  return isAutoLanguage(language) ? {} : { languageCode: language };
}

function isAutoLanguage(language: string): boolean {
  const normalized = language.toLowerCase();
  return normalized === "mixed" || normalized === "auto";
}

function isFallbackEligibleProviderError(error: unknown): boolean {
  return error instanceof ProviderAuthError || error instanceof ProviderNetworkError || error instanceof ProviderRateLimitError || error instanceof ProviderResponseError || error instanceof ProviderTimeoutError;
}

function isRetryableProviderError(error: unknown): boolean {
  return error instanceof ProviderNetworkError || error instanceof ProviderRateLimitError;
}

function describeTranscriptionCandidate(config: AppConfig): ProviderFallbackTarget {
  const transcription = config.transcription;
  if (!transcription) {
    return { provider: "transcription", model: "unconfigured" };
  }

  if (transcription.provider === "openai-compatible") {
    return { provider: transcription.provider, model: transcription.model };
  }

  if (transcription.provider === "elevenlabs") {
    return { provider: transcription.provider, model: transcription.modelId ?? "scribe_v2" };
  }

  return { provider: transcription.provider, model: transcription.command };
}

function buildTranscriptionFallbackCandidates(config: AppConfig): AppConfig[] {
  if (!config.transcription) {
    return [config];
  }

  const { fallbacks: _fallbacks, ...primary } = config.transcription;
  return [
    { ...config, transcription: primary },
    ...(config.transcription.fallbacks ?? []).map((transcription) => ({ ...config, transcription })),
  ];
}

function mapElevenLabsError(error: unknown, timeoutMs: number): Error {
  if (error instanceof ElevenLabsError) {
    if (error.statusCode === 401 || error.statusCode === 403) return new ProviderAuthError();
    if (error.statusCode === 429) return new ProviderRateLimitError();
    return new ProviderResponseError(error.message);
  }

  if (error instanceof Error && (error.name.toLowerCase().includes("timeout") || error.message.toLowerCase().includes("timeout"))) {
    return new ProviderTimeoutError(timeoutMs);
  }

  return new ProviderNetworkError(error instanceof Error ? error.message : "Unknown network error.");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
