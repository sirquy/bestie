import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { generateCharacterConfig, generateSystemPrompt } from "../../character/prompt-generator.js";
import { writeCharacterFiles } from "../../character/writer.js";
import { testOpenAICompatibleProvider } from "../../llm/provider-test.js";
import { DEFAULT_LLM_MAX_RETRIES, DEFAULT_LLM_RETRY_DELAY_MS, DEFAULT_LLM_TIMEOUT_MS, type AppConfig, writeConfig } from "../../runtime/config.js";
import { writeEnvFile } from "../../runtime/env.js";
import { appendLog } from "../../runtime/logger.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

const DEFAULT_API_KEY_ENV = "BESTIE_LLM_API_KEY";
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_DIM = "\x1b[2m";
const ANSI_CYAN = "\x1b[36m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_YELLOW = "\x1b[33m";

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
}

export async function runOnboardCommand(optionsOrArgv: string[] | OnboardCommandOptions = process.argv): Promise<void> {
  const options = Array.isArray(optionsOrArgv) ? { argv: optionsOrArgv } : optionsOrArgv;
  const paths = options.paths ?? getRuntimePaths();
  const writeLine = options.writeLine ?? console.log;
  const providerTest = options.providerTest ?? runProviderTest;
  const argv = options.argv ?? process.argv;
  const shouldSkipProviderTest = argv.includes("--skip-provider-test");
  await mkdir(paths.appDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await appendLog({ event: "command_start", detail: { command: "onboard" } }, { paths });

  writeOnboardIntro(writeLine, paths, shouldSkipProviderTest);

  const questioner = options.questioner ?? (await createQuestioner());

  try {
    const answers = await collectAnswers(questioner);
    const config = buildConfig(answers);
    const character = generateCharacterConfig({
      name: answers.agentName,
      ownerName: answers.ownerName,
      language: answers.language,
      toneIntensity: answers.toneIntensity,
    });
    const systemPrompt = generateSystemPrompt(character);

    await writeConfig(config, paths);
    await writeEnvFile({ [DEFAULT_API_KEY_ENV]: answers.apiKey }, paths);
    await writeCharacterFiles(character, systemPrompt, paths);

    writeLine(color("\nSaved local files", ANSI_GREEN));
    writeLine(formatSavedPath("Config", paths.configPath));
    writeLine(formatSavedPath("Secrets", paths.envPath));
    writeLine(formatSavedPath("Character", paths.characterPath));
    writeLine(formatSavedPath("System prompt", paths.systemPromptPath));

    if (shouldSkipProviderTest) {
      await appendLog({ event: "provider_test_skipped", detail: { reason: "skip_provider_test_flag" } }, { paths });
      writeLine("\nProvider test skipped. Run `bestie doctor` and try chat when your provider is ready.");
    } else {
      await providerTest(config, answers.apiKey, paths, writeLine);
    }
    writeLine("\nOnboarding complete. Next: run `bestie status` or `bestie chat` to start chatting.");
  } finally {
    questioner.close();
  }
}

async function createQuestioner(): Promise<Questioner> {
  if (input.isTTY) {
    const rl = createInterface({ input, output });
    return {
      ask: (question) => rl.question(question),
      askHidden: async (question) => {
        output.write(question);
        setTerminalEcho(false);
        try {
          return await rl.question("");
        } finally {
          setTerminalEcho(true);
          output.write("\n");
        }
      },
      close: () => rl.close(),
    };
  }

  const lines = readFileSync(0, "utf8").split(/\r?\n/);
  let index = 0;

  return {
    ask: async (question) => {
      output.write(question);
      return lines[index++] ?? "";
    },
    askHidden: async (question) => {
      output.write(question);
      return lines[index++] ?? "";
    },
    close: () => undefined,
  };
}

async function collectAnswers(questioner: Pick<Questioner, "ask" | "askHidden">): Promise<OnboardingAnswers> {
  const { ask, askHidden } = questioner;
  const agentName = await askNonEmpty(ask, question(1, "Bestie name", "What should your bestie be called?"), "Bestie");
  const ownerName = await askNonEmpty(ask, question(2, "Your name", "What should it call you?"), "boss");
  const language = await askLanguage(ask);
  const toneIntensity = await askToneIntensity(ask);
  const memoryWritePolicy = await askMemoryWritePolicy(ask);
  const provider = await askNonEmpty(ask, question(6, "Provider", "Provider label?"), "openai-compatible");
  const baseUrl = await askNonEmpty(ask, question(7, "Base URL", "OpenAI-compatible base URL?"), "https://api.openai.com/v1");
  const model = await askNonEmpty(ask, question(8, "Model", "Model name?"), "gpt-4o-mini");
  const apiKey = await askNonEmpty(askHidden, question(9, "API key", `Paste your provider API key. It will be saved as ${DEFAULT_API_KEY_ENV} and hidden while typing.`));

  return { agentName, ownerName, language, toneIntensity, memoryWritePolicy, provider, baseUrl, model, apiKey };
}

async function askNonEmpty(
  ask: AskLine,
  question: string,
  defaultValue?: string,
): Promise<string> {
  while (true) {
    const suffix = defaultValue ? `${color(`[${defaultValue}]`, ANSI_DIM)} ` : "";
    const answer = (await ask(`${question}${suffix}`)).trim();
    const value = answer || defaultValue;

    if (value) {
      return value;
    }

    console.log(color("Please enter a value.", ANSI_YELLOW));
  }
}

async function askLanguage(ask: AskLine): Promise<LanguageMode> {
  while (true) {
    const answer = (await ask(`${question(3, "Language", "Default language code or auto? Examples: vi, en, ja, ko, fr, pt-BR, auto.")}${color("[vi]", ANSI_DIM)} `)).trim();
    const normalized = answer.toLowerCase();

    if (!answer || normalized === "vietnamese") {
      return "vi";
    }

    if (normalized === "english") {
      return "en";
    }

    if (normalized === "mix") {
      return "mixed";
    }

    return answer;
  }
}

async function askToneIntensity(ask: AskLine): Promise<number> {
  while (true) {
    const answer = (await ask(`${question(4, "Tone", "Tone intensity from 1 to 10?")}${color("[7]", ANSI_DIM)} `)).trim();
    const value = Number(answer || "7");

    if (Number.isInteger(value) && value >= 1 && value <= 10) {
      return value;
    }

    console.log(color("Choose a whole number from 1 to 10.", ANSI_YELLOW));
  }
}

async function askMemoryWritePolicy(ask: AskLine): Promise<MemoryWritePolicy> {
  while (true) {
    const answer = (await ask(`${question(5, "Memory", "Memory write policy: ask, allow, or deny?")}${color("[ask]", ANSI_DIM)} `)).trim().toLowerCase();

    if (!answer || answer === "ask") {
      return "ask";
    }

    if (answer === "allow" || answer === "deny") {
      return answer;
    }

    console.log(color("Choose ask, allow, or deny.", ANSI_YELLOW));
  }
}

function writeOnboardIntro(writeLine: (message: string) => void, paths: RuntimePaths, shouldSkipProviderTest: boolean): void {
  writeLine(color(`${ANSI_BOLD}Bestie onboarding${ANSI_RESET}`, ANSI_CYAN));
  writeLine("Set up your local Bestie runtime in a few guided steps.");
  writeLine(`${color("Home runtime", ANSI_GREEN)} ${paths.appDir}`);
  writeLine(color("Secrets stay local in .bestie/.env and are hidden while typing.", ANSI_DIM));
  writeLine(shouldSkipProviderTest ? "We'll create character and provider config.\n" : "We'll create character config, provider config, and run a quick provider test.\n");
}

function question(step: number, label: string, text: string): string {
  return `${color(`[${step}/9]`, ANSI_DIM)} ${color(label, ANSI_CYAN)} ${text} `;
}

function formatSavedPath(label: string, path: string): string {
  return `- ${color(label.padEnd(13), ANSI_CYAN)} ${path}`;
}

function color(text: string, code: string): string {
  return `${code}${text}${ANSI_RESET}`;
}

function buildConfig(answers: OnboardingAnswers): AppConfig {
  return {
    version: 1,
    agent: {
      name: answers.agentName,
      ownerName: answers.ownerName,
      language: answers.language,
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
  writeLine("\nTesting provider with a tiny completion...");

  const result = await testOpenAICompatibleProvider(config, apiKey);

  if (result.ok) {
    await appendLog({ event: "provider_test_success", detail: { provider: config.llm.provider, model: config.llm.model } }, { paths });
    writeLine("Provider test succeeded.");
    return;
  }

  await appendLog({ event: "provider_test_failure", detail: { ...result } }, { paths, knownSecrets: [apiKey] });

  if (result.status) {
    writeLine(`Provider test failed (${result.status} ${result.statusText ?? ""}). Check the base URL, model, API key, or account access.`);
    return;
  }

  writeLine(`Provider test failed: ${result.message ?? "Unknown provider test error."}`);
}

function setTerminalEcho(enabled: boolean): void {
  try {
    execFileSync("stty", [enabled ? "echo" : "-echo"], { stdio: ["inherit", "ignore", "ignore"] });
  } catch {
    // If stty is unavailable, continue rather than blocking onboarding.
  }
}
