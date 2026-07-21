import { access } from "node:fs/promises";

import { DEFAULT_LLM_TIMEOUT_MS, configExists, loadConfig } from "../../runtime/config.js";
import { loadEnvFile } from "../../runtime/env.js";
import { InvalidConfigError, MissingConfigError } from "../../runtime/errors.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { resolvePrimaryLlmCandidate } from "../../llm/resolve-config.js";

export interface UiStatusSummary {
  ok: boolean;
  config: {
    exists: boolean;
    path: string;
  };
  character: {
    exists: boolean;
    path: string;
  };
  prompt: {
    exists: boolean;
    path: string;
  };
  llm?: {
    provider: string;
    baseUrl: string;
    modelRef: string;
    authProfile: string;
    apiKeyEnv?: string;
    secretPresent: boolean;
    timeoutMs: number;
    fallbackCount: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

export async function getUiStatusSummary(paths: RuntimePaths = getRuntimePaths()): Promise<UiStatusSummary> {
  const hasConfig = await configExists(paths);
  const baseSummary = {
    config: { exists: hasConfig, path: paths.configPath },
    character: { exists: await fileExists(paths.characterPath), path: paths.characterPath },
    prompt: { exists: await fileExists(paths.systemPromptPath), path: paths.systemPromptPath },
  };

  if (!hasConfig) {
    return {
      ok: false,
      ...baseSummary,
      error: { code: "MissingConfig", message: new MissingConfigError(paths.configPath).message },
    };
  }

  try {
    const config = await loadConfig(paths);
    const envValues = await loadEnvFile(paths);
    const candidate = resolvePrimaryLlmCandidate(config);
    const secretPresent = candidate.mode === "local" || Boolean(candidate.apiKeyEnv && (process.env[candidate.apiKeyEnv] ?? envValues[candidate.apiKeyEnv]));

    return {
      ok: true,
      ...baseSummary,
      llm: {
        provider: candidate.provider,
        baseUrl: candidate.baseUrl ?? "SDK default",
        modelRef: candidate.modelRef,
        authProfile: candidate.authProfile,
        ...(candidate.apiKeyEnv === undefined ? {} : { apiKeyEnv: candidate.apiKeyEnv }),
        secretPresent,
        timeoutMs: config.llm.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
        fallbackCount: config.llm.fallbacks?.length ?? 0,
      },
    };
  } catch (error) {
    if (error instanceof InvalidConfigError) {
      return {
        ok: false,
        ...baseSummary,
        error: { code: "InvalidConfig", message: error.message },
      };
    }

    throw error;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}