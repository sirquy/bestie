import { DEFAULT_LLM_MAX_RETRIES, DEFAULT_LLM_RETRY_DELAY_MS, DEFAULT_LLM_TIMEOUT_MS, configExists, loadConfig, writeConfig, type LlmAuthMode } from "../../runtime/config.js";
import { loadEnvFile, writeEnvFile } from "../../runtime/env.js";
import { InvalidConfigError, MissingConfigError } from "../../runtime/errors.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { buildModelRef, normalizeProviderId } from "../../llm/model-ref.js";
import { getBuiltinLlmProvider } from "../../llm/model-catalog.js";
import { testLlmModel, type ProviderTestResult } from "../../llm/provider-test.js";
import { resolveLlmCandidate } from "../../llm/resolve-config.js";

export interface UiProviderSummary {
  ok: boolean;
  primary?: UiProviderCandidate;
  fallbacks: UiProviderCandidate[];
  profiles: UiProviderProfile[];
  models: UiProviderModel[];
  error?: {
    code: string;
    message: string;
  };
}

export interface UiProviderCandidate {
  modelRef: string;
  provider: string;
  model: string;
  authProfile: string;
  baseUrl: string;
  apiKeyEnv?: string;
  secretPresent: boolean;
}

export interface UiProviderProfile {
  id: string;
  provider: string;
  mode: string;
  baseUrl: string;
  apiKeyEnv?: string;
  secretPresent: boolean;
  usedBy: string[];
}

export interface UiProviderModel {
  modelRef: string;
  profile: string;
  primary: boolean;
  fallback: boolean;
}

export interface UiProviderTestOptions {
  modelRef?: string;
  paths?: RuntimePaths;
}

export interface UiProviderPrimaryOptions {
  modelRef: string;
  paths?: RuntimePaths;
}

export interface UiProviderFallbackOptions {
  action: "add" | "remove";
  modelRef: string;
  paths?: RuntimePaths;
}

export interface UiProviderSetupOptions {
  provider: string;
  mode?: LlmAuthMode;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  secret?: string;
  setDefault?: boolean;
  paths?: RuntimePaths;
}

export interface UiProviderTestResult extends ProviderTestResult {
  modelRef: string;
}

export async function getUiProviderSummary(paths: RuntimePaths = getRuntimePaths()): Promise<UiProviderSummary> {
  if (!await configExists(paths)) {
    return {
      ok: false,
      fallbacks: [],
      profiles: [],
      models: [],
      error: { code: "MissingConfig", message: new MissingConfigError(paths.configPath).message },
    };
  }

  try {
    const config = await loadConfig(paths);
    const envValues = await loadEnvFile(paths);
    const fallbackRefs = config.llm.fallbacks ?? [];
    const secretPresent = (apiKeyEnv?: string, mode?: string) => mode === "local" || Boolean(apiKeyEnv && (process.env[apiKeyEnv] ?? envValues[apiKeyEnv]));
    const toCandidate = (modelRef: string): UiProviderCandidate => {
      const candidate = resolveLlmCandidate(config, modelRef);
      return {
        modelRef: candidate.modelRef,
        provider: candidate.provider,
        model: candidate.model,
        authProfile: candidate.authProfile,
        baseUrl: candidate.baseUrl ?? "SDK default",
        ...(candidate.apiKeyEnv === undefined ? {} : { apiKeyEnv: candidate.apiKeyEnv }),
        secretPresent: secretPresent(candidate.apiKeyEnv, candidate.mode),
      };
    };

    const profiles = Object.entries(config.llm.profiles).sort(([left], [right]) => left.localeCompare(right)).map(([id, profile]) => ({
      id,
      provider: profile.provider,
      mode: profile.mode,
      baseUrl: profile.baseUrl ?? "SDK default",
      ...(profile.apiKeyEnv === undefined ? {} : { apiKeyEnv: profile.apiKeyEnv }),
      secretPresent: secretPresent(profile.apiKeyEnv, profile.mode),
      usedBy: Object.entries(config.llm.modelCatalog).filter(([, entry]) => entry.profile === id).map(([modelRef]) => modelRef).sort(),
    }));

    const models = Object.entries(config.llm.modelCatalog).sort(([left], [right]) => left.localeCompare(right)).map(([modelRef, entry]) => ({
      modelRef,
      profile: entry.profile,
      primary: modelRef === config.llm.primary,
      fallback: fallbackRefs.includes(modelRef),
    }));

    return {
      ok: true,
      primary: toCandidate(config.llm.primary),
      fallbacks: fallbackRefs.map(toCandidate),
      profiles,
      models,
    };
  } catch (error) {
    if (error instanceof InvalidConfigError) {
      return { ok: false, fallbacks: [], profiles: [], models: [], error: { code: "InvalidConfig", message: error.message } };
    }

    throw error;
  }
}

export async function runUiProviderTest(options: UiProviderTestOptions = {}): Promise<UiProviderTestResult> {
  const paths = options.paths ?? getRuntimePaths();
  if (!await configExists(paths)) {
    throw new MissingConfigError(paths.configPath);
  }

  const config = await loadConfig(paths);
  const modelRef = options.modelRef ?? config.llm.primary;
  const result = await testLlmModel(config, modelRef, paths);
  return { ...redactProviderTestResult(result), modelRef };
}

export async function setUiProviderPrimary(options: UiProviderPrimaryOptions): Promise<UiProviderSummary> {
  const paths = options.paths ?? getRuntimePaths();
  if (!await configExists(paths)) {
    throw new MissingConfigError(paths.configPath);
  }

  const config = await loadConfig(paths);
  if (!config.llm.modelCatalog[options.modelRef]) {
    throw new Error(`Unknown LLM model ref: ${options.modelRef}`);
  }

  const fallbacks = (config.llm.fallbacks ?? []).filter((modelRef) => modelRef !== options.modelRef);
  const { fallbacks: _oldFallbacks, ...llmWithoutFallbacks } = config.llm;
  const nextConfig = {
    ...config,
    llm: fallbacks.length === 0 ? { ...llmWithoutFallbacks, primary: options.modelRef } : { ...config.llm, primary: options.modelRef, fallbacks },
  };

  await writeConfig(nextConfig, paths);
  return getUiProviderSummary(paths);
}

export async function updateUiProviderFallback(options: UiProviderFallbackOptions): Promise<UiProviderSummary> {
  const paths = options.paths ?? getRuntimePaths();
  if (!await configExists(paths)) {
    throw new MissingConfigError(paths.configPath);
  }

  const config = await loadConfig(paths);
  if (!config.llm.modelCatalog[options.modelRef]) {
    throw new Error(`Unknown LLM model ref: ${options.modelRef}`);
  }
  if (options.action === "add" && options.modelRef === config.llm.primary) {
    throw new Error("Primary model cannot also be a fallback.");
  }

  const currentFallbacks = config.llm.fallbacks ?? [];
  const nextFallbacks = options.action === "add"
    ? currentFallbacks.includes(options.modelRef) ? currentFallbacks : [...currentFallbacks, options.modelRef]
    : currentFallbacks.filter((modelRef) => modelRef !== options.modelRef);
  const { fallbacks: _oldFallbacks, ...llmWithoutFallbacks } = config.llm;
  const nextConfig = {
    ...config,
    llm: nextFallbacks.length === 0 ? llmWithoutFallbacks : { ...config.llm, fallbacks: nextFallbacks },
  };

  await writeConfig(nextConfig, paths);
  return getUiProviderSummary(paths);
}

export async function setupUiProvider(options: UiProviderSetupOptions): Promise<UiProviderSummary> {
  const paths = options.paths ?? getRuntimePaths();
  if (!await configExists(paths)) {
    throw new MissingConfigError(paths.configPath);
  }

  const catalog = getBuiltinLlmProvider(options.provider);
  if (!catalog) {
    throw new Error(`Unsupported LLM provider: ${options.provider}`);
  }

  const mode = options.mode ?? catalog.authModes[0];
  if (!catalog.authModes.includes(mode)) {
    throw new Error(`Unsupported auth mode for ${catalog.id}: ${mode}`);
  }
  if (mode === "oauth") {
    throw new Error(`${catalog.label} OAuth setup is not implemented yet.`);
  }
  if (catalog.runtimeProvider === "gemini" && options.baseUrl !== undefined) {
    throw new Error("Gemini API-key mode uses the native SDK endpoint and does not accept baseUrl.");
  }

  const config = await loadConfig(paths);
  const model = options.model?.trim() || catalog.defaultModel;
  const modelRef = buildModelRef(catalog.id, model);
  const profileId = `${normalizeProviderId(catalog.id)}:${mode}`;
  const apiKeyEnv = mode === "local" ? undefined : options.apiKeyEnv?.trim() || catalog.defaultApiKeyEnv || "BESTIE_LLM_API_KEY";
  const shouldSetDefault = Boolean(options.setDefault);
  const updatedConfig = {
    ...config,
    llm: {
      ...config.llm,
      primary: shouldSetDefault ? modelRef : config.llm.primary,
      authProfile: shouldSetDefault ? profileId : config.llm.authProfile,
      profiles: {
        ...config.llm.profiles,
        [profileId]: {
          provider: catalog.runtimeProvider,
          mode,
          ...(catalog.runtimeProvider === "gemini" || mode === "local" ? {} : { baseUrl: (options.baseUrl?.trim() || catalog.defaultBaseUrl).replace(/\/+$/, "") }),
          ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
        },
      },
      modelCatalog: {
        ...config.llm.modelCatalog,
        [modelRef]: { profile: profileId },
      },
      timeoutMs: config.llm.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
      maxRetries: config.llm.maxRetries ?? DEFAULT_LLM_MAX_RETRIES,
      retryDelayMs: config.llm.retryDelayMs ?? DEFAULT_LLM_RETRY_DELAY_MS,
    },
  };

  await writeConfig(updatedConfig, paths);
  if (apiKeyEnv !== undefined && options.secret !== undefined) {
    const envValues = await loadEnvFile(paths);
    await writeEnvFile({ ...envValues, [apiKeyEnv]: options.secret }, paths);
  }

  return getUiProviderSummary(paths);
}

function redactProviderTestResult(result: ProviderTestResult): ProviderTestResult {
  return {
    ...result,
    ...(result.message === undefined ? {} : { message: result.message.slice(0, 500) }),
  };
}