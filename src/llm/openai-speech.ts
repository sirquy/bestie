import { ElevenLabsClient, ElevenLabsError } from "@elevenlabs/elevenlabs-js";

import { DEFAULT_LLM_TIMEOUT_MS, type AppConfig } from "../runtime/config.js";
import { loadRequiredSecret } from "../runtime/env.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { ProviderAuthError, ProviderNetworkError, ProviderRateLimitError, ProviderResponseError, ProviderTimeoutError } from "./errors.js";
import { ProviderFallbackRecorder, type ProviderFallbackTarget } from "./fallbacks.js";
import type { FetchLike } from "./chat-completion.js";
import { formatProviderHttpError } from "./provider-http.js";

type OpenAiCompatibleSpeechConfig = Extract<NonNullable<AppConfig["speech"]>, { provider: "openai-compatible" }>;

export interface SpeechInput {
  text: string;
}

export interface SpeechResult {
  bytes: Uint8Array;
  mimeType: string;
}

export interface SpeechClientOptions {
  fetchImpl?: FetchLike;
  paths?: RuntimePaths;
  timeoutMs?: number;
  elevenLabsClient?: ElevenLabsTextToSpeechClient;
}

export interface ElevenLabsTextToSpeechClient {
  textToSpeech: {
    convert: (voiceId: string, request: { text: string; modelId?: string; languageCode?: string; outputFormat?: string }, requestOptions?: { timeoutInSeconds?: number }) => Promise<ReadableStream<Uint8Array>>;
  };
}

export async function createSpeech(config: AppConfig, input: SpeechInput, options: SpeechClientOptions = {}): Promise<SpeechResult> {
  if (!config.speech) {
    throw new ProviderResponseError("speech provider is not configured.");
  }

  const fallbackRecorder = new ProviderFallbackRecorder();
  for (const candidate of buildSpeechFallbackCandidates(config)) {
    try {
      return await createSpeechWithProvider(candidate, input, options);
    } catch (error) {
      fallbackRecorder.record(describeSpeechCandidate(candidate), error);
      if (!isFallbackEligibleProviderError(error)) {
        throw error;
      }
    }
  }

  throw fallbackRecorder.toError();
}

async function createSpeechWithProvider(config: AppConfig, input: SpeechInput, options: SpeechClientOptions): Promise<SpeechResult> {
  if (!config.speech) {
    throw new ProviderResponseError("speech provider is not configured.");
  }

  const apiKey = await loadRequiredSecret(config.speech.apiKeyEnv, options.paths);
  if (config.speech.provider === "elevenlabs") {
    return sendElevenLabsSpeech(config, apiKey, input, options.elevenLabsClient, options.timeoutMs ?? config.speech.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS);
  }

  return sendSpeech(config, apiKey, input, options.fetchImpl ?? fetch, options.timeoutMs ?? config.speech.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS);
}

export async function sendElevenLabsSpeech(
  config: AppConfig,
  apiKey: string,
  input: SpeechInput,
  client: ElevenLabsTextToSpeechClient = new ElevenLabsClient({ apiKey }) as unknown as ElevenLabsTextToSpeechClient,
  timeoutMs = config.speech?.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
): Promise<SpeechResult> {
  const speech = config.speech;
  if (!speech || speech.provider !== "elevenlabs") {
    throw new ProviderResponseError("ElevenLabs speech provider is not configured.");
  }

  const trimmedText = input.text.trim();
  if (!trimmedText) {
    throw new ProviderResponseError("speech input is empty.");
  }

  try {
    const stream = await client.textToSpeech.convert(
      speech.voiceId,
      {
        text: trimmedText,
        ...(speech.modelId === undefined ? {} : { modelId: speech.modelId }),
        ...elevenLabsLanguageCodeFromAgent(config),
        ...(speech.outputFormat === undefined ? {} : { outputFormat: speech.outputFormat }),
      },
      { timeoutInSeconds: Math.ceil(timeoutMs / 1000) },
    );
    return { bytes: await readWebStreamBytes(stream), mimeType: mimeTypeForElevenLabsOutputFormat(speech.outputFormat) };
  } catch (error) {
    throw mapElevenLabsError(error, timeoutMs);
  }
}

export async function sendSpeech(
  config: AppConfig,
  apiKey: string,
  input: SpeechInput,
  fetchImpl: FetchLike = fetch,
  timeoutMs = config.speech?.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
): Promise<SpeechResult> {
  const speech = config.speech;
  if (!speech || speech.provider !== "openai-compatible") {
    throw new ProviderResponseError("speech provider is not configured.");
  }

  const trimmedText = input.text.trim();
  if (!trimmedText) {
    throw new ProviderResponseError("speech input is empty.");
  }

  const abortController = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    abortController.abort();
  }, timeoutMs);
  let response: Response;

  try {
    response = await fetchImpl(`${speech.baseUrl}/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: speech.model,
        input: trimmedText,
        ...(speech.voice === undefined ? {} : { voice: speech.voice }),
        ...(speech.responseFormat === undefined ? {} : { response_format: speech.responseFormat }),
      }),
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
    throw new ProviderAuthError();
  }

  if (response.status === 429) {
    throw new ProviderRateLimitError();
  }

  if (!response.ok) {
    throw new ProviderResponseError(await formatProviderHttpError(response));
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new ProviderResponseError("speech response is empty.");
  }

  return { bytes, mimeType: response.headers.get("content-type") ?? mimeTypeForSpeechFormat(speech.responseFormat) };
}

function mimeTypeForSpeechFormat(format: OpenAiCompatibleSpeechConfig["responseFormat"] | undefined): string {
  switch (format) {
    case "opus":
      return "audio/ogg";
    case "aac":
      return "audio/aac";
    case "flac":
      return "audio/flac";
    case "wav":
      return "audio/wav";
    case "pcm":
      return "audio/pcm";
    case "mp3":
    default:
      return "audio/mpeg";
  }
}

async function readWebStreamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    totalBytes += value.byteLength;
  }

  if (totalBytes === 0) {
    throw new ProviderResponseError("speech response is empty.");
  }

  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function mimeTypeForElevenLabsOutputFormat(format: string | undefined): string {
  if (format?.startsWith("opus_")) return "audio/ogg";
  if (format?.startsWith("pcm_")) return "audio/pcm";
  if (format?.startsWith("wav_")) return "audio/wav";
  if (format?.startsWith("ulaw_") || format?.startsWith("alaw_")) return "audio/basic";
  return "audio/mpeg";
}

function elevenLabsLanguageCodeFromAgent(config: AppConfig): { languageCode?: string } {
  const language = config.agent.language.trim();
  return isAutoLanguage(language) ? {} : { languageCode: language };
}

function isAutoLanguage(language: string): boolean {
  const normalized = language.toLowerCase();
  return normalized === "mixed" || normalized === "auto";
}

function isFallbackEligibleProviderError(error: unknown): boolean {
  return error instanceof ProviderAuthError || error instanceof ProviderNetworkError || error instanceof ProviderRateLimitError || error instanceof ProviderResponseError || error instanceof ProviderTimeoutError;
}

function describeSpeechCandidate(config: AppConfig): ProviderFallbackTarget {
  const speech = config.speech;
  if (!speech) {
    return { provider: "speech", model: "unconfigured" };
  }

  if (speech.provider === "openai-compatible") {
    return { provider: speech.provider, model: speech.model };
  }

  return { provider: speech.provider, model: speech.modelId ?? speech.voiceId };
}

function buildSpeechFallbackCandidates(config: AppConfig): AppConfig[] {
  if (!config.speech) {
    return [config];
  }

  const { fallbacks: _fallbacks, ...primary } = config.speech;
  return [
    { ...config, speech: primary },
    ...(config.speech.fallbacks ?? []).map((speech) => ({ ...config, speech })),
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
