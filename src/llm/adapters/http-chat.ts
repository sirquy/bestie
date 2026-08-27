import { redactSecretLikeValues } from "../../runtime/secret-redaction.js";
import { ProviderAuthError, ProviderNetworkError, ProviderRateLimitError, ProviderResponseError, ProviderTimeoutError } from "../errors.js";
import type { ResolvedLlmCandidate } from "../resolve-config.js";
import type { ChatCompletionOptions, ChatCompletionRequestBody, ChatMessage, ChatMessageContent } from "../types.js";
import { contentToPlainText, isAbortError, isRecord } from "./content.js";
import type { ProviderAdapter } from "./types.js";

const PROVIDER_ERROR_BODY_MAX_CHARS = 240;

export function createHttpChatAdapter(options: {
  metadata: ProviderAdapter["metadata"];
  buildRequestBody: (candidate: ResolvedLlmCandidate, options: ChatCompletionOptions) => unknown;
  isAnthropic: boolean;
}): ProviderAdapter {
  return {
    metadata: options.metadata,
    send(candidate, apiKey, chatOptions, context) {
      const requestBody = options.buildRequestBody(candidate, chatOptions);
      return sendChatCompletionAttempt(candidate, apiKey, requestBody, context.fetchImpl, context.timeoutMs, chatOptions.onToken, options.isAnthropic);
    },
  };
}

export function buildChatCompletionRequestBody(
  candidate: ResolvedLlmCandidate,
  options: ChatCompletionOptions,
): ChatCompletionRequestBody {
  return {
    model: candidate.model,
    messages: options.messages,
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    ...(options.stream ? { stream: true } : {}),
    ...(options.reasoningLevel && options.reasoningLevel !== "off" ? { reasoning_effort: options.reasoningLevel } : {}),
  };
}

export interface AnthropicMessagesRequestBody {
  model: string;
  messages: Array<{ role: "user" | "assistant"; content: AnthropicMessageContent }>;
  system?: string;
  temperature?: number;
  max_tokens: number;
  stream?: boolean;
  thinking?: { type: "enabled"; budget_tokens: number };
}

export function buildAnthropicMessagesRequestBody(candidate: ResolvedLlmCandidate, options: ChatCompletionOptions): AnthropicMessagesRequestBody {
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
    model: candidate.model,
    messages,
    ...(system ? { system } : {}),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    max_tokens: options.maxTokens ?? 1024,
    ...(options.stream ? { stream: true } : {}),
    ...(options.reasoningLevel && options.reasoningLevel !== "off" ? { thinking: { type: "enabled", budget_tokens: reasoningBudgetTokens(options.reasoningLevel) } } : {}),
  };
}

function reasoningBudgetTokens(level: "low" | "medium" | "high"): number {
  return level === "low" ? 1024 : level === "medium" ? 4096 : 8192;
}

export function isAnthropicProvider(provider: string): boolean {
  return ["anthropic", "claude"].includes(provider.toLowerCase());
}

async function sendChatCompletionAttempt(
  candidate: ResolvedLlmCandidate,
  apiKey: string,
  requestBody: unknown,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  onToken?: (token: string) => void,
  isAnthropic = isAnthropicProvider(candidate.provider),
): Promise<string> {
  const abortController = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    abortController.abort();
  }, timeoutMs);
  let response: Response;

  try {
    response = await fetchImpl(buildChatCompletionUrl(candidate), {
      method: "POST",
      headers: buildChatCompletionHeaders(apiKey, isAnthropic),
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
    return isAnthropic ? parseAnthropicStreamingResponse(response, onToken) : parseOpenAiStreamingResponse(response, onToken);
  }

  const responseBody = await parseJsonResponse(response);
  const content = isAnthropic ? extractAnthropicAssistantText(responseBody) : extractOpenAiAssistantText(responseBody);

  if (!content) {
    throw new ProviderResponseError("missing assistant message content.");
  }

  return content;
}

function buildChatCompletionUrl(candidate: ResolvedLlmCandidate): string {
  if (!candidate.baseUrl) {
    throw new ProviderResponseError(`missing base URL for ${candidate.provider} profile.`);
  }
  const baseUrl = candidate.baseUrl.replace(/\/+$/, "");
  return isAnthropicProvider(candidate.provider) ? `${baseUrl}/messages` : `${baseUrl}/chat/completions`;
}

function buildChatCompletionHeaders(apiKey: string, isAnthropic: boolean): Record<string, string> {
  if (isAnthropic) {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    };
  }

  return {
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    "content-type": "application/json",
  };
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

type AnthropicContentPart = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } };
type AnthropicMessageContent = string | AnthropicContentPart[];

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
