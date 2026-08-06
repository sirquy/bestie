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

export type ProviderPresetId = "claude-cli" | "codex-cli" | "openai" | "anthropic" | "groq" | "openrouter" | "quotacheap" | "gemini" | "ollama";

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
  { id: "claude-cli", label: "Claude CLI", provider: "claude-cli", mode: "local", model: "default", note: "Runs through the logged-in Claude CLI on this machine; Bestie does not need a URL or API key." },
  { id: "codex-cli", label: "Codex CLI", provider: "codex-cli", mode: "local", model: "default", note: "Runs through the logged-in Codex CLI on this machine; Bestie does not need a URL or API key." },
  { id: "openai", label: "ChatGPT", provider: "openai", mode: "api-key", model: "gpt-4.1-mini", baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY", note: "Dịch vụ tương thích OpenAI, dùng API key." },
  { id: "anthropic", label: "Claude", provider: "anthropic", mode: "api-key", model: "claude-3-5-haiku-latest", baseUrl: "https://api.anthropic.com", apiKeyEnv: "ANTHROPIC_API_KEY", note: "Dịch vụ Claude chính thức từ Anthropic." },
  { id: "groq", label: "Groq", provider: "groq", mode: "api-key", model: "llama-3.3-70b-versatile", baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY", note: "Dịch vụ suy luận nhanh, tương thích OpenAI." },
  { id: "openrouter", label: "OpenRouter", provider: "openrouter", mode: "api-key", model: "anthropic/claude-3.5-sonnet", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", note: "Bộ định tuyến model tương thích OpenAI; hỗ trợ ID model dạng phân cấp." },
  { id: "quotacheap", label: "QuotaCheap", provider: "quotacheap", mode: "api-key", model: "gpt-4o-mini", baseUrl: "https://api.quota.cheap/v1", apiKeyEnv: "QUOTACHEAP_API_KEY", note: "Dịch vụ OpenAI-Compatible chi phí thấp; có thể đổi model theo tài khoản của bạn." },
  { id: "gemini", label: "Gemini", provider: "gemini", mode: "api-key", model: "gemini-2.5-flash", apiKeyEnv: "GEMINI_API_KEY", note: "Kết nối Gemini chính thức; URL gốc được ẩn có chủ đích." },
  { id: "ollama", label: "Ollama", provider: "ollama", mode: "local", model: "llama3.2", baseUrl: "http://127.0.0.1:11434/v1", note: "Dịch vụ chạy cục bộ; không cần khoá bí mật." },
];
