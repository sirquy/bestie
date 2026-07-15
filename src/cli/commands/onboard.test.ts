import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

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
          if (question.includes("What should your bestie")) return "Miu";
          if (question.includes("What should it call")) return "Boss";
          if (question.includes("Default language tag")) return "Japanese";
          if (question.includes("IANA time zone")) return "Asia/Tokyo";
          if (question.includes("Tone intensity")) return "7";
          if (question.includes("Memory write policy")) return "ask";
          if (question.includes("Provider label")) return "openai-compatible";
          if (question.includes("OpenAI-compatible base URL")) return "http://127.0.0.1:9/v1/";
          if (question.includes("Model name")) return "test-model";
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

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as { agent: { language: string; timeZone: string }; llm: { baseUrl: string; timeoutMs: number }; memory?: { writePolicy?: string } };
    const envText = await readFile(paths.envPath, "utf8");
    const logText = await readFile(paths.appLogPath, "utf8");

    assert.equal(closed, true);
    assert.equal(providerTestCalled, false);
    assert.equal(config.llm.baseUrl, "http://127.0.0.1:9/v1");
    assert.equal(config.llm.timeoutMs, 60_000);
    assert.equal(config.agent.language, "ja");
    assert.equal(config.agent.timeZone, "Asia/Tokyo");
    assert.equal(config.memory?.writePolicy, "ask");
    assert.match(envText, /OPENAI_API_KEY="test-key"/);
    assert.match(logText, /provider_test_skipped/);
    assert.ok(output.some((line) => line.includes("Runtime")));
    assert.ok(output.some((line) => line.includes("Profile -> Generate -> Files")));
    assert.ok(output.some((line) => line.includes("OK") && line.includes("Local runtime files written")));
    assert.ok(output.every((line) => !line.includes("Provider test Sending")));
    assert.ok(output.some((line) => line.includes("INFO") && line.includes("Provider test skipped")));
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
        writeLine("Provider test failed: mocked provider unavailable.");
      },
      writeLine: (message) => output.push(message),
    });

    assert.equal(providerTestConfig?.llm.model, "test-model");
    assert.equal(providerTestApiKey, "test-key");
    assert.ok(output.some((line) => line.includes("Provider test")));
    assert.ok(output.some((line) => line.includes("mocked provider unavailable")));
    assert.ok(output.some((line) => line.includes("DONE") && line.includes("Onboarding complete")));
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
        writeLine("FAIL Provider test failed.");
        writeLine("     Provider returned an unusable response: 500 Internal Server Error");
      },
      writeLine: (message) => output.push(message),
    });

    assert.ok(output.some((line) => line.includes("FAIL") && line.includes("Provider test failed")));
    assert.ok(output.some((line) => line.includes("500 Internal Server Error")));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

function createQuestioner(): { ask: (question: string) => Promise<string>; askHidden: () => Promise<string>; close: () => void } {
  return {
    ask: async (question) => {
      if (question.includes("What should your bestie")) return "Miu";
      if (question.includes("What should it call")) return "Boss";
      if (question.includes("Default language tag")) return "vi";
      if (question.includes("IANA time zone")) return "UTC";
      if (question.includes("Tone intensity")) return "7";
      if (question.includes("Memory write policy")) return "ask";
      if (question.includes("Provider label")) return "openai-compatible";
      if (question.includes("OpenAI-compatible base URL")) return "http://127.0.0.1:9/v1/";
      if (question.includes("Model name")) return "test-model";
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
