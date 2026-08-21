import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { getDefaultAgentsMarkdown } from "../../character/agents-template.js";
import { INTERNAL_TOOL_NAMES } from "../../chat/mcp-tool-use.js";
import { runOnboardCommand } from "./onboard.js";
import { DEFAULT_LLM_TIMEOUT_MS, type AppConfig } from "../../runtime/config.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { writeConfig } from "../../runtime/config.js";
import { writeEnvFile } from "../../runtime/env.js";

test("runOnboardCommand writes local files and skips provider test when requested", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  let providerTestCalled = false;
  let closed = false;

  try {
    await runOnboardCommand({
      argv: ["node", "bestie", "onboard", "--skip-provider-test"],
      paths,
      questioner: {
        ask: async (question) => {
          if (question.includes("Bạn muốn gọi bestie")) return "Miu";
          if (question.includes("Bestie nên gọi bạn")) return "Boss";
          if (question.includes("Chính sách ghi nhớ")) return "ask";
          if (question.includes("Nhãn nhà cung cấp")) return "openai-compatible";
          if (question.includes("Base URL API")) return "http://127.0.0.1:9/v1/";
          if (question.includes("Tên model")) return "test-model";
          throw new Error(`Unexpected question: ${question}`);
        },
        askHidden: async () => "test-key",
        close: () => {
          closed = true;
        },
      },
      providerTest: async () => {
        providerTestCalled = true;
      },
      writeLine: (message) => output.push(message),
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    const envText = await readFile(paths.envPath, "utf8");
    const agentsText = await readFile(resolve(paths.appDir, "AGENTS.md"), "utf8");
    const logText = await readFile(paths.appLogPath, "utf8");

    assert.equal(closed, true);
    assert.equal(providerTestCalled, false);
    assert.equal(config.llm.primary, "openai/test-model");
    assert.equal(config.llm.profiles["openai:api-key"]?.baseUrl, "http://127.0.0.1:9/v1");
    assert.equal(config.llm.timeoutMs, DEFAULT_LLM_TIMEOUT_MS);
    assert.equal(config.agent.language, "vi");
    assert.equal(config.agent.timeZone, "Asia/Bangkok");
    assert.equal(config.agent.toneIntensity, 7);
    assert.equal(config.memory?.writePolicy, "ask");
    assert.equal(config.memory?.deletePolicy, "allow");
    assert.equal(config.memory?.retrievalPolicy, "governed");
    assert.deepEqual(config.internalTools?.policies, Object.fromEntries(INTERNAL_TOOL_NAMES.map((tool) => [tool, "allow"])));
    assert.equal(config.workspace?.defaultPath, paths.workspaceDir);
    assert.equal(config.channels?.telegram?.enabled, false);
    assert.equal(config.channels?.zalo?.enabled, false);
    assert.equal(config.channels?.zaloPersonal?.enabled, false);
    assert.equal(config.channels?.telegram?.attachments?.visionPolicy, "allow");
    assert.equal(config.channels?.telegram?.attachments?.transcriptionPolicy, "allow");
    assert.deepEqual(config.mcp?.servers, []);
    assert.equal(config.skills?.registry?.remoteOfficial?.enabled, true);
    assert.match(envText, /OPENAI_API_KEY="test-key"/);
    assert.equal(agentsText, getDefaultAgentsMarkdown());
    assert.match(agentsText, /# AGENTS\.md - Bestie Agent Workspace/);
    assert.match(agentsText, /~\/\.bestie\/AGENTS\.md/);
    assert.match(logText, /provider_test_skipped/);
    assert.ok(output.some((line) => line.includes("Runtime")));
    assert.ok(output.some((line) => line.includes("Hồ sơ -> Tạo cấu hình -> File đã lưu")));
    assert.ok(output.some((line) => line.includes("OK") && line.includes("Đã ghi các file runtime cục bộ")));
    assert.ok(output.some((line) => line.includes("Hướng dẫn") && line.includes("AGENTS.md")));
    assert.ok(output.every((line) => !line.includes("Kiểm tra nhà cung cấp") || !line.includes("Gửi một completion")));
    assert.ok(output.some((line) => line.includes("INFO") && line.includes("Đã bỏ qua kiểm tra nhà cung cấp")));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runOnboardCommand runs provider test when not skipped", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  let providerTestConfig: AppConfig | undefined;
  let providerTestApiKey = "";

  try {
    await runOnboardCommand({
      argv: ["node", "bestie", "onboard"],
      paths,
      questioner: createQuestioner(),
      providerTest: async (config, apiKey, _paths, writeLine) => {
        providerTestConfig = config;
        providerTestApiKey = apiKey;
        writeLine("Kiểm tra nhà cung cấp thất bại: mocked provider unavailable.");
      },
      writeLine: (message) => output.push(message),
    });

    assert.equal(providerTestConfig?.llm.primary, "openai/test-model");
    assert.equal(providerTestApiKey, "test-key");
    assert.ok(output.some((line) => line.includes("Kiểm tra nhà cung cấp")));
    assert.ok(output.some((line) => line.includes("mocked provider unavailable")));
    assert.ok(output.some((line) => line.includes("DONE") && line.includes("Thiết lập ban đầu đã hoàn tất")));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runOnboardCommand preserves unrelated existing config and env values", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({
      version: 2,
      agent: { name: "Old Miu", ownerName: "Old Boss", language: "en", timeZone: "America/New_York", toneIntensity: 4 },
      llm: {
        primary: "anthropic/old-model",
        authProfile: "anthropic:api-key",
        profiles: {
          "anthropic:api-key": { provider: "anthropic", mode: "api-key", baseUrl: "https://api.anthropic.com/v1", apiKeyEnv: "ANTHROPIC_API_KEY" },
        },
        modelCatalog: { "anthropic/old-model": { profile: "anthropic:api-key" } },
        fallbacks: ["anthropic/old-model"],
      },
      channels: { telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345" } },
      skills: { registry: { remoteOfficial: { enabled: true, url: "https://skills.example.test/registry.json", installPolicy: "ask" } } },
      workspace: { defaultPath: "C:/bestie-workspace" },
      internalTools: { policies: { "internal.exec": "ask" } },
    }, paths);
    await writeEnvFile({ ANTHROPIC_API_KEY: "old-key", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-token", CUSTOM_SETTING: "preserved" }, paths);

    await runOnboardCommand({
      argv: ["node", "bestie", "onboard", "--skip-provider-test"],
      paths,
      questioner: createQuestioner(),
      writeLine: () => undefined,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    const envText = await readFile(paths.envPath, "utf8");
    assert.equal(config.agent.name, "Miu");
    assert.equal(config.llm.primary, "openai/test-model");
    assert.deepEqual(config.llm.fallbacks, ["anthropic/old-model"]);
    assert.equal(config.llm.profiles["anthropic:api-key"]?.apiKeyEnv, "ANTHROPIC_API_KEY");
    assert.equal(config.channels?.telegram?.ownerUserId, "12345");
    assert.equal(config.skills?.registry?.remoteOfficial?.installPolicy, "ask");
    assert.equal(config.workspace?.defaultPath, "C:/bestie-workspace");
    assert.equal(config.internalTools?.policies?.["internal.exec"], "ask");
    assert.match(envText, /ANTHROPIC_API_KEY="old-key"/);
    assert.match(envText, /BESTIE_TELEGRAM_BOT_TOKEN="telegram-token"/);
    assert.match(envText, /CUSTOM_SETTING="preserved"/);
    assert.match(envText, /OPENAI_API_KEY="test-key"/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runOnboardCommand uses Claude provider defaults", async () => {
  const paths = await createTempPaths();

  try {
    await runOnboardCommand({
      argv: ["node", "bestie", "onboard", "--skip-provider-test"],
      paths,
      questioner: {
        ask: async (question) => {
          if (question.includes("Bạn muốn gọi bestie")) return "Miu";
          if (question.includes("Bestie nên gọi bạn")) return "Boss";
          if (question.includes("Chính sách ghi nhớ")) return "ask";
          if (question.includes("Nhãn nhà cung cấp")) return "claude";
          if (question.includes("Base URL API")) return "";
          if (question.includes("Tên model")) return "";
          throw new Error(`Unexpected question: ${question}`);
        },
        askHidden: async () => "test-key",
        close: () => undefined,
      },
      writeLine: () => undefined,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    const envText = await readFile(paths.envPath, "utf8");

    assert.equal(config.llm.primary, "anthropic/claude-sonnet-4-5");
    assert.equal(config.llm.profiles["anthropic:api-key"]?.provider, "anthropic");
    assert.equal(config.llm.profiles["anthropic:api-key"]?.baseUrl, "https://api.anthropic.com/v1");
    assert.equal(config.llm.profiles["anthropic:api-key"]?.apiKeyEnv, "ANTHROPIC_API_KEY");
    assert.match(envText, /ANTHROPIC_API_KEY="test-key"/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runOnboardCommand uses Groq provider defaults", async () => {
  const paths = await createTempPaths();

  try {
    await runOnboardCommand({
      argv: ["node", "bestie", "onboard", "--skip-provider-test"],
      paths,
      questioner: {
        ask: async (question) => {
          if (question.includes("Bạn muốn gọi bestie")) return "Miu";
          if (question.includes("Bestie nên gọi bạn")) return "Boss";
          if (question.includes("Chính sách ghi nhớ")) return "ask";
          if (question.includes("Nhãn nhà cung cấp")) return "groq";
          if (question.includes("Base URL API")) return "";
          if (question.includes("Tên model")) return "";
          throw new Error(`Unexpected question: ${question}`);
        },
        askHidden: async () => "test-key",
        close: () => undefined,
      },
      writeLine: () => undefined,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    const envText = await readFile(paths.envPath, "utf8");

    assert.equal(config.llm.primary, "groq/llama-3.1-8b-instant");
    assert.equal(config.llm.profiles["groq:api-key"]?.provider, "openai-compatible");
    assert.equal(config.llm.profiles["groq:api-key"]?.baseUrl, "https://api.groq.com/openai/v1");
    assert.equal(config.llm.profiles["groq:api-key"]?.apiKeyEnv, "GROQ_API_KEY");
    assert.match(envText, /GROQ_API_KEY="test-key"/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runOnboardCommand uses OpenRouter provider defaults", async () => {
  const paths = await createTempPaths();

  try {
    await runOnboardCommand({
      argv: ["node", "bestie", "onboard", "--skip-provider-test"],
      paths,
      questioner: {
        ask: async (question) => {
          if (question.includes("Bạn muốn gọi bestie")) return "Miu";
          if (question.includes("Bestie nên gọi bạn")) return "Boss";
          if (question.includes("Chính sách ghi nhớ")) return "ask";
          if (question.includes("Nhãn nhà cung cấp")) return "openrouter";
          if (question.includes("Base URL API")) return "";
          if (question.includes("Tên model")) return "";
          throw new Error(`Unexpected question: ${question}`);
        },
        askHidden: async () => "test-key",
        close: () => undefined,
      },
      writeLine: () => undefined,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    const envText = await readFile(paths.envPath, "utf8");

    assert.equal(config.llm.primary, "openrouter/openai/gpt-4o-mini");
    assert.equal(config.llm.profiles["openrouter:api-key"]?.provider, "openai-compatible");
    assert.equal(config.llm.profiles["openrouter:api-key"]?.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(config.llm.profiles["openrouter:api-key"]?.apiKeyEnv, "OPENROUTER_API_KEY");
    assert.match(envText, /OPENROUTER_API_KEY="test-key"/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runOnboardCommand highlights provider test failures", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];

  try {
    await runOnboardCommand({
      argv: ["node", "bestie", "onboard"],
      paths,
      questioner: createQuestioner(),
      providerTest: async (_config, _apiKey, _paths, writeLine) => {
        writeLine("FAIL Kiểm tra nhà cung cấp thất bại.");
        writeLine("     Provider returned an unusable response: 500 Internal Server Error");
      },
      writeLine: (message) => output.push(message),
    });

    assert.ok(output.some((line) => line.includes("FAIL") && line.includes("Kiểm tra nhà cung cấp thất bại")));
    assert.ok(output.some((line) => line.includes("500 Internal Server Error")));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

function createQuestioner(): { ask: (question: string) => Promise<string>; askHidden: () => Promise<string>; close: () => void } {
  return {
    ask: async (question) => {
      if (question.includes("Bạn muốn gọi bestie")) return "Miu";
      if (question.includes("Bestie nên gọi bạn")) return "Boss";
      if (question.includes("Chính sách ghi nhớ")) return "ask";
      if (question.includes("Nhãn nhà cung cấp")) return "openai-compatible";
      if (question.includes("Base URL API")) return "http://127.0.0.1:9/v1/";
      if (question.includes("Tên model")) return "test-model";
      throw new Error(`Unexpected question: ${question}`);
    },
    askHidden: async () => "test-key",
    close: () => undefined,
  };
}

test("getRuntimePaths defaults local runtime files to the user home directory", () => {
  const paths = getRuntimePaths();

  assert.equal(paths.rootDir, homedir());
  assert.equal(paths.appDir, resolve(homedir(), ".bestie"));
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-onboard-test-"));
  const appDir = resolve(rootDir, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");

  return {
    rootDir,
    appDir,
    configPath: resolve(appDir, "config.json"),
    envPath: resolve(appDir, ".env"),
    characterPath: resolve(appDir, "character.json"),
    systemPromptPath: resolve(appDir, "system-prompt.md"),
    logsDir,
    appLogPath: resolve(logsDir, "app.log"),
    dataDir,
    memoryDbPath: resolve(dataDir, "memory.sqlite"),
    workspaceDir: resolve(appDir, "workspace"),
  };
}
