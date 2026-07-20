import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { writeConfig, type AppConfig } from "../../runtime/config.js";
import { writeEnvFile } from "../../runtime/env.js";
import type { RuntimePaths } from "../../runtime/paths.js";
import { runLlmCommand } from "./llm.js";

const baseConfig: AppConfig = {
  version: 1,
  agent: { name: "Miu", ownerName: "Boss", language: "vi", timeZone: "Asia/Bangkok", toneIntensity: 7 },
  llm: { provider: "openai-compatible", baseUrl: "https://old.example/v1", model: "old-model", apiKeyEnv: "OLD_API_KEY" },
  memory: { writePolicy: "allow", deletePolicy: "allow" },
};

test("runLlmCommand prints setup help with supported providers", async () => {
  const output: string[] = [];

  await runLlmCommand({ argv: ["node", "bestie", "llm"], paths: await createTempPaths(), writeLine: (message) => output.push(message), questioner: createQuestioner() });

  assert.match(output.join("\n"), /Anthropic/);
  assert.match(output.join("\n"), /ChatGPT\/OpenAI/);
  assert.match(output.join("\n"), /Custom Provider/);
  assert.match(output.join("\n"), /Ollama/);
  assert.match(output.join("\n"), /Gemini/);
  assert.match(output.join("\n"), /Antigravity/);
});

test("runLlmCommand sets up Anthropic with API key", async () => {
  const paths = await createConfiguredTempPaths();

  try {
    await runLlmCommand({
      argv: ["node", "bestie", "llm", "setup", "--provider", "anthropic"],
      paths,
      questioner: createQuestioner({ selects: ["api-key"], answers: ["", "", "", "sk-anthropic"] }),
      writeLine: () => undefined,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    const env = await readFile(paths.envPath, "utf8");

    assert.equal(config.llm.provider, "anthropic");
    assert.equal(config.llm.baseUrl, "https://api.anthropic.com/v1");
    assert.equal(config.llm.model, "claude-sonnet-4-5");
    assert.equal(config.llm.apiKeyEnv, "ANTHROPIC_API_KEY");
    assert.match(env, /ANTHROPIC_API_KEY="sk-anthropic"/);
    assert.match(env, /EXISTING="keep"/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runLlmCommand sets up custom OpenAI-compatible provider", async () => {
  const paths = await createConfiguredTempPaths();

  try {
    await runLlmCommand({
      argv: ["node", "bestie", "llm", "setup", "--provider=custom"],
      paths,
      questioner: createQuestioner({ selects: ["openai-compatible"], answers: ["https://llm.example/v1/", "custom-model", "CUSTOM_KEY", "secret"] }),
      writeLine: () => undefined,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    const env = await readFile(paths.envPath, "utf8");

    assert.equal(config.llm.provider, "openai-compatible");
    assert.equal(config.llm.baseUrl, "https://llm.example/v1");
    assert.equal(config.llm.model, "custom-model");
    assert.equal(config.llm.apiKeyEnv, "CUSTOM_KEY");
    assert.match(env, /CUSTOM_KEY="secret"/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runLlmCommand sets up local Ollama without requiring a real secret", async () => {
  const paths = await createConfiguredTempPaths();

  try {
    await runLlmCommand({
      argv: ["node", "bestie", "llm", "setup", "--provider", "ollama"],
      paths,
      questioner: createQuestioner({ selects: ["local"], answers: ["", "llama3.2"] }),
      writeLine: () => undefined,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    const env = await readFile(paths.envPath, "utf8");

    assert.equal(config.llm.provider, "openai-compatible");
    assert.equal(config.llm.baseUrl, "http://127.0.0.1:11434/v1");
    assert.equal(config.llm.model, "llama3.2");
    assert.equal(config.llm.apiKeyEnv, "OLLAMA_API_KEY");
    assert.match(env, /OLLAMA_API_KEY="ollama"/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runLlmCommand scaffolds OAuth mode without storing a fake token", async () => {
  const paths = await createConfiguredTempPaths();
  const output: string[] = [];

  try {
    await runLlmCommand({
      argv: ["node", "bestie", "llm", "setup", "--provider", "gemini"],
      paths,
      questioner: createQuestioner({ answers: ["", "", ""] }),
      writeLine: (message) => output.push(message),
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    const env = await readFile(paths.envPath, "utf8");

    assert.equal(config.llm.provider, "openai-compatible");
    assert.equal(config.llm.apiKeyEnv, "GEMINI_OAUTH_TOKEN");
    assert.doesNotMatch(env, /GEMINI_OAUTH_TOKEN/);
    assert.match(output.join("\n"), /OAuth browser login.*not automated yet/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

function createQuestioner(options: { answers?: string[]; selects?: string[] } = {}): { ask: (question: string) => Promise<string>; askHidden: (question: string) => Promise<string>; select: <T extends string>(question: string, choices: Array<{ name: string; value: T; description?: string }>) => Promise<T>; close: () => void } {
  const queue = [...(options.answers ?? [])];
  const selectQueue = [...(options.selects ?? [])];
  return {
    ask: async () => queue.shift() ?? "",
    askHidden: async () => queue.shift() ?? "",
    select: async (_question, choices) => {
      const selected = selectQueue.shift();
      return choices.find((choice) => choice.value === selected)?.value ?? choices[0].value;
    },
    close: () => undefined,
  };
}

async function createConfiguredTempPaths(): Promise<RuntimePaths> {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await mkdir(paths.dataDir, { recursive: true });
  await writeConfig(baseConfig, paths);
  await writeEnvFile({ EXISTING: "keep" }, paths);
  return paths;
}

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-llm-test-"));
  const appDir = resolve(rootDir, ".bestie");
  return {
    rootDir,
    appDir,
    logsDir: resolve(appDir, "logs"),
    dataDir: resolve(appDir, "data"),
    configPath: resolve(appDir, "config.json"),
    envPath: resolve(appDir, ".env"),
    characterPath: resolve(appDir, "character.json"),
    systemPromptPath: resolve(appDir, "system-prompt.md"),
    appLogPath: resolve(appDir, "logs", "bestie.log"),
    memoryDbPath: resolve(appDir, "data", "memory.sqlite"),
    workspaceDir: resolve(appDir, "workspace"),
  };
}
