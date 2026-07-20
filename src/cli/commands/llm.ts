import { mkdir } from "node:fs/promises";
import { stdout as output } from "node:process";

import { DEFAULT_LLM_MAX_RETRIES, DEFAULT_LLM_RETRY_DELAY_MS, DEFAULT_LLM_TIMEOUT_MS, configExists, loadConfig, writeConfig, type AppConfig } from "../../runtime/config.js";
import { loadEnvFile, writeEnvFile } from "../../runtime/env.js";
import { MissingConfigError, UserFacingError } from "../../runtime/errors.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { createCliQuestioner } from "../prompt.js";
import { badge, bold, keyValue, title } from "../ui.js";

type AskLine = (question: string) => Promise<string>;
type AskHiddenLine = (question: string) => Promise<string>;

type ProviderId = "anthropic" | "openai" | "custom" | "ollama" | "gemini" | "antigravity";
type AuthMode = "api-key" | "subscription-oauth" | "anthropic-compatible" | "openai-compatible" | "cloud" | "local" | "oauth";

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
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  secret?: string;
}

const PROVIDERS: ProviderChoice[] = [
  { id: "anthropic", label: "Anthropic", modes: ["subscription-oauth", "api-key"] },
  { id: "openai", label: "ChatGPT/OpenAI", modes: ["subscription-oauth", "api-key"] },
  { id: "custom", label: "Custom Provider", modes: ["anthropic-compatible", "openai-compatible"] },
  { id: "ollama", label: "Ollama", modes: ["cloud", "local"] },
  { id: "gemini", label: "Gemini", modes: ["oauth"] },
  { id: "antigravity", label: "Antigravity", modes: ["oauth"] },
];

const MODE_LABELS: Record<AuthMode, string> = {
  "api-key": "API key",
  "subscription-oauth": "Subscription OAuth",
  "anthropic-compatible": "Anthropic-Compatible",
  "openai-compatible": "OpenAI-Compatible",
  cloud: "Cloud",
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

  if (subcommand !== "setup") {
    throw new UserFacingError(`Unknown llm command: ${subcommand}`, "UnknownLlmCommandError");
  }

  await runLlmSetupCommand(options);
}

export async function runLlmSetupCommand(options: LlmSetupOptions = {}): Promise<void> {
  const paths = options.paths ?? getRuntimePaths();
  const writeLine = options.writeLine ?? console.log;
  const questioner = options.questioner ?? (await createCliQuestioner());

  try {
    await mkdir(paths.appDir, { recursive: true });
    const config = await loadExistingConfig(paths);
    const providerFlag = readFlagValue(options.argv ?? process.argv, "--provider");
    const selection = await collectLlmSetupSelection(questioner, providerFlag, writeLine);
    const updatedConfig = applyLlmSelection(config, selection);
    const envValues = await loadEnvFile(paths);

    await writeConfig(updatedConfig, paths);
    if (selection.secret !== undefined) {
      await writeEnvFile({ ...envValues, [selection.apiKeyEnv]: selection.secret }, paths);
    }

    writeLine(`${badge("OK", "green")} LLM provider configured.`);
    writeLine(keyValue("Provider", updatedConfig.llm.provider));
    writeLine(keyValue("Base URL", updatedConfig.llm.baseUrl));
    writeLine(keyValue("Model", bold(updatedConfig.llm.model)));
    writeLine(keyValue("API key env", updatedConfig.llm.apiKeyEnv));

    const oauthMessage = buildOauthSetupMessage(selection);
    if (oauthMessage) {
      writeLine(oauthMessage);
    }
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

  if ((provider === "anthropic" || provider === "openai") && mode === "subscription-oauth") {
    return collectSubscriptionOauthSelection(questioner.ask, provider, mode);
  }

  if (provider === "anthropic" && mode === "api-key") {
    return collectApiKeySelection(questioner, { provider, mode, baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5", apiKeyEnv: "ANTHROPIC_API_KEY" });
  }

  if (provider === "openai" && mode === "api-key") {
    return collectApiKeySelection(questioner, { provider, mode, baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKeyEnv: "OPENAI_API_KEY" });
  }

  if (provider === "custom") {
    const compatibleProvider = mode === "anthropic-compatible" ? "anthropic" : "openai-compatible";
    const defaultEnv = mode === "anthropic-compatible" ? "CUSTOM_ANTHROPIC_API_KEY" : "CUSTOM_OPENAI_API_KEY";
    return collectApiKeySelection(questioner, { provider, mode, baseUrl: "https://provider.example/v1", model: "provider-model-name", apiKeyEnv: defaultEnv, configProvider: compatibleProvider });
  }

  if (provider === "ollama" && mode === "local") {
    const baseUrl = await askNonEmpty(questioner.ask, "Ollama local base URL", "http://127.0.0.1:11434/v1");
    const model = await askNonEmpty(questioner.ask, "Ollama model", "llama3.1");
    return { provider, mode, baseUrl, model, apiKeyEnv: "OLLAMA_API_KEY", secret: "ollama" };
  }

  if (provider === "ollama" && mode === "cloud") {
    return collectApiKeySelection(questioner, { provider, mode, baseUrl: "https://ollama.com/v1", model: "gpt-oss:20b", apiKeyEnv: "OLLAMA_API_KEY", configProvider: "openai-compatible" });
  }

  if (provider === "gemini" || provider === "antigravity") {
    return collectGenericOauthSelection(questioner.ask, provider, mode);
  }

  throw new UserFacingError(`Unsupported LLM setup path: ${provider}/${mode}`, "UnsupportedLlmSetupPathError");
}

async function collectApiKeySelection(questioner: Pick<Questioner, "ask" | "askHidden">, defaults: { provider: ProviderId; mode: AuthMode; baseUrl: string; model: string; apiKeyEnv: string; configProvider?: string }): Promise<LlmSetupSelection> {
  const baseUrl = await askNonEmpty(questioner.ask, "Base URL", defaults.baseUrl);
  const model = await askNonEmpty(questioner.ask, "Model", defaults.model);
  const apiKeyEnv = await askNonEmpty(questioner.ask, "API key env var name", defaults.apiKeyEnv);
  const secret = await askNonEmpty(questioner.askHidden, `API key for ${apiKeyEnv}`);
  return { provider: defaults.provider, mode: defaults.mode, baseUrl, model, apiKeyEnv, secret, ...(defaults.configProvider ? { providerOverride: defaults.configProvider } : {}) } as LlmSetupSelection & { providerOverride?: string };
}

async function collectSubscriptionOauthSelection(ask: AskLine, provider: ProviderId, mode: AuthMode): Promise<LlmSetupSelection> {
  const defaults = provider === "anthropic"
    ? { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5", apiKeyEnv: "ANTHROPIC_OAUTH_TOKEN" }
    : { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKeyEnv: "OPENAI_OAUTH_TOKEN" };
  const baseUrl = await askNonEmpty(ask, "Base URL", defaults.baseUrl);
  const model = await askNonEmpty(ask, "Model", defaults.model);
  const apiKeyEnv = await askNonEmpty(ask, "OAuth token env var name", defaults.apiKeyEnv);
  return { provider, mode, baseUrl, model, apiKeyEnv };
}

async function collectGenericOauthSelection(ask: AskLine, provider: ProviderId, mode: AuthMode): Promise<LlmSetupSelection> {
  const defaults = provider === "gemini"
    ? { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash", apiKeyEnv: "GEMINI_OAUTH_TOKEN" }
    : { baseUrl: "https://api.antigravity.example/v1", model: "antigravity-default", apiKeyEnv: "ANTIGRAVITY_OAUTH_TOKEN" };
  const baseUrl = await askNonEmpty(ask, "Base URL", defaults.baseUrl);
  const model = await askNonEmpty(ask, "Model", defaults.model);
  const apiKeyEnv = await askNonEmpty(ask, "OAuth token env var name", defaults.apiKeyEnv);
  return { provider, mode, baseUrl, model, apiKeyEnv };
}

function applyLlmSelection(config: AppConfig, selection: LlmSetupSelection): AppConfig {
  const providerOverride = "providerOverride" in selection && typeof selection.providerOverride === "string" ? selection.providerOverride : undefined;
  return {
    ...config,
    llm: {
      ...config.llm,
      provider: providerOverride ?? toConfigProvider(selection.provider, selection.mode),
      baseUrl: selection.baseUrl.replace(/\/+$/, ""),
      model: selection.model,
      apiKeyEnv: selection.apiKeyEnv,
      timeoutMs: config.llm.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
      maxRetries: config.llm.maxRetries ?? DEFAULT_LLM_MAX_RETRIES,
      retryDelayMs: config.llm.retryDelayMs ?? DEFAULT_LLM_RETRY_DELAY_MS,
    },
  };
}

function toConfigProvider(provider: ProviderId, mode: AuthMode): string {
  if (provider === "anthropic") return "anthropic";
  if (provider === "openai") return "openai";
  if (provider === "ollama") return "openai-compatible";
  if (provider === "gemini") return "openai-compatible";
  if (provider === "antigravity") return "openai-compatible";
  return mode === "anthropic-compatible" ? "anthropic" : "openai-compatible";
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

function buildOauthSetupMessage(selection: LlmSetupSelection): string | undefined {
  if (selection.mode !== "oauth" && selection.mode !== "subscription-oauth") {
    return undefined;
  }

  return `${badge("NEXT", "yellow")} OAuth browser login for ${selection.provider} is not automated yet. Put the provider access token in ${selection.apiKeyEnv}, then run \`bestie doctor\` or \`bestie chat\`.`;
}

function printLlmHelp(writeLine: (message: string) => void): void {
  writeLine(`Usage: bestie llm setup [--provider anthropic|openai|custom|ollama|gemini|antigravity]\n\nConfigure the active LLM provider in ~/.bestie/config.json and ~/.bestie/.env.\n\nProviders:\n  Anthropic: Subscription OAuth or API key\n  ChatGPT/OpenAI: Subscription OAuth or API key\n  Custom Provider: Anthropic-Compatible or OpenAI-Compatible\n  Ollama: Cloud or Local\n  Gemini: OAuth\n  Antigravity: OAuth`);
}
