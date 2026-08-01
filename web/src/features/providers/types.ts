export interface ProviderCandidate {
  modelRef: string;
  provider: string;
  model: string;
  authProfile: string;
  baseUrl: string;
  apiKeyEnv?: string;
  secretPresent: boolean;
}

export interface ProviderProfile {
  id: string;
  provider: string;
  mode: string;
  baseUrl: string;
  apiKeyEnv?: string;
  secretPresent: boolean;
  usedBy: string[];
}

export interface ProviderModel {
  modelRef: string;
  profile: string;
  primary: boolean;
  fallback: boolean;
}

export interface ProviderSummary {
  ok: boolean;
  primary?: ProviderCandidate;
  fallbacks: ProviderCandidate[];
  profiles: ProviderProfile[];
  models: ProviderModel[];
  error?: {
    code: string;
    message: string;
  };
}

export interface ProviderTestResult {
  ok: boolean;
  modelRef: string;
  message?: string;
  latencyMs?: number;
  statusCode?: number;
}

export type ProviderPresetId = "openai" | "anthropic" | "groq" | "openrouter" | "gemini" | "ollama";

export interface ProviderPreset {
  id: ProviderPresetId;
  label: string;
  provider: string;
  mode: string;
  model: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  note: string;
}

export const providerPresets: ProviderPreset[] = [
  { id: "openai", label: "ChatGPT", provider: "openai", mode: "api-key", model: "gpt-4.1-mini", baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY", note: "OpenAI-compatible HTTP provider with API key." },
  { id: "anthropic", label: "Claude", provider: "anthropic", mode: "api-key", model: "claude-3-5-haiku-latest", baseUrl: "https://api.anthropic.com", apiKeyEnv: "ANTHROPIC_API_KEY", note: "Native Anthropic provider." },
  { id: "groq", label: "Groq", provider: "groq", mode: "api-key", model: "llama-3.3-70b-versatile", baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY", note: "Fast OpenAI-compatible hosted inference." },
  { id: "openrouter", label: "OpenRouter", provider: "openrouter", mode: "api-key", model: "anthropic/claude-3.5-sonnet", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", note: "OpenAI-compatible router; nested model IDs are valid." },
  { id: "gemini", label: "Gemini", provider: "gemini", mode: "api-key", model: "gemini-2.5-flash", apiKeyEnv: "GEMINI_API_KEY", note: "Native Gemini SDK endpoint; baseUrl is intentionally hidden." },
  { id: "ollama", label: "Ollama", provider: "ollama", mode: "local", model: "llama3.2", baseUrl: "http://127.0.0.1:11434/v1", note: "Local provider; no secret required." },
];
