import { mkdir } from "node:fs/promises";
import { stdout as output } from "node:process";

import { generateCharacterConfig, generateSystemPrompt } from "../../character/prompt-generator.js";
import { writeCharacterFiles } from "../../character/writer.js";
import { testOpenAICompatibleProvider } from "../../llm/provider-test.js";
import { DEFAULT_LLM_MAX_RETRIES, DEFAULT_LLM_RETRY_DELAY_MS, DEFAULT_LLM_TIMEOUT_MS, type AppConfig, writeConfig } from "../../runtime/config.js";
import { writeEnvFile } from "../../runtime/env.js";
import { getLocalTimeZone, isValidTimeZone, normalizeLanguageInput, normalizeTimeZoneInput } from "../../runtime/locale.js";
import { appendLog } from "../../runtime/logger.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { createCliQuestioner } from "../prompt.js";
import { badge, bold, color, dim, title, withColorMode } from "../ui.js";

const DEFAULT_API_KEY_ENV = "OPENAI_API_KEY";

type LanguageMode = AppConfig["agent"]["language"];
type MemoryWritePolicy = NonNullable<AppConfig["memory"]>["writePolicy"];
type AskLine = (question: string) => Promise<string>;

interface Questioner {
  ask: AskLine;
  askHidden: AskLine;
  close: () => void;
}

interface OnboardingAnswers {
  agentName: string;
  ownerName: string;
  language: LanguageMode;
  timeZone: string;
  toneIntensity: number;
  memoryWritePolicy: MemoryWritePolicy;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

interface OnboardCommandOptions {
  argv?: string[];
  paths?: RuntimePaths;
  questioner?: Questioner;
  providerTest?: (config: AppConfig, apiKey: string, paths: RuntimePaths, writeLine: (message: string) => void) => Promise<void>;
  writeLine?: (message: string) => void;
  useColor?: boolean;
}

interface ProviderTestReporter {
  pending: (message: string) => void;
  success: (message: string) => void;
  failure: (message: string, detail?: string) => void;
}

interface OnboardUi {
  intro: (paths: RuntimePaths, shouldSkipProviderTest: boolean) => void;
  section: (title: string, detail?: string) => void;
  success: (message: string) => void;
  info: (message: string) => void;
  savedPath: (label: string, path: string) => void;
  final: () => void;
}

interface PromptTheme {
  step: (step: number, total: number, label: string, text: string) => string;
  defaultValue: (value: string) => string;
  warning: (message: string) => string;
}

let promptTheme: PromptTheme = createPromptTheme(output.isTTY);
let providerTestReporter: ProviderTestReporter = createProviderTestReporter(console.log, output.isTTY);
let promptWarningWriter: (message: string) => void = console.log;

export async function runOnboardCommand(optionsOrArgv: string[] | OnboardCommandOptions = process.argv): Promise<void> {
  const options = Array.isArray(optionsOrArgv) ? { argv: optionsOrArgv } : optionsOrArgv;
  const paths = options.paths ?? getRuntimePaths();
  const writeLine = options.writeLine ?? console.log;
  const providerTest = options.providerTest ?? runProviderTest;
  const argv = options.argv ?? process.argv;
  const shouldSkipProviderTest = argv.includes("--skip-provider-test");
  const ui = createOnboardUi(writeLine, options.useColor ?? output.isTTY);
  promptTheme = createPromptTheme(options.useColor ?? output.isTTY);
  providerTestReporter = createProviderTestReporter(writeLine, options.useColor ?? output.isTTY);
  promptWarningWriter = writeLine;
  await mkdir(paths.appDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await appendLog({ event: "command_start", detail: { command: "onboard" } }, { paths });

  ui.intro(paths, shouldSkipProviderTest);

  const questioner = options.questioner ?? (await createQuestioner());

  try {
    ui.section("Profile", "Choose the name, language, tone, and memory policy.");
    const answers = await collectAnswers(questioner);
    ui.success("Profile and provider details collected.");

    ui.section("Generate", "Building local character files and provider config.");
    const config = buildConfig(answers);
    const character = generateCharacterConfig({
      name: answers.agentName,
      ownerName: answers.ownerName,
      language: answers.language,
      timeZone: answers.timeZone,
      toneIntensity: answers.toneIntensity,
    });
    const systemPrompt = generateSystemPrompt(character);

    await writeConfig(config, paths);
    await writeEnvFile({ [DEFAULT_API_KEY_ENV]: answers.apiKey }, paths);
    await writeCharacterFiles(character, systemPrompt, paths);
    ui.success("Local runtime files written.");

    ui.section("Files", "Everything is stored under your home runtime.");
    ui.savedPath("Config", paths.configPath);
    ui.savedPath("Secrets", paths.envPath);
    ui.savedPath("Character", paths.characterPath);
    ui.savedPath("System prompt", paths.systemPromptPath);

    if (shouldSkipProviderTest) {
      await appendLog({ event: "provider_test_skipped", detail: { reason: "skip_provider_test_flag" } }, { paths });
      ui.info("Provider test skipped. Run `bestie doctor` and try chat when your provider is ready.");
    } else {
      ui.section("Provider test", "Sending one tiny completion to check your setup.");
      await providerTest(config, answers.apiKey, paths, writeLine);
    }
    ui.final();
  } finally {
    questioner.close();
  }
}

async function createQuestioner(): Promise<Questioner> {
  return createCliQuestioner();
}

async function collectAnswers(questioner: Pick<Questioner, "ask" | "askHidden">): Promise<OnboardingAnswers> {
  const { ask, askHidden } = questioner;
  const agentName = await askNonEmpty(ask, promptTheme.step(1, 10, "Bestie name", "What should your bestie be called?"), "Bestie");
  const ownerName = await askNonEmpty(ask, promptTheme.step(2, 10, "Your name", "What should it call you?"), "boss");
  const language = await askLanguage(ask);
  const timeZone = await askTimeZone(ask);
  const toneIntensity = await askToneIntensity(ask);
  const memoryWritePolicy = await askMemoryWritePolicy(ask);
  const provider = await askNonEmpty(ask, promptTheme.step(7, 10, "Provider", "Provider label?"), "openai-compatible");
  const baseUrl = await askNonEmpty(ask, promptTheme.step(8, 10, "Base URL", "OpenAI-compatible base URL?"), "https://api.openai.com/v1");
  const model = await askNonEmpty(ask, promptTheme.step(9, 10, "Model", "Model name?"), "gpt-4o-mini");
  const apiKey = await askNonEmpty(askHidden, promptTheme.step(10, 10, "API key", `Paste your provider API key. It will be saved as ${DEFAULT_API_KEY_ENV} and hidden while typing.`));

  return { agentName, ownerName, language, timeZone, toneIntensity, memoryWritePolicy, provider, baseUrl, model, apiKey };
}

async function askNonEmpty(
  ask: AskLine,
  question: string,
  defaultValue?: string,
): Promise<string> {
  while (true) {
    const suffix = defaultValue ? `${promptTheme.defaultValue(defaultValue)} ` : "";
    const answer = (await ask(`${question}${suffix}`)).trim();
    const value = answer || defaultValue;

    if (value) {
      return value;
    }

    promptWarningWriter(promptTheme.warning("Please enter a value."));
  }
}

async function askLanguage(ask: AskLine): Promise<LanguageMode> {
  const answer = await ask(`${promptTheme.step(3, 10, "Language", "Default language tag or name? Examples: vi, English, ja, pt-BR, auto.")}${promptTheme.defaultValue("vi")} `);
  return normalizeLanguageInput(answer, "vi");
}

async function askTimeZone(ask: AskLine): Promise<string> {
  const defaultTimeZone = getLocalTimeZone();

  while (true) {
    const answer = await ask(`${promptTheme.step(4, 10, "Time zone", "IANA time zone for local dates and schedules?")}${promptTheme.defaultValue(defaultTimeZone)} `);
    const timeZone = normalizeTimeZoneInput(answer, defaultTimeZone);

    if (isValidTimeZone(timeZone)) {
      return timeZone;
    }

    promptWarningWriter(promptTheme.warning("Use a valid IANA time zone, for example Asia/Ho_Chi_Minh or America/New_York."));
  }
}

async function askToneIntensity(ask: AskLine): Promise<number> {
  while (true) {
    const answer = (await ask(`${promptTheme.step(5, 10, "Tone", "Tone intensity from 1 to 10?")}${promptTheme.defaultValue("7")} `)).trim();
    const value = Number(answer || "7");

    if (Number.isInteger(value) && value >= 1 && value <= 10) {
      return value;
    }

    promptWarningWriter(promptTheme.warning("Choose a whole number from 1 to 10."));
  }
}

async function askMemoryWritePolicy(ask: AskLine): Promise<MemoryWritePolicy> {
  while (true) {
    const answer = (await ask(`${promptTheme.step(6, 10, "Memory", "Memory write policy: ask, allow, or deny?")}${promptTheme.defaultValue("ask")} `)).trim().toLowerCase();

    if (!answer || answer === "ask") {
      return "ask";
    }

    if (answer === "allow" || answer === "deny") {
      return answer;
    }

    promptWarningWriter(promptTheme.warning("Choose ask, allow, or deny."));
  }
}

function createOnboardUi(writeLine: (message: string) => void, useColor: boolean): OnboardUi {
  const render = withColorMode(useColor);

  return {
    intro: (paths, shouldSkipProviderTest) => {
      writeLine(render(() => title("Bestie Onboarding")));
      writeLine(render(() => dim("A local-first setup wizard for your companion runtime.")));
      writeLine(`${render(() => color("cyan", "Runtime"))} ${paths.appDir}`);
      writeLine(`${render(() => color("cyan", "Privacy"))} Secrets stay local in .bestie/.env and are hidden while typing.`);
      writeLine(render(() => shouldSkipProviderTest ? `${dim("Plan")} Profile -> Generate -> Files\n` : `${dim("Plan")} Profile -> Generate -> Files -> Provider test\n`));
    },
    section: (sectionTitle, detail) => {
      writeLine(render(() => `${color("cyan", "\n>")} ${bold(sectionTitle)}${detail ? ` ${dim(detail)}` : ""}`));
    },
    success: (message) => writeLine(`${render(() => badge("OK", "green"))} ${message}`),
    info: (message) => writeLine(`${render(() => badge("INFO", "yellow"))} ${message}`),
    savedPath: (label, path) => writeLine(`  ${render(() => color("cyan", label.padEnd(13)))} ${path}`),
    final: () => {
      writeLine(`${render(() => badge("DONE", "green"))} Onboarding complete.`);
      writeLine(`${render(() => dim("Next"))} Run \`bestie status\` or \`bestie chat\` to start chatting.`);
    },
  };
}

function createProviderTestReporter(writeLine: (message: string) => void, useColor: boolean): ProviderTestReporter {
  const render = withColorMode(useColor);

  return {
    pending: (message) => writeLine(`${render(() => badge("TEST", "cyan"))} ${message}`),
    success: (message) => writeLine(`${render(() => badge("OK", "green"))} ${message}`),
    failure: (message, detail) => {
      writeLine(`${render(() => badge("FAIL", "red"))} ${message}`);
      if (detail) {
        writeLine(`     ${render(() => dim(detail))}`);
      }
    },
  };
}

function createPromptTheme(useColor: boolean): PromptTheme {
  const render = withColorMode(useColor);

  return {
    step: (step, total, label, text) => render(() => `${dim(`[${step}/${total}]`)} ${color("cyan", label)} ${text} `),
    defaultValue: (value) => render(() => dim(`[${value}]`)),
    warning: (message) => render(() => color("yellow", message)),
  };
}

function buildConfig(answers: OnboardingAnswers): AppConfig {
  return {
    version: 1,
    agent: {
      name: answers.agentName,
      ownerName: answers.ownerName,
      language: answers.language,
      timeZone: answers.timeZone,
      toneIntensity: answers.toneIntensity,
    },
    llm: {
      provider: answers.provider,
      baseUrl: answers.baseUrl.replace(/\/+$/, ""),
      model: answers.model,
      apiKeyEnv: DEFAULT_API_KEY_ENV,
      timeoutMs: DEFAULT_LLM_TIMEOUT_MS,
      maxRetries: DEFAULT_LLM_MAX_RETRIES,
      retryDelayMs: DEFAULT_LLM_RETRY_DELAY_MS,
    },
    memory: {
      writePolicy: answers.memoryWritePolicy,
    },
  };
}

async function runProviderTest(config: AppConfig, apiKey: string, paths: RuntimePaths, writeLine: (message: string) => void = console.log): Promise<void> {
  const reporter = providerTestReporter ?? createProviderTestReporter(writeLine, output.isTTY);
  reporter.pending("Testing provider with a tiny completion...");

  const result = await testOpenAICompatibleProvider(config, apiKey);

  if (result.ok) {
    await appendLog({ event: "provider_test_success", detail: { provider: config.llm.provider, model: config.llm.model } }, { paths });
    reporter.success("Provider test succeeded.");
    return;
  }

  await appendLog({ event: "provider_test_failure", detail: { ...result } }, { paths, knownSecrets: [apiKey] });

  if (result.status) {
    reporter.failure(`Provider test failed (${result.status} ${result.statusText ?? ""}).`, "Check the base URL, model, API key, or account access.");
    return;
  }

  reporter.failure("Provider test failed.", result.message ?? "Unknown provider test error.");
}

