import type { GoogleGenAI, GenerateContentParameters, GenerateContentResponse } from "@google/genai";

import type { RuntimePaths } from "../../runtime/paths.js";
import type { ResolvedLlmCandidate } from "../resolve-config.js";
import type { ChatCompletionOptions } from "../types.js";

export type FetchLike = typeof fetch;

export interface GoogleGenAIConstructor {
  new(options: { apiKey: string; httpOptions?: { timeout?: number } }): GoogleGenAIClient;
}

export interface GoogleGenAIClient {
  models: {
    generateContent: (params: GenerateContentParameters) => Promise<GeminiGenerateContentLike>;
    generateContentStream: (params: GenerateContentParameters) => Promise<AsyncIterable<GeminiGenerateContentLike>>;
  };
}

export interface GeminiGenerateContentLike {
  text?: GenerateContentResponse["text"];
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string; inlineData?: unknown }>;
    };
  }>;
}

export interface ProviderAdapterContext {
  fetchImpl: FetchLike;
  googleGenAIClass: GoogleGenAIConstructor;
  timeoutMs: number;
  paths?: RuntimePaths;
  knownSecrets?: string[];
}

export interface ProviderAdapterMetadata {
  id: string;
  displayName: string;
  authModes: Array<"api-key" | "oauth" | "local">;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsToolCalls: boolean;
}

export interface ProviderAdapter {
  metadata: ProviderAdapterMetadata;
  send(candidate: ResolvedLlmCandidate, apiKey: string, options: ChatCompletionOptions, context: ProviderAdapterContext): Promise<string>;
}

export type { GenerateContentParameters };
export type { GoogleGenAI };
