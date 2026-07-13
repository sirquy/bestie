import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { runOnboardCommand } from "./onboard.js";
import type { AppConfig } from "../../runtime/config.js";
import type { RuntimePaths } from "../../runtime/paths.js";

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
          if (question.startsWith("What should your bestie")) return "Miu";
          if (question.startsWith("What should it call")) return "Boss";
          if (question.startsWith("Default language code")) return "ja";
          if (question.startsWith("Tone intensity")) return "7";
          if (question.startsWith("Memory write policy")) return "ask";
          if (question.startsWith("Provider label")) return "openai-compatible";
          if (question.startsWith("OpenAI-compatible base URL")) return "http://127.0.0.1:9/v1/";
          if (question.startsWith("Model name")) return "test-model";
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

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as { agent: { language: string }; llm: { baseUrl: string; timeoutMs: number }; memory?: { writePolicy?: string } };
    const envText = await readFile(paths.envPath, "utf8");
    const logText = await readFile(paths.appLogPath, "utf8");

    assert.equal(closed, true);
    assert.equal(providerTestCalled, false);
    assert.equal(config.llm.baseUrl, "http://127.0.0.1:9/v1");
    assert.equal(config.llm.timeoutMs, 60_000);
    assert.equal(config.agent.language, "ja");
    assert.equal(config.memory?.writePolicy, "ask");
    assert.match(envText, /BESTIE_LLM_API_KEY="test-key"/);
    assert.match(logText, /provider_test_skipped/);
    assert.ok(output.some((line) => line.includes("character and provider config")));
    assert.ok(output.every((line) => !line.includes("quick provider test")));
    assert.ok(output.some((line) => line.includes("Provider test skipped")));
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
    assert.ok(output.some((line) => line.includes("quick provider test")));
    assert.ok(output.some((line) => line.includes("mocked provider unavailable")));
    assert.ok(output.some((line) => line.includes("Onboarding complete")));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

function createQuestioner(): { ask: (question: string) => Promise<string>; askHidden: () => Promise<string>; close: () => void } {
  return {
    ask: async (question) => {
      if (question.startsWith("What should your bestie")) return "Miu";
      if (question.startsWith("What should it call")) return "Boss";
      if (question.startsWith("Default language code")) return "vi";
      if (question.startsWith("Tone intensity")) return "7";
      if (question.startsWith("Memory write policy")) return "ask";
      if (question.startsWith("Provider label")) return "openai-compatible";
      if (question.startsWith("OpenAI-compatible base URL")) return "http://127.0.0.1:9/v1/";
      if (question.startsWith("Model name")) return "test-model";
      throw new Error(`Unexpected question: ${question}`);
    },
    askHidden: async () => "test-key",
    close: () => undefined,
  };
}

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
