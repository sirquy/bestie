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

  writeLine("Bestie onboarding");
  writeLine(shouldSkipProviderTest ? "Let's create the smallest local setup: character and provider config.\n" : "Let's create the smallest local setup: character, provider config, and a quick provider test.\n");

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

    writeLine("\nSaved local Phase Now files:");
    writeLine(`- ${paths.configPath}`);
    writeLine(`- ${paths.envPath}`);
    writeLine(`- ${paths.characterPath}`);
    writeLine(`- ${paths.systemPromptPath}`);

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
  const agentName = await askNonEmpty(ask, "What should your bestie be called? ", "Bestie");
  const ownerName = await askNonEmpty(ask, "What should it call you? ", "boss");
  const language = await askLanguage(ask);
  const toneIntensity = await askToneIntensity(ask);
  const memoryWritePolicy = await askMemoryWritePolicy(ask);
  const provider = await askNonEmpty(ask, "Provider label? ", "openai-compatible");
  const baseUrl = await askNonEmpty(ask, "OpenAI-compatible base URL? ", "https://api.openai.com/v1");
  const model = await askNonEmpty(ask, "Model name? ", "gpt-4o-mini");
  const apiKey = await askNonEmpty(askHidden, `API key (saved as ${DEFAULT_API_KEY_ENV}, not printed later): `);

  return { agentName, ownerName, language, toneIntensity, memoryWritePolicy, provider, baseUrl, model, apiKey };
}

async function askNonEmpty(
  ask: AskLine,
  question: string,
  defaultValue?: string,
): Promise<string> {
  while (true) {
    const suffix = defaultValue ? `[${defaultValue}] ` : "";
    const answer = (await ask(`${question}${suffix}`)).trim();
    const value = answer || defaultValue;

    if (value) {
      return value;
    }

    console.log("Please enter a value.");
  }
}

async function askLanguage(ask: AskLine): Promise<LanguageMode> {
  while (true) {
    const answer = (await ask("Default language code or auto? Examples: vi, en, ja, ko, fr, pt-BR, auto. [vi] ")).trim();
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
    const answer = (await ask("Tone intensity from 1 to 10? [7] ")).trim();
    const value = Number(answer || "7");

    if (Number.isInteger(value) && value >= 1 && value <= 10) {
      return value;
    }

    console.log("Choose a whole number from 1 to 10.");
  }
}

async function askMemoryWritePolicy(ask: AskLine): Promise<MemoryWritePolicy> {
  while (true) {
    const answer = (await ask("Memory write policy: ask, allow, or deny? [ask] ")).trim().toLowerCase();

    if (!answer || answer === "ask") {
      return "ask";
    }

    if (answer === "allow" || answer === "deny") {
      return answer;
    }

    console.log("Choose ask, allow, or deny.");
  }
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
