import type { AppConfig } from "../runtime/config.js";
import { sendChatCompletion } from "./openai-compatible.js";

export interface ProviderTestResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  message?: string;
}

export async function testLlmProvider(config: AppConfig, apiKey: string): Promise<ProviderTestResult> {
  try {
    await sendChatCompletion(config, apiKey, {
      messages: [
        { role: "system", content: "Reply with one short friendly sentence." },
        { role: "user", content: "Say hi to confirm the provider works." },
      ],
      maxTokens: 32,
      temperature: 0.2,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      status: getErrorStatus(error),
      message: error instanceof Error ? error.message : "Unknown provider test error.",
    };
  }
}

function getErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  return typeof error.status === "number" ? error.status : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const testOpenAICompatibleProvider = testLlmProvider;