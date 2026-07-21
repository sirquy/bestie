import { DEFAULT_LLM_MAX_RETRIES, DEFAULT_LLM_RETRY_DELAY_MS, DEFAULT_LLM_TIMEOUT_MS, type AppConfig, type LlmProfileConfig } from "../runtime/config.js";
import { loadRequiredSecret } from "../runtime/env.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { parseModelRef } from "./model-ref.js";

export interface ResolvedLlmCandidate {
  provider: string;
  mode: LlmProfileConfig["mode"];
  baseUrl?: string;
  modelRef: string;
  model: string;
  authProfile: string;
  apiKeyEnv?: string;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

export function resolvePrimaryLlmCandidate(config: AppConfig): ResolvedLlmCandidate {
  return resolveLlmCandidate(config, config.llm.primary);
}

export function resolveLlmFallbackCandidates(config: AppConfig): ResolvedLlmCandidate[] {
  return [config.llm.primary, ...(config.llm.fallbacks ?? [])].map((modelRef) => resolveLlmCandidate(config, modelRef));
}

export function resolveLlmCandidate(config: AppConfig, modelRef: string): ResolvedLlmCandidate {
  const parsed = parseModelRef(modelRef);
  if (!parsed) {
    throw new Error(`LLM model ref must use provider/model format: ${modelRef}`);
  }

  const catalogEntry = config.llm.modelCatalog[modelRef];
  const profileId = catalogEntry?.profile ?? config.llm.authProfile;
  const profile = config.llm.profiles[profileId];
  if (!profile) {
    throw new Error(`LLM auth profile not found: ${profileId}`);
  }

  return {
    provider: profile.provider,
    mode: profile.mode,
    ...(profile.baseUrl === undefined ? {} : { baseUrl: profile.baseUrl.replace(/\/+$/, "") }),
    modelRef,
    model: parsed.model,
    authProfile: profileId,
    ...(profile.apiKeyEnv === undefined ? {} : { apiKeyEnv: profile.apiKeyEnv }),
    timeoutMs: config.llm.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
    maxRetries: config.llm.maxRetries ?? DEFAULT_LLM_MAX_RETRIES,
    retryDelayMs: config.llm.retryDelayMs ?? DEFAULT_LLM_RETRY_DELAY_MS,
  };
}

export async function loadLlmCandidateSecret(candidate: ResolvedLlmCandidate, paths?: RuntimePaths): Promise<string> {
  if (candidate.mode === "local") {
    return "";
  }
  if (!candidate.apiKeyEnv) {
    throw new Error(`LLM auth profile ${candidate.authProfile} requires apiKeyEnv.`);
  }
  return loadRequiredSecret(candidate.apiKeyEnv, paths);
}