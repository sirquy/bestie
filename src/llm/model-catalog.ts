import { buildModelRef, normalizeProviderId } from "./model-ref.js";

export type LlmAuthMode = "api-key" | "oauth" | "local";

export interface BuiltinProviderModel {
  id: string;
  label?: string;
}

export interface BuiltinProviderCatalogEntry {
  id: string;
  label: string;
  runtimeProvider: string;
  defaultBaseUrl?: string;
  defaultApiKeyEnv?: string;
  authModes: LlmAuthMode[];
  defaultModel: string;
  models: BuiltinProviderModel[];
}

export const BUILTIN_LLM_PROVIDERS: BuiltinProviderCatalogEntry[] = [
  {
    id: "codex-cli",
    label: "Codex CLI",
    runtimeProvider: "codex-cli",
    authModes: ["local"],
    defaultModel: "default",
    models: [{ id: "default", label: "Codex CLI default" }],
  },
  {
    id: "claude-cli",
    label: "Claude CLI",
    runtimeProvider: "claude-cli",
    authModes: ["local"],
    defaultModel: "default",
    models: [
      { id: "default", label: "Claude CLI default" },
      { id: "sonnet", label: "Claude Sonnet alias" },
      { id: "opus", label: "Claude Opus alias" },
    ],
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    runtimeProvider: "gemini-cli",
    authModes: ["local"],
    defaultModel: "default",
    models: [
      { id: "default", label: "Gemini CLI default" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    runtimeProvider: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultApiKeyEnv: "ANTHROPIC_API_KEY",
    authModes: ["api-key"],
    defaultModel: "claude-sonnet-4-5",
    models: [
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
  },
  {
    id: "openai",
    label: "ChatGPT/OpenAI",
    runtimeProvider: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultApiKeyEnv: "OPENAI_API_KEY",
    authModes: ["api-key"],
    defaultModel: "gpt-4o-mini",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
      { id: "gpt-4o", label: "GPT-4o" },
    ],
  },
  {
    id: "groq",
    label: "Groq",
    runtimeProvider: "openai-compatible",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultApiKeyEnv: "GROQ_API_KEY",
    authModes: ["api-key"],
    defaultModel: "llama-3.1-8b-instant",
    models: [
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" },
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile" },
      { id: "openai/gpt-oss-120b", label: "GPT OSS 120B" },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    runtimeProvider: "openai-compatible",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultApiKeyEnv: "OPENROUTER_API_KEY",
    authModes: ["api-key"],
    defaultModel: "openai/gpt-4o-mini",
    models: [
      { id: "openai/gpt-4o-mini", label: "OpenAI GPT-4o mini" },
      { id: "anthropic/claude-3.5-sonnet", label: "Anthropic Claude 3.5 Sonnet" },
      { id: "meta-llama/llama-3.1-8b-instruct", label: "Meta Llama 3.1 8B Instruct" },
    ],
  },
  {
    id: "quotacheap",
    label: "QuotaCheap",
    runtimeProvider: "openai-compatible",
    defaultBaseUrl: "https://api.quota.cheap/v1",
    defaultApiKeyEnv: "QUOTACHEAP_API_KEY",
    authModes: ["api-key"],
    defaultModel: "gpt-4o-mini",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
      { id: "gpt-4o", label: "GPT-4o" },
    ],
  },
  {
    id: "ollama",
    label: "Ollama",
    runtimeProvider: "openai-compatible",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    authModes: ["local"],
    defaultModel: "llama3.1",
    models: [
      { id: "llama3.1", label: "Llama 3.1" },
      { id: "llama3.2", label: "Llama 3.2" },
    ],
  },
  {
    id: "gemini",
    label: "Gemini",
    runtimeProvider: "gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultApiKeyEnv: "GEMINI_API_KEY",
    authModes: ["api-key"],
    defaultModel: "gemini-2.5-flash",
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    ],
  },
  {
    id: "antigravity",
    label: "Antigravity",
    runtimeProvider: "openai-compatible",
    defaultBaseUrl: "https://api.antigravity.example/v1",
    authModes: ["oauth"],
    defaultModel: "antigravity-default",
    models: [{ id: "antigravity-default", label: "Antigravity default" }],
  },
  {
    id: "custom-openai",
    label: "Custom OpenAI-Compatible",
    runtimeProvider: "openai-compatible",
    defaultBaseUrl: "https://provider.example/v1",
    defaultApiKeyEnv: "CUSTOM_OPENAI_API_KEY",
    authModes: ["api-key"],
    defaultModel: "provider-model-name",
    models: [],
  },
  {
    id: "custom-anthropic",
    label: "Custom Anthropic-Compatible",
    runtimeProvider: "anthropic",
    defaultBaseUrl: "https://provider.example/v1",
    defaultApiKeyEnv: "CUSTOM_ANTHROPIC_API_KEY",
    authModes: ["api-key"],
    defaultModel: "provider-model-name",
    models: [],
  },
];

export function getBuiltinLlmProvider(providerId: string): BuiltinProviderCatalogEntry | undefined {
  const normalized = normalizeProviderId(providerId);
  return BUILTIN_LLM_PROVIDERS.find((provider) => provider.id === normalized);
}

export function getDefaultModelRef(providerId: string): string {
  const provider = getBuiltinLlmProvider(providerId);
  if (!provider) {
    return buildModelRef(providerId, "provider-model-name");
  }
  return buildModelRef(provider.id, provider.defaultModel);
}
