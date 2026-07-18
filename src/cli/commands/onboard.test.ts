import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { getDefaultAgentsMarkdown } from "../../character/agents-template.js";
import { runOnboardCommand } from "./onboard.js";
import type { AppConfig } from "../../runtime/config.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

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
          if (question.includes("Base URL tương thích OpenAI")) return "http://127.0.0.1:9/v1/";
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

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as { agent: { language: string; timeZone: string; toneIntensity: number }; llm: { baseUrl: string; timeoutMs: number }; memory?: { writePolicy?: string; deletePolicy?: string } };
    const envText = await readFile(paths.envPath, "utf8");
    const agentsText = await readFile(resolve(paths.appDir, "AGENTS.md"), "utf8");
    const logText = await readFile(paths.appLogPath, "utf8");

    assert.equal(closed, true);
    assert.equal(providerTestCalled, false);
    assert.equal(config.llm.baseUrl, "http://127.0.0.1:9/v1");
    assert.equal(config.llm.timeoutMs, 60_000);
    assert.equal(config.agent.language, "vi");
    assert.equal(config.agent.timeZone, "Asia/Bangkok");
    assert.equal(config.agent.toneIntensity, 7);
    assert.equal(config.memory?.writePolicy, "ask");
    assert.equal(config.memory?.deletePolicy, "allow");
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

    assert.equal(providerTestConfig?.llm.model, "test-model");
    assert.equal(providerTestApiKey, "test-key");
    assert.ok(output.some((line) => line.includes("Kiểm tra nhà cung cấp")));
    assert.ok(output.some((line) => line.includes("mocked provider unavailable")));
    assert.ok(output.some((line) => line.includes("DONE") && line.includes("Thiết lập ban đầu đã hoàn tất")));
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
      if (question.includes("Base URL tương thích OpenAI")) return "http://127.0.0.1:9/v1/";
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
