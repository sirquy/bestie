import { mkdir, writeFile } from "node:fs/promises";
import { stdout as output } from "node:process";
import { resolve } from "node:path";

import { getDefaultAgentsMarkdown } from "../../character/agents-template.js";
import { generateCharacterConfig, generateSystemPrompt } from "../../character/prompt-generator.js";
import { writeCharacterFiles } from "../../character/writer.js";
import { buildModelRef } from "../../llm/model-ref.js";
import { testLlmProvider } from "../../llm/provider-test.js";
import { DEFAULT_LLM_MAX_RETRIES, DEFAULT_LLM_RETRY_DELAY_MS, DEFAULT_LLM_TIMEOUT_MS, configExists, loadConfig, type AppConfig, writeConfig } from "../../runtime/config.js";
import { loadEnvFile, writeEnvFile } from "../../runtime/env.js";
import { appendLog } from "../../runtime/logger.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { createCliQuestioner } from "../prompt.js";
import { badge, bold, color, dim, title, withColorMode } from "../ui.js";

const DEFAULT_API_KEY_ENV = "OPENAI_API_KEY";
const ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY";
const DEFAULT_LANGUAGE: LanguageMode = "vi";
const DEFAULT_TIME_ZONE = "Asia/Bangkok";
const DEFAULT_TONE_INTENSITY = 7;

type LanguageMode = AppConfig["agent"]["language"];
type MemoryWritePolicy = NonNullable<AppConfig["memory"]>["writePolicy"];
type MemoryDeletePolicy = NonNullable<AppConfig["memory"]>["deletePolicy"];
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
  memoryDeletePolicy: MemoryDeletePolicy;
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
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
    ui.section("Hồ sơ", "Chọn tên và chính sách ghi nhớ.");
    const answers = await collectAnswers(questioner);
    ui.success("Đã thu thập hồ sơ và thông tin nhà cung cấp.");

    ui.section("Tạo cấu hình", "Đang tạo file tính cách cục bộ và cấu hình nhà cung cấp.");
    const existingConfig = await loadExistingConfig(paths);
    const config = buildConfig(answers, existingConfig);
    const character = generateCharacterConfig({
      name: answers.agentName,
      ownerName: answers.ownerName,
      language: answers.language,
      timeZone: answers.timeZone,
      toneIntensity: answers.toneIntensity,
    });
    const systemPrompt = generateSystemPrompt(character);

    await writeConfig(config, paths);
    await writeEnvFile({ ...(await loadEnvFile(paths)), [answers.apiKeyEnv]: answers.apiKey }, paths);
    await writeCharacterFiles(character, systemPrompt, paths);
    await writeAgentsFile(paths);
    ui.success("Đã ghi các file runtime cục bộ.");

    ui.section("File đã lưu", "Mọi thứ được lưu trong runtime cục bộ của bạn.");
    ui.savedPath("Cấu hình", paths.configPath);
    ui.savedPath("Bí mật", paths.envPath);
    ui.savedPath("Hướng dẫn", getAgentsFilePath(paths));
    ui.savedPath("Tính cách", paths.characterPath);
    ui.savedPath("Prompt hệ thống", paths.systemPromptPath);

    if (shouldSkipProviderTest) {
      await appendLog({ event: "provider_test_skipped", detail: { reason: "skip_provider_test_flag" } }, { paths });
      ui.info("Đã bỏ qua kiểm tra nhà cung cấp. Chạy `bestie doctor` và thử chat khi nhà cung cấp đã sẵn sàng.");
    } else {
      ui.section("Kiểm tra nhà cung cấp", "Gửi một completion nhỏ để kiểm tra cấu hình.");
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

async function writeAgentsFile(paths: RuntimePaths): Promise<void> {
  await writeFile(getAgentsFilePath(paths), getDefaultAgentsMarkdown(), { mode: 0o600 });
}

function getAgentsFilePath(paths: RuntimePaths): string {
  return resolve(paths.appDir, "AGENTS.md");
}

async function collectAnswers(questioner: Pick<Questioner, "ask" | "askHidden">): Promise<OnboardingAnswers> {
  const { ask, askHidden } = questioner;
  const agentName = await askNonEmpty(ask, promptTheme.step(1, 7, "Tên Bestie", "Bạn muốn gọi bestie là gì?"), "Miu");
  const ownerName = await askNonEmpty(ask, promptTheme.step(2, 7, "Tên của bạn", "Bestie nên gọi bạn là gì?"), "Sếp");
  const language = DEFAULT_LANGUAGE;
  const timeZone = DEFAULT_TIME_ZONE;
  const toneIntensity = DEFAULT_TONE_INTENSITY;
  const memoryWritePolicy = await askMemoryWritePolicy(ask);
  const memoryDeletePolicy: MemoryDeletePolicy = "allow"; // For now, we always allow memory deletion. Future versions may ask this question.
  const provider = await askNonEmpty(ask, promptTheme.step(4, 7, "Nhà cung cấp", "Nhãn nhà cung cấp?"), "openai-compatible");
  const providerDefaults = getLlmProviderDefaults(provider);
  const baseUrl = await askNonEmpty(ask, promptTheme.step(5, 7, "Base URL", "Base URL API của nhà cung cấp?"), providerDefaults.baseUrl);
  const model = await askNonEmpty(ask, promptTheme.step(6, 7, "Model", "Tên model?"), providerDefaults.model);
  const apiKey = await askNonEmpty(askHidden, promptTheme.step(7, 7, "API key", `Dán API key của nhà cung cấp. Key sẽ được lưu dưới tên ${providerDefaults.apiKeyEnv} và được ẩn khi nhập.`));

  return { agentName, ownerName, language, timeZone, toneIntensity, memoryWritePolicy, memoryDeletePolicy, provider, baseUrl, model, apiKeyEnv: providerDefaults.apiKeyEnv, apiKey };
}

function getLlmProviderDefaults(provider: string): { catalogProvider: string; runtimeProvider: string; baseUrl: string; model: string; apiKeyEnv: string } {
  const normalizedProvider = provider.trim().toLowerCase();
  if (normalizedProvider === "claude" || normalizedProvider === "anthropic") {
    return { catalogProvider: "anthropic", runtimeProvider: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5", apiKeyEnv: ANTHROPIC_API_KEY_ENV };
  }

  if (normalizedProvider === "chatgpt" || normalizedProvider === "openai") {
    return { catalogProvider: "openai", runtimeProvider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKeyEnv: DEFAULT_API_KEY_ENV };
  }

  if (normalizedProvider === "groq" || normalizedProvider === "groqcloud" || normalizedProvider === "groq-cloud") {
    return { catalogProvider: "groq", runtimeProvider: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.1-8b-instant", apiKeyEnv: "GROQ_API_KEY" };
  }

  if (normalizedProvider === "openrouter" || normalizedProvider === "open-router") {
    return { catalogProvider: "openrouter", runtimeProvider: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", apiKeyEnv: "OPENROUTER_API_KEY" };
  }

  return { catalogProvider: "openai", runtimeProvider: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKeyEnv: DEFAULT_API_KEY_ENV };
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

    promptWarningWriter(promptTheme.warning("Vui lòng nhập một giá trị."));
  }
}

async function askMemoryWritePolicy(ask: AskLine): Promise<MemoryWritePolicy> {
  while (true) {
    const answer = (await ask(`${promptTheme.step(3, 7, "Bộ nhớ", "Chính sách ghi nhớ: ask, allow, hoặc deny?")}${promptTheme.defaultValue("allow")} `)).trim().toLowerCase();

    if (!answer || answer === "allow") {
      return "allow";
    }

    if (answer === "ask" || answer === "deny") {
      return answer;
    }

    promptWarningWriter(promptTheme.warning("Hãy chọn ask, allow, hoặc deny."));
  }
}

function createOnboardUi(writeLine: (message: string) => void, useColor: boolean): OnboardUi {
  const render = withColorMode(useColor);

  return {
    intro: (paths, shouldSkipProviderTest) => {
      writeLine(render(() => title("Thiết lập Bestie")));
      writeLine(render(() => dim("Trình thiết lập local-first cho runtime Bestie của bạn.")));
      writeLine(`${render(() => color("cyan", "Runtime"))} ${paths.appDir}`);
      writeLine(`${render(() => color("cyan", "Riêng tư"))} Secret được lưu cục bộ trong .bestie/.env và được ẩn khi nhập.`);
      writeLine(render(() => shouldSkipProviderTest ? `${dim("Các bước")} Hồ sơ -> Tạo cấu hình -> File đã lưu\n` : `${dim("Các bước")} Hồ sơ -> Tạo cấu hình -> File đã lưu -> Kiểm tra nhà cung cấp\n`));
    },
    section: (sectionTitle, detail) => {
      writeLine(render(() => `${color("cyan", "\n>")} ${bold(sectionTitle)}${detail ? ` ${dim(detail)}` : ""}`));
    },
    success: (message) => writeLine(`${render(() => badge("OK", "green"))} ${message}`),
    info: (message) => writeLine(`${render(() => badge("INFO", "yellow"))} ${message}`),
    savedPath: (label, path) => writeLine(`  ${render(() => color("cyan", label.padEnd(13)))} ${path}`),
    final: () => {
      writeLine(`${render(() => badge("DONE", "green"))} Thiết lập ban đầu đã hoàn tất.`);
      writeLine(`${render(() => dim("Tiếp theo"))} Chạy \`bestie status\` hoặc \`bestie chat\` để bắt đầu trò chuyện.`);
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

async function loadExistingConfig(paths: RuntimePaths): Promise<AppConfig | undefined> {
  if (!(await configExists(paths))) {
    return undefined;
  }

  return loadConfig(paths);
}

function buildConfig(answers: OnboardingAnswers, existingConfig?: AppConfig): AppConfig {
  const providerDefaults = getLlmProviderDefaults(answers.provider);
  const modelRef = buildModelRef(providerDefaults.catalogProvider, answers.model);
  const profileId = `${providerDefaults.catalogProvider}:api-key`;
  const newProfile = {
    provider: providerDefaults.runtimeProvider,
    mode: "api-key" as const,
    baseUrl: answers.baseUrl.replace(/\/+$/, ""),
    apiKeyEnv: answers.apiKeyEnv,
  };

  if (existingConfig) {
    return {
      ...existingConfig,
      agent: {
        ...existingConfig.agent,
        name: answers.agentName,
        ownerName: answers.ownerName,
        language: answers.language,
        timeZone: answers.timeZone,
        toneIntensity: answers.toneIntensity,
      },
      llm: {
        ...existingConfig.llm,
        primary: modelRef,
        authProfile: profileId,
        profiles: { ...existingConfig.llm.profiles, [profileId]: newProfile },
        modelCatalog: { ...existingConfig.llm.modelCatalog, [modelRef]: { profile: profileId } },
      },
      memory: {
        ...existingConfig.memory,
        writePolicy: answers.memoryWritePolicy,
        deletePolicy: answers.memoryDeletePolicy,
      },
    };
  }

  return {
    version: 2,
    agent: {
      name: answers.agentName,
      ownerName: answers.ownerName,
      language: answers.language,
      timeZone: answers.timeZone,
      toneIntensity: answers.toneIntensity,
    },
    llm: {
      primary: modelRef,
      authProfile: profileId,
      profiles: {
        [profileId]: newProfile,
      },
      modelCatalog: {
        [modelRef]: { profile: profileId },
      },
      timeoutMs: DEFAULT_LLM_TIMEOUT_MS,
      maxRetries: DEFAULT_LLM_MAX_RETRIES,
      retryDelayMs: DEFAULT_LLM_RETRY_DELAY_MS,
    },
    memory: {
      writePolicy: answers.memoryWritePolicy,
      deletePolicy: answers.memoryDeletePolicy,
    },
    internalTools: {
      policies: {
        "internal.write_file": "allow",
        "internal.edit_file": "allow",
        "internal.apply_patch": "allow",
        "internal.exec": "allow",
        "internal.list_processes": "allow",
        "internal.read_url": "allow"
      },
      exec: {
        timeoutMs: 300000
      }
    }
  };
}

async function runProviderTest(config: AppConfig, apiKey: string, paths: RuntimePaths, writeLine: (message: string) => void = console.log): Promise<void> {
  const reporter = providerTestReporter ?? createProviderTestReporter(writeLine, output.isTTY);
  reporter.pending("Đang kiểm tra nhà cung cấp bằng một completion nhỏ...");

  const result = await testLlmProvider(config, apiKey);

  if (result.ok) {
    await appendLog({ event: "provider_test_success", detail: { model: config.llm.primary } }, { paths });
    reporter.success("Kiểm tra nhà cung cấp thành công.");
    return;
  }

  await appendLog({ event: "provider_test_failure", detail: { ...result } }, { paths, knownSecrets: [apiKey] });

  if (result.status) {
    reporter.failure(`Kiểm tra nhà cung cấp thất bại (${result.status} ${result.statusText ?? ""}).`, "Kiểm tra base URL, model, API key hoặc quyền truy cập tài khoản.");
    return;
  }

  reporter.failure("Kiểm tra nhà cung cấp thất bại.", result.message ?? "Lỗi kiểm tra nhà cung cấp không xác định.");
}

