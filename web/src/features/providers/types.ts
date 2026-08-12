import { BUILTIN_LLM_PROVIDERS } from "../../../../src/llm/model-catalog";

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

export type ProviderPresetId = (typeof BUILTIN_LLM_PROVIDERS)[number]["id"];

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

export const providerPresets: ProviderPreset[] = BUILTIN_LLM_PROVIDERS.map((provider) => ({
  id: provider.id,
  label: provider.label,
  provider: provider.id,
  mode: provider.authModes[0] ?? "api-key",
  model: provider.defaultModel,
  ...(provider.defaultBaseUrl ? { baseUrl: provider.defaultBaseUrl } : {}),
  ...(provider.defaultApiKeyEnv ? { apiKeyEnv: provider.defaultApiKeyEnv } : {}),
  note: provider.authModes.includes("local")
    ? "Dùng runtime cục bộ đã đăng nhập trên máy này; Bestie không lưu API key."
    : provider.authModes.includes("oauth")
      ? "Provider này cần OAuth; thiết lập OAuth chưa được hỗ trợ trong Web UI."
      : "Kết nối bằng API key được lưu cục bộ trong ~/.bestie/.env.",
}));
