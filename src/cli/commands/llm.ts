import { mkdir } from "node:fs/promises";
import { stdout as output } from "node:process";

import { BUILTIN_LLM_PROVIDERS, getBuiltinLlmProvider, type LlmAuthMode } from "../../llm/model-catalog.js";
import { buildModelRef } from "../../llm/model-ref.js";
import { getProviderAdapterMetadata } from "../../llm/adapters/registry.js";
import { testLlmModel } from "../../llm/provider-test.js";
import { resolvePrimaryLlmCandidate } from "../../llm/resolve-config.js";
import { DEFAULT_LLM_MAX_RETRIES, DEFAULT_LLM_RETRY_DELAY_MS, DEFAULT_LLM_TIMEOUT_MS, configExists, loadConfig, writeConfig, type AppConfig } from "../../runtime/config.js";
import { loadEnvFile, writeEnvFile } from "../../runtime/env.js";
import { MissingConfigError, UserFacingError } from "../../runtime/errors.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { createCliQuestioner } from "../prompt.js";
import { badge, bold, keyValue, title } from "../ui.js";

type AskLine = (question: string) => Promise<string>;
type AskHiddenLine = (question: string) => Promise<string>;

type ProviderId = "anthropic" | "openai" | "groq" | "openrouter" | "custom-openai" | "custom-anthropic" | "ollama" | "gemini" | "antigravity";
type AuthMode = LlmAuthMode;

interface Questioner {
  ask: AskLine;
  askHidden: AskHiddenLine;
  select: <T extends string>(question: string, choices: Array<{ name: string; value: T; description?: string }>) => Promise<T>;
  close: () => void;
}

interface LlmSetupOptions {
  argv?: string[];
  paths?: RuntimePaths;
  questioner?: Questioner;
  writeLine?: (message: string) => void;
  useColor?: boolean;
}

interface ProviderChoice {
  id: ProviderId;
  label: string;
  modes: AuthMode[];
}

interface LlmSetupSelection {
  provider: ProviderId;
  mode: AuthMode;
  runtimeProvider: string;
  modelRef: string;
  baseUrl?: string;
  model: string;
  apiKeyEnv?: string;
  secret?: string;
}

const PROVIDERS: ProviderChoice[] = BUILTIN_LLM_PROVIDERS.map((provider) => ({ id: provider.id as ProviderId, label: provider.label, modes: [...provider.authModes] }));

const MODE_LABELS: Record<AuthMode, string> = {
  "api-key": "API key",
  local: "Local",
  oauth: "OAuth",
};

export async function runLlmCommand(optionsOrArgv: string[] | LlmSetupOptions = process.argv): Promise<void> {
  const options = Array.isArray(optionsOrArgv) ? { argv: optionsOrArgv } : optionsOrArgv;
  const argv = options.argv ?? process.argv;
  const subcommand = argv[3];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printLlmHelp(options.writeLine ?? console.log);
    return;
  }

  if (subcommand === "providers") {
    printLlmProviders(options.writeLine ?? console.log);
    return;
  }

  if (subcommand === "models") {
    await runLlmModelsCommand(options);
    return;
  }

  if (subcommand === "test") {
    await runLlmTestCommand(options);
    return;
  }

  if (subcommand === "fallbacks") {
    await runLlmFallbacksCommand(options);
    return;
  }

  if (subcommand === "profiles") {
    await runLlmProfilesCommand(options);
    return;
  }

  if (subcommand !== "setup") {
    throw new UserFacingError(`Unknown llm command: ${subcommand}`, "UnknownLlmCommandError");
  }

  await runLlmSetupCommand(options);
}

async function runLlmModelsCommand(options: LlmSetupOptions = {}): Promise<void> {
  const argv = options.argv ?? process.argv;
  const action = argv[4];
  const writeLine = options.writeLine ?? console.log;

  if (action === "add") {
    const paths = options.paths ?? getRuntimePaths();
    const config = await loadExistingConfig(paths);
    const modelRef = readFlagValue(argv, "--model");
    const profileId = readFlagValue(argv, "--profile") ?? config.llm.authProfile;
    if (!modelRef) {
      throw new UserFacingError("Missing --model for llm models add.", "MissingLlmModelError");
    }
    const updatedConfig = addLlmModel(config, modelRef, profileId);
    await writeConfig(updatedConfig, paths);
    writeLine(`${badge("OK", "green")} LLM model added.`);
    writeLine(keyValue("Model", bold(modelRef)));
    writeLine(keyValue("Profile", profileId));
    return;
  }

  if (action === "remove") {
    const paths = options.paths ?? getRuntimePaths();
    const config = await loadExistingConfig(paths);
    const modelRef = readFlagValue(argv, "--model");
    if (!modelRef) {
      throw new UserFacingError("Missing --model for llm models remove.", "MissingLlmModelError");
    }
    const updatedConfig = removeLlmModel(config, modelRef);
    await writeConfig(updatedConfig, paths);
    writeLine(`${badge("OK", "green")} LLM model removed.`);
    writeLine(keyValue("Model", bold(modelRef)));
    return;
  }

  printLlmModels(argv, writeLine);
}

function addLlmModel(config: AppConfig, modelRef: string, profileId: string): AppConfig {
  if (!modelRef.includes("/")) {
    throw new UserFacingError("LLM model ref must use provider/model format.", "InvalidLlmModelRefError");
  }
  if (!config.llm.profiles[profileId]) {
    throw new UserFacingError(`Unknown LLM profile: ${profileId}`, "UnknownLlmProfileError");
  }

  return { ...config, llm: { ...config.llm, modelCatalog: { ...config.llm.modelCatalog, [modelRef]: { profile: profileId } } } };
}

function removeLlmModel(config: AppConfig, modelRef: string): AppConfig {
  assertKnownModelRef(config, modelRef);
  if (modelRef === config.llm.primary) {
    throw new UserFacingError("Primary LLM model cannot be removed.", "InvalidLlmModelRemovalError");
  }
  if ((config.llm.fallbacks ?? []).includes(modelRef)) {
    throw new UserFacingError("Fallback LLM model cannot be removed. Remove it from fallbacks first.", "InvalidLlmModelRemovalError");
  }

  const { [modelRef]: _removedModel, ...modelCatalog } = config.llm.modelCatalog;
  return { ...config, llm: { ...config.llm, modelCatalog } };
}

async function runLlmProfilesCommand(options: LlmSetupOptions = {}): Promise<void> {
  const argv = options.argv ?? process.argv;
  const action = argv[4];
  const writeLine = options.writeLine ?? console.log;

  if (!action || action === "--help" || action === "-h") {
    printLlmProfilesHelp(writeLine);
    return;
  }

  const paths = options.paths ?? getRuntimePaths();
  const config = await loadExistingConfig(paths);

  if (action === "list") {
    printLlmProfiles(config, writeLine);
    return;
  }

  if (action === "show") {
    const profileId = readFlagValue(argv, "--profile");
    if (!profileId) {
      throw new UserFacingError("Missing --profile for llm profiles show.", "MissingLlmProfileError");
    }
    printLlmProfile(config, profileId, writeLine);
    return;
  }

  if (action === "remove") {
    const profileId = readFlagValue(argv, "--profile");
    if (!profileId) {
      throw new UserFacingError("Missing --profile for llm profiles remove.", "MissingLlmProfileError");
    }
    const updatedConfig = removeLlmProfile(config, profileId);
    await writeConfig(updatedConfig, paths);
    writeLine(`${badge("OK", "green")} LLM profile removed.`);
    writeLine(keyValue("Profile", bold(profileId)));
    return;
  }

  throw new UserFacingError(`Unknown llm profiles command: ${action}`, "UnknownLlmProfilesCommandError");
}

function printLlmProfiles(config: AppConfig, writeLine: (message: string) => void): void {
  writeLine(title("LLM profiles"));
  const profileIds = Object.keys(config.llm.profiles).sort();
  if (profileIds.length === 0) {
    writeLine("No LLM profiles configured.");
    return;
  }

  for (const profileId of profileIds) {
    const profile = config.llm.profiles[profileId];
    const usedBy = Object.entries(config.llm.modelCatalog).filter(([, entry]) => entry.profile === profileId);
    const defaultLabel = profileId === config.llm.authProfile ? "\tdefault" : "";
    writeLine(`${profileId}\t${profile.provider}\t${profile.mode}\t${profile.baseUrl ?? "SDK default"}\t${usedBy.length} model${usedBy.length === 1 ? "" : "s"}${defaultLabel}`);
  }
}

function printLlmProfile(config: AppConfig, profileId: string, writeLine: (message: string) => void): void {
  const profile = config.llm.profiles[profileId];
  if (!profile) {
    throw new UserFacingError(`Unknown LLM profile: ${profileId}`, "UnknownLlmProfileError");
  }

  const modelRefs = Object.entries(config.llm.modelCatalog)
    .filter(([, entry]) => entry.profile === profileId)
    .map(([modelRef]) => modelRef)
    .sort();

  writeLine(title("LLM profile"));
  writeLine(keyValue("Profile", bold(profileId)));
  writeLine(keyValue("Provider", profile.provider));
  writeLine(keyValue("Mode", profile.mode));
  writeLine(keyValue("Base URL", profile.baseUrl ?? "SDK default"));
  writeLine(keyValue("API key env", profile.apiKeyEnv ?? "none"));
  writeLine(keyValue("Default", profileId === config.llm.authProfile ? "yes" : "no"));
  writeLine(keyValue("Models", modelRefs.length === 0 ? "none" : modelRefs.join(", ")));
}

function removeLlmProfile(config: AppConfig, profileId: string): AppConfig {
  if (!config.llm.profiles[profileId]) {
    throw new UserFacingError(`Unknown LLM profile: ${profileId}`, "UnknownLlmProfileError");
  }
  if (profileId === config.llm.authProfile) {
    throw new UserFacingError("Default LLM auth profile cannot be removed.", "InvalidLlmProfileRemovalError");
  }

  const modelRefs = Object.entries(config.llm.modelCatalog)
    .filter(([, entry]) => entry.profile === profileId)
    .map(([modelRef]) => modelRef);
  const activeModelRefs = new Set([config.llm.primary, ...(config.llm.fallbacks ?? [])]);
  const activeUses = modelRefs.filter((modelRef) => activeModelRefs.has(modelRef));
  if (activeUses.length > 0) {
    throw new UserFacingError(`LLM profile is used by active model refs: ${activeUses.join(", ")}`, "InvalidLlmProfileRemovalError");
  }

  const { [profileId]: _removedProfile, ...profiles } = config.llm.profiles;
  const modelCatalog = Object.fromEntries(Object.entries(config.llm.modelCatalog).filter(([, entry]) => entry.profile !== profileId));
  return { ...config, llm: { ...config.llm, profiles, modelCatalog } };
}

async function runLlmFallbacksCommand(options: LlmSetupOptions = {}): Promise<void> {
  const argv = options.argv ?? process.argv;
  const action = argv[4];
  const writeLine = options.writeLine ?? console.log;

  if (!action || action === "--help" || action === "-h") {
    printLlmFallbacksHelp(writeLine);
    return;
  }

  const paths = options.paths ?? getRuntimePaths();
  const config = await loadExistingConfig(paths);

  if (action === "list") {
    printLlmFallbacks(config, writeLine);
    return;
  }

  if (action === "add") {
    const modelRef = readFlagValue(argv, "--model");
    if (!modelRef) {
      throw new UserFacingError("Missing --model for llm fallbacks add.", "MissingLlmModelError");
    }
    const updatedConfig = addLlmFallback(config, modelRef);
    await writeConfig(updatedConfig, paths);
    writeLine(`${badge("OK", "green")} LLM fallback added.`);
    writeLine(keyValue("Model", bold(modelRef)));
    return;
  }

  if (action === "remove") {
    const modelRef = readFlagValue(argv, "--model");
    if (!modelRef) {
      throw new UserFacingError("Missing --model for llm fallbacks remove.", "MissingLlmModelError");
    }
    const updatedConfig = removeLlmFallback(config, modelRef);
    await writeConfig(updatedConfig, paths);
    writeLine(`${badge("OK", "green")} LLM fallback removed.`);
    writeLine(keyValue("Model", bold(modelRef)));
    return;
  }

  throw new UserFacingError(`Unknown llm fallbacks command: ${action}`, "UnknownLlmFallbacksCommandError");
}

function printLlmFallbacks(config: AppConfig, writeLine: (message: string) => void): void {
  writeLine(title("LLM fallbacks"));
  const fallbacks = config.llm.fallbacks ?? [];
  if (fallbacks.length === 0) {
    writeLine("No fallback models configured.");
    return;
  }

  for (const [index, modelRef] of fallbacks.entries()) {
    const profile = config.llm.modelCatalog[modelRef]?.profile ?? config.llm.authProfile;
    writeLine(`${index + 1}. ${modelRef}\t${profile}`);
  }
}

function addLlmFallback(config: AppConfig, modelRef: string): AppConfig {
  assertKnownModelRef(config, modelRef);
  if (modelRef === config.llm.primary) {
    throw new UserFacingError("Primary model cannot also be an LLM fallback.", "InvalidLlmFallbackError");
  }

  const fallbacks = config.llm.fallbacks ?? [];
  if (fallbacks.includes(modelRef)) {
    return config;
  }

  return { ...config, llm: { ...config.llm, fallbacks: [...fallbacks, modelRef] } };
}

function removeLlmFallback(config: AppConfig, modelRef: string): AppConfig {
  const fallbacks = config.llm.fallbacks ?? [];
  const nextFallbacks = fallbacks.filter((fallback) => fallback !== modelRef);
  const { fallbacks: _removed, ...llmWithoutFallbacks } = config.llm;
  return { ...config, llm: nextFallbacks.length === 0 ? llmWithoutFallbacks : { ...config.llm, fallbacks: nextFallbacks } };
}

function assertKnownModelRef(config: AppConfig, modelRef: string): void {
  if (!config.llm.modelCatalog[modelRef]) {
    throw new UserFacingError(`LLM model is not in llm.modelCatalog: ${modelRef}`, "UnknownLlmModelRefError");
  }
}

async function runLlmTestCommand(options: LlmSetupOptions = {}): Promise<void> {
  const paths = options.paths ?? getRuntimePaths();
  const writeLine = options.writeLine ?? console.log;
  const modelRef = readFlagValue(options.argv ?? process.argv, "--model");
  if (!modelRef) {
    throw new UserFacingError("Missing --model for llm test.", "MissingLlmModelError");
  }

  const config = await loadExistingConfig(paths);
  const result = await testLlmModel(config, modelRef, paths);
  if (result.ok) {
    writeLine(`${badge("OK", "green")} LLM model test passed.`);
    writeLine(keyValue("Model", bold(modelRef)));
    return;
  }

  writeLine(`${badge("FAIL", "red")} LLM model test failed.`);
  writeLine(keyValue("Model", modelRef));
  if (result.status !== undefined) {
    writeLine(keyValue("Status", String(result.status)));
  }
  writeLine(keyValue("Message", result.message ?? "Unknown provider test error."));
}

export async function runLlmSetupCommand(options: LlmSetupOptions = {}): Promise<void> {
  const paths = options.paths ?? getRuntimePaths();
  const writeLine = options.writeLine ?? console.log;
  const questioner = options.questioner ?? (await createCliQuestioner());

  try {
    await mkdir(paths.appDir, { recursive: true });
    const config = await loadExistingConfig(paths);
    const providerFlag = readFlagValue(options.argv ?? process.argv, "--provider");
    const setDefault = hasFlag(options.argv ?? process.argv, "--set-default");
    const selection = await collectLlmSetupSelection(questioner, providerFlag, writeLine);
    const updatedConfig = applyLlmSelection(config, selection, { setDefault });
    const envValues = await loadEnvFile(paths);

    await writeConfig(updatedConfig, paths);
    if (selection.secret !== undefined && selection.apiKeyEnv !== undefined) {
      await writeEnvFile({ ...envValues, [selection.apiKeyEnv]: selection.secret }, paths);
    }

    writeLine(`${badge("OK", "green")} LLM provider configured.`);
    const candidate = resolvePrimaryLlmCandidate(updatedConfig);
    writeLine(keyValue("Provider", candidate.provider));
    writeLine(keyValue("Base URL", candidate.baseUrl ?? "SDK default"));
    writeLine(keyValue("Model", bold(candidate.modelRef)));
    writeLine(keyValue("Auth profile", candidate.authProfile));
    writeLine(keyValue("API key env", candidate.apiKeyEnv ?? "none"));
  } finally {
    questioner.close();
  }
}

async function loadExistingConfig(paths: RuntimePaths): Promise<AppConfig> {
  if (!(await configExists(paths))) {
    throw new MissingConfigError(paths.configPath);
  }

  return loadConfig(paths);
}

async function collectLlmSetupSelection(questioner: Pick<Questioner, "ask" | "askHidden" | "select">, providerFlag: string | undefined, writeLine: (message: string) => void): Promise<LlmSetupSelection> {
  const provider = providerFlag === undefined ? await selectProvider(questioner.select, writeLine) : parseProvider(providerFlag);
  const providerConfig = getProvider(provider);
  const mode = await selectMode(questioner.select, providerConfig);
  const catalog = getBuiltinLlmProvider(provider);
  if (!catalog) {
    throw new UserFacingError(`Unsupported LLM provider: ${provider}`, "UnsupportedLlmProviderError");
  }

  if (mode === "oauth") {
    throw new UserFacingError(`${catalog.label} OAuth setup is not implemented yet. Choose an API-key or local provider for now.`, "UnsupportedLlmAuthModeError");
  }

  const baseUrl = catalog.runtimeProvider === "gemini" ? undefined : await askNonEmpty(questioner.ask, "Base URL", catalog.defaultBaseUrl);
  const model = await askModel(questioner, catalog.models, catalog.defaultModel);
  const modelRef = buildModelRef(catalog.id, model);

  if (mode === "local") {
    return { provider, mode, runtimeProvider: catalog.runtimeProvider, modelRef, baseUrl, model };
  }

  const apiKeyEnv = await askNonEmpty(questioner.ask, "API key env var name", catalog.defaultApiKeyEnv ?? "BESTIE_LLM_API_KEY");
  const secret = await askNonEmpty(questioner.askHidden, `API key for ${apiKeyEnv}`);
  return { provider, mode, runtimeProvider: catalog.runtimeProvider, modelRef, baseUrl, model, apiKeyEnv, secret };

  throw new UserFacingError(`Unsupported LLM setup path: ${provider}/${mode}`, "UnsupportedLlmSetupPathError");
}

function applyLlmSelection(config: AppConfig, selection: LlmSetupSelection, options: { setDefault: boolean }): AppConfig {
  const profileId = `${selection.provider}:${selection.mode}`;
  const shouldSetDefault = options.setDefault || config.llm.primary.trim() === "";
  return {
    ...config,
    llm: {
      ...config.llm,
      primary: shouldSetDefault ? selection.modelRef : config.llm.primary,
      authProfile: shouldSetDefault ? profileId : config.llm.authProfile,
      profiles: {
        ...config.llm.profiles,
        [profileId]: {
          provider: selection.runtimeProvider,
          mode: selection.mode,
          ...(selection.baseUrl === undefined ? {} : { baseUrl: selection.baseUrl.replace(/\/+$/, "") }),
          ...(selection.apiKeyEnv === undefined ? {} : { apiKeyEnv: selection.apiKeyEnv }),
        },
      },
      modelCatalog: {
        ...config.llm.modelCatalog,
        [selection.modelRef]: { profile: profileId },
      },
      timeoutMs: config.llm.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
      maxRetries: config.llm.maxRetries ?? DEFAULT_LLM_MAX_RETRIES,
      retryDelayMs: config.llm.retryDelayMs ?? DEFAULT_LLM_RETRY_DELAY_MS,
    },
  };
}

async function selectProvider(selectPrompt: Questioner["select"], writeLine: (message: string) => void): Promise<ProviderId> {
  writeLine(title("Supported LLM providers"));
  return selectPrompt("Choose provider", PROVIDERS.map((provider) => ({
    name: provider.label,
    value: provider.id,
    description: provider.modes.map((mode) => MODE_LABELS[mode]).join(" / "),
  })));
}

async function selectMode(selectPrompt: Questioner["select"], provider: ProviderChoice): Promise<AuthMode> {
  if (provider.modes.length === 1) {
    return provider.modes[0];
  }

  return selectPrompt(`Choose setup mode for ${provider.label}`, provider.modes.map((mode) => ({
    name: MODE_LABELS[mode],
    value: mode,
  })));
}

async function askNonEmpty(ask: AskLine, question: string, defaultValue?: string): Promise<string> {
  while (true) {
    const answer = (await ask(`${question}${defaultValue ? ` [${defaultValue}]` : ""} `)).trim();
    const value = answer || defaultValue;
    if (value) {
      return value;
    }
  }
}

function parseProvider(value: string): ProviderId {
  const trimmed = value.trim();
  const numeric = Number.parseInt(trimmed, 10);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= PROVIDERS.length) {
    return PROVIDERS[numeric - 1].id;
  }

  const normalized = normalizeChoice(trimmed);
  const provider = PROVIDERS.find((candidate) => normalizeChoice(candidate.id) === normalized || normalizeChoice(candidate.label) === normalized || providerAliases(candidate.id).includes(normalized));
  if (!provider) {
    throw new UserFacingError(`Unsupported LLM provider: ${value}`, "UnsupportedLlmProviderError");
  }

  return provider.id;
}

function getProvider(id: ProviderId): ProviderChoice {
  const provider = PROVIDERS.find((candidate) => candidate.id === id);
  if (!provider) {
    throw new UserFacingError(`Unsupported LLM provider: ${id}`, "UnsupportedLlmProviderError");
  }

  return provider;
}

function providerAliases(id: ProviderId): string[] {
  if (id === "anthropic") return ["claude"];
  if (id === "openai") return ["chatgpt", "openai", "chatgptopenai"];
  if (id === "groq") return ["groqcloud", "groq-cloud"];
  if (id === "openrouter") return ["open-router"];
  if (id === "custom-openai") return ["custom", "customprovider", "openai-compatible", "openaicompatible"];
  if (id === "custom-anthropic") return ["anthropic-compatible", "anthropiccompatible"];
  return [];
}

function normalizeChoice(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readFlagValue(argv: string[], flag: string): string | undefined {
  const equalsPrefix = `${flag}=`;
  const inline = argv.find((arg) => arg.startsWith(equalsPrefix));
  if (inline) {
    return inline.slice(equalsPrefix.length);
  }

  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function printLlmHelp(writeLine: (message: string) => void): void {
  writeLine(`Usage:\n  bestie llm setup [--provider anthropic|openai|groq|openrouter|custom-openai|custom-anthropic|ollama|gemini|antigravity] [--set-default]\n  bestie llm providers\n  bestie llm models --provider <provider>\n  bestie llm models add --model <provider/model> [--profile <profile>]\n  bestie llm models remove --model <provider/model>\n  bestie llm test --model <provider/model>\n  bestie llm profiles list|show|remove [--profile <profile>]\n  bestie llm fallbacks list|add|remove [--model <provider/model>]\n\nConfigure or inspect LLM provider profiles in ~/.bestie/config.json and ~/.bestie/.env. Existing primary model stays active unless --set-default is passed.\n\nProviders:\n  Anthropic: API key\n  ChatGPT/OpenAI: API key\n  Groq: API key\n  OpenRouter: API key\n  Custom OpenAI-Compatible: API key\n  Custom Anthropic-Compatible: API key\n  Ollama: Local\n  Gemini: API key\n  Antigravity: OAuth (not implemented yet)`);
}

function printLlmFallbacksHelp(writeLine: (message: string) => void): void {
  writeLine(`Usage:\n  bestie llm fallbacks list\n  bestie llm fallbacks add --model <provider/model>\n  bestie llm fallbacks remove --model <provider/model>\n\nFallback model refs must already exist in llm.modelCatalog. Use bestie llm setup --provider <provider> first to add a profile and model catalog entry.`);
}

function printLlmProfilesHelp(writeLine: (message: string) => void): void {
  writeLine(`Usage:\n  bestie llm profiles list\n  bestie llm profiles show --profile <profile>\n  bestie llm profiles remove --profile <profile>\n\nRemoving a profile also removes model catalog entries that point to it. Active primary/default/fallback profiles cannot be removed.`);
}

function printLlmProviders(writeLine: (message: string) => void): void {
  writeLine(title("Supported LLM providers"));
  for (const provider of BUILTIN_LLM_PROVIDERS) {
    const adapter = getProviderAdapterMetadata(provider.runtimeProvider);
    const capabilities = formatAdapterCapabilities(adapter);
    writeLine(`${provider.id}\t${provider.label}\t${provider.runtimeProvider}\t${provider.authModes.map((mode) => MODE_LABELS[mode]).join(" / ")}\t${capabilities}\tdefault ${buildModelRef(provider.id, provider.defaultModel)}`);
  }
}

function formatAdapterCapabilities(adapter: ReturnType<typeof getProviderAdapterMetadata>): string {
  const capabilities = [
    adapter.supportsStreaming ? "stream" : undefined,
    adapter.supportsVision ? "vision" : undefined,
    adapter.supportsToolCalls ? "tools" : undefined,
  ].filter(Boolean);

  return capabilities.length === 0 ? "text" : capabilities.join(",");
}

function printLlmModels(argv: string[], writeLine: (message: string) => void): void {
  const providerFlag = readFlagValue(argv, "--provider");
  if (!providerFlag) {
    throw new UserFacingError("Missing --provider for llm models.", "MissingLlmProviderError");
  }

  const provider = getBuiltinLlmProvider(parseProvider(providerFlag));
  if (!provider) {
    throw new UserFacingError(`Unsupported LLM provider: ${providerFlag}`, "UnsupportedLlmProviderError");
  }

  writeLine(title(`${provider.label} models`));
  if (provider.models.length === 0) {
    writeLine(`No built-in model list. Use a provider-specific model id with ${buildModelRef(provider.id, provider.defaultModel)} as the default placeholder.`);
    return;
  }

  for (const model of provider.models) {
    writeLine(`${buildModelRef(provider.id, model.id)}\t${model.label ?? model.id}${model.id === provider.defaultModel ? "\tdefault" : ""}`);
  }
}

async function askModel(questioner: Pick<Questioner, "ask" | "select">, models: Array<{ id: string; label?: string }>, defaultModel: string): Promise<string> {
  if (models.length === 0) {
    return askNonEmpty(questioner.ask, "Model", defaultModel);
  }

  const customValue = "__custom__";
  const selected = await questioner.select("Choose model", [
    ...models.map((model) => ({ name: model.label ?? model.id, value: model.id, description: model.id })),
    { name: "Custom model", value: customValue, description: "Type a provider-specific model id" },
  ]);
  return selected === customValue ? askNonEmpty(questioner.ask, "Model", defaultModel) : selected;
}
