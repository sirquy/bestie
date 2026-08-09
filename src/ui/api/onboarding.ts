import { generateCharacterConfig, generateSystemPrompt } from "../../character/prompt-generator.js";
import { writeCharacterFiles } from "../../character/writer.js";
import { mkdir } from "node:fs/promises";
import { buildModelRef, normalizeProviderId } from "../../llm/model-ref.js";
import { getBuiltinLlmProvider } from "../../llm/model-catalog.js";
import { DEFAULT_LLM_MAX_RETRIES, DEFAULT_LLM_RETRY_DELAY_MS, DEFAULT_LLM_TIMEOUT_MS, configExists, type AppConfig, type LlmAuthMode, writeConfig } from "../../runtime/config.js";
import { loadEnvFile, writeEnvFile } from "../../runtime/env.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

export interface UiOnboardingOptions {
  agentName: string;
  ownerName: string;
  language?: string;
  timeZone?: string;
  toneIntensity?: number;
  provider: string;
  mode?: LlmAuthMode;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  secret?: string;
  paths?: RuntimePaths;
}

export interface UiOnboardingResult {
  ok: true;
  modelRef: string;
  provider: string;
  secretRequired: boolean;
}

export async function runUiOnboarding(options: UiOnboardingOptions): Promise<UiOnboardingResult> {
  const paths = options.paths ?? getRuntimePaths();
  if (await configExists(paths)) throw new Error("Bestie is already configured. Update providers and settings from the dashboard instead.");
  const agentName = requireText(options.agentName, "Agent name");
  const ownerName = requireText(options.ownerName, "Your name");
  const catalog = getBuiltinLlmProvider(options.provider);
  if (!catalog) throw new Error(`Unsupported LLM provider: ${options.provider}`);

  const mode = options.mode ?? catalog.authModes[0];
  if (!catalog.authModes.includes(mode) || mode === "oauth") throw new Error(`Unsupported setup mode for ${catalog.label}.`);
  const secretRequired = mode === "api-key";
  const secret = options.secret?.trim();
  if (secretRequired && !secret) throw new Error("API key is required for this provider.");
  if (catalog.runtimeProvider === "gemini" && options.baseUrl?.trim()) throw new Error("Gemini API-key mode does not accept a custom base URL.");

  const language = options.language?.trim() || "vi";
  const timeZone = options.timeZone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Ho_Chi_Minh";
  const toneIntensity = clampTone(options.toneIntensity ?? 7);
  const model = options.model?.trim() || catalog.defaultModel;
  const profileId = `${normalizeProviderId(catalog.id)}:${mode}`;
  const modelRef = buildModelRef(catalog.id, model);
  const apiKeyEnv = mode === "local" ? undefined : options.apiKeyEnv?.trim() || catalog.defaultApiKeyEnv || "BESTIE_LLM_API_KEY";
  const baseUrl = catalog.runtimeProvider === "claude-cli" || catalog.runtimeProvider === "codex-cli" || catalog.runtimeProvider === "gemini-cli" || catalog.runtimeProvider === "gemini"
    ? undefined
    : (options.baseUrl?.trim() || catalog.defaultBaseUrl)?.replace(/\/+$/, "");
  if (baseUrl === "") throw new Error("Provider base URL is required.");

  const config: AppConfig = {
    version: 2,
    agent: { name: agentName, ownerName, language, timeZone, toneIntensity },
    llm: {
      primary: modelRef,
      authProfile: profileId,
      profiles: { [profileId]: { provider: catalog.runtimeProvider, mode, ...(baseUrl ? { baseUrl } : {}), ...(apiKeyEnv ? { apiKeyEnv } : {}) } },
      modelCatalog: { [modelRef]: { profile: profileId } },
      timeoutMs: DEFAULT_LLM_TIMEOUT_MS,
      maxRetries: DEFAULT_LLM_MAX_RETRIES,
      retryDelayMs: DEFAULT_LLM_RETRY_DELAY_MS,
    },
    memory: { writePolicy: "ask", deletePolicy: "ask" },
  };
  const character = generateCharacterConfig({ name: agentName, ownerName, language, timeZone, toneIntensity });
  await mkdir(paths.appDir, { recursive: true });
  await writeConfig(config, paths);
  await writeCharacterFiles(character, generateSystemPrompt(character), paths);
  if (apiKeyEnv && secret) await writeEnvFile({ ...await loadEnvFile(paths), [apiKeyEnv]: secret }, paths);

  return { ok: true, modelRef, provider: catalog.label, secretRequired };
}

function requireText(value: string, label: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function clampTone(value: number): number {
  if (!Number.isFinite(value)) return 7;
  return Math.max(1, Math.min(10, Math.round(value)));
}
