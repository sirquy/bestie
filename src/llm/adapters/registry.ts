import { anthropicAdapter, isAnthropicProvider } from "./anthropic.js";
import { claudeCliAdapter } from "./claude-cli.js";
import { codexCliAdapter } from "./codex-cli.js";
import { geminiCliAdapter } from "./gemini-cli.js";
import { geminiAdapter } from "./gemini.js";
import { openAiCompatibleAdapter } from "./openai-compatible.js";
import type { ProviderAdapter, ProviderAdapterMetadata } from "./types.js";

export function getProviderAdapter(provider: string): ProviderAdapter {
  if (provider.toLowerCase() === "claude-cli") {
    return claudeCliAdapter;
  }
  if (provider.toLowerCase() === "codex-cli") {
    return codexCliAdapter;
  }
  if (provider.toLowerCase() === "gemini-cli") {
    return geminiCliAdapter;
  }
  if (provider.toLowerCase() === "gemini") {
    return geminiAdapter;
  }
  if (isAnthropicProvider(provider)) {
    return anthropicAdapter;
  }
  return openAiCompatibleAdapter;
}

export function getProviderAdapterMetadata(provider: string): ProviderAdapterMetadata {
  return getProviderAdapter(provider).metadata;
}
