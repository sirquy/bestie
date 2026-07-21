import type { GenerateContentParameters } from "@google/genai";

import { redactSecretLikeValues } from "../../runtime/secret-redaction.js";
import { ProviderAuthError, ProviderNetworkError, ProviderRateLimitError, ProviderResponseError, ProviderTimeoutError } from "../errors.js";
import type { ResolvedLlmCandidate } from "../resolve-config.js";
import type { ChatCompletionOptions, ChatMessageContent } from "../types.js";
import { contentToPlainText, isAbortError, isRecord } from "./content.js";
import type { GeminiGenerateContentLike, GoogleGenAIClient, ProviderAdapter, ProviderAdapterContext } from "./types.js";

export const geminiAdapter: ProviderAdapter = {
  metadata: {
    id: "gemini",
    displayName: "Gemini",
    authModes: ["api-key"],
    supportsStreaming: true,
    supportsVision: true,
    supportsToolCalls: false,
  },
  async send(candidate, apiKey, options, context) {
    const requestBody = buildGeminiGenerateContentRequest(candidate, options);
    const client = new context.googleGenAIClass({ apiKey, httpOptions: { timeout: context.timeoutMs } });

    try {
      const content = options.stream
        ? await sendGeminiStreamingAttempt(client, requestBody, options.onToken)
        : await sendGeminiAttempt(client, requestBody);
      if (!content.trim()) {
        throw new ProviderResponseError("missing assistant message content.");
      }
      return content;
    } catch (error) {
      throw normalizeGeminiError(error, context.timeoutMs);
    }
  },
};

export function buildGeminiGenerateContentRequest(candidate: ResolvedLlmCandidate, options: ChatCompletionOptions): GenerateContentParameters {
  const systemInstruction = options.messages
    .filter((message) => message.role === "system")
    .map((message) => contentToPlainText(message.content))
    .filter(Boolean)
    .join("\n\n");

  return {
    model: candidate.model,
    contents: options.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: toGeminiParts(message.content),
      })),
    config: {
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      ...(options.maxTokens === undefined ? {} : { maxOutputTokens: options.maxTokens }),
    },
  };
}

async function sendGeminiAttempt(client: GoogleGenAIClient, requestBody: GenerateContentParameters): Promise<string> {
  const response = await client.models.generateContent(requestBody);
  return extractGeminiText(response);
}

async function sendGeminiStreamingAttempt(client: GoogleGenAIClient, requestBody: GenerateContentParameters, onToken?: (token: string) => void): Promise<string> {
  const stream = await client.models.generateContentStream(requestBody);
  let content = "";
  for await (const chunk of stream) {
    const token = extractGeminiText(chunk, { allowMediaOnly: true });
    if (!token) {
      continue;
    }
    content += token;
    onToken?.(token);
  }
  return content;
}

function extractGeminiText(response: GeminiGenerateContentLike, options: { allowMediaOnly?: boolean } = {}): string {
  if (response.text) {
    return response.text;
  }

  let hasNonTextPart = false;
  const content = response.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => {
      if (part.text) {
        return part.text;
      }
      hasNonTextPart = hasNonTextPart || part.inlineData !== undefined;
      return "";
    })
    .join("") ?? "";

  if (!content && hasNonTextPart && !options.allowMediaOnly) {
    throw new ProviderResponseError("Gemini returned non-text media parts without assistant text. Use a text/chat model or a future media-capable command for image output.");
  }

  return content;
}

function normalizeGeminiError(error: unknown, timeoutMs: number): Error {
  if (error instanceof ProviderAuthError || error instanceof ProviderNetworkError || error instanceof ProviderRateLimitError || error instanceof ProviderResponseError || error instanceof ProviderTimeoutError) {
    return error;
  }

  const status = readErrorStatus(error);
  if (status === 401 || status === 403) {
    return new ProviderAuthError(redactSecretLikeValues(error instanceof Error ? error.message : "Gemini authentication failed."));
  }
  if (status === 429) {
    return new ProviderRateLimitError();
  }
  if (status !== undefined) {
    return new ProviderResponseError(redactSecretLikeValues(error instanceof Error ? error.message : `Gemini provider error ${status}.`), status);
  }
  if (isAbortError(error) || (error instanceof Error && error.message.toLowerCase().includes("timeout"))) {
    return new ProviderTimeoutError(timeoutMs);
  }

  return new ProviderNetworkError(redactSecretLikeValues(error instanceof Error ? error.message : "Unknown Gemini provider error."));
}

function readErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const status = error.status ?? error.statusCode ?? (isRecord(error.error) ? error.error.status : undefined);
  return typeof status === "number" ? status : undefined;
}

function toGeminiParts(content: ChatMessageContent): Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> {
  if (typeof content === "string") {
    return [{ text: content }];
  }

  return content.map((part) => {
    if (part.type === "text") {
      return { text: part.text };
    }

    const match = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return { text: `[Unsupported image URL: ${part.image_url.url.slice(0, 80)}]` };
    }

    return { inlineData: { mimeType: match[1], data: match[2] } };
  });
}
