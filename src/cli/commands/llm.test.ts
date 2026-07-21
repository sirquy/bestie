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
  version: 2,
  agent: { name: "Miu", ownerName: "Boss", language: "vi", timeZone: "Asia/Bangkok", toneIntensity: 7 },
  llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://old.example/v1",
          apiKeyEnv: "OLD_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
  memory: { writePolicy: "allow", deletePolicy: "allow" },
};

test("runLlmCommand prints setup help with supported providers", async () => {
  const output: string[] = [];

  await runLlmCommand({ argv: ["node", "bestie", "llm"], paths: await createTempPaths(), writeLine: (message) => output.push(message), questioner: createQuestioner() });

  assert.match(output.join("\n"), /Anthropic/);
  assert.match(output.join("\n"), /ChatGPT\/OpenAI/);
  assert.match(output.join("\n"), /OpenRouter/);
  assert.match(output.join("\n"), /Custom OpenAI-Compatible/);
  assert.match(output.join("\n"), /Ollama/);
  assert.match(output.join("\n"), /Gemini/);
  assert.match(output.join("\n"), /Antigravity/);
});

test("runLlmCommand lists supported providers", async () => {
  const output: string[] = [];

  await runLlmCommand({ argv: ["node", "bestie", "llm", "providers"], paths: await createTempPaths(), writeLine: (message) => output.push(message), questioner: createQuestioner() });

  assert.match(output.join("\n"), /openrouter\tOpenRouter\topenai-compatible\tAPI key\tstream,vision\tdefault openrouter\/openai\/gpt-4o-mini/);
  assert.match(output.join("\n"), /groq\tGroq\topenai-compatible\tAPI key\tstream,vision\tdefault groq\/llama-3\.1-8b-instant/);
  assert.match(output.join("\n"), /gemini\tGemini\tgemini\tAPI key\tstream,vision\tdefault gemini\/gemini-2.5-flash/);
  assert.match(output.join("\n"), /ollama\tOllama\topenai-compatible\tLocal\tstream,vision\tdefault ollama\/llama3.1/);
});

test("runLlmCommand lists supported provider models", async () => {
  const output: string[] = [];

  await runLlmCommand({ argv: ["node", "bestie", "llm", "models", "--provider", "gemini"], paths: await createTempPaths(), writeLine: (message) => output.push(message), questioner: createQuestioner() });

  assert.match(output.join("\n"), /Gemini models/);
  assert.match(output.join("\n"), /gemini\/gemini-2.5-flash\tGemini 2.5 Flash\tdefault/);
  assert.match(output.join("\n"), /gemini\/gemini-2.5-pro\tGemini 2.5 Pro/);
});

test("runLlmCommand lists Groq models", async () => {
  const output: string[] = [];

  await runLlmCommand({ argv: ["node", "bestie", "llm", "models", "--provider", "groq"], paths: await createTempPaths(), writeLine: (message) => output.push(message), questioner: createQuestioner() });

  assert.match(output.join("\n"), /Groq models/);
  assert.match(output.join("\n"), /groq\/llama-3\.1-8b-instant\tLlama 3\.1 8B Instant\tdefault/);
  assert.match(output.join("\n"), /groq\/llama-3\.3-70b-versatile\tLlama 3\.3 70B Versatile/);
  assert.match(output.join("\n"), /groq\/openai\/gpt-oss-120b\tGPT OSS 120B/);
});

test("runLlmCommand lists OpenRouter namespaced models", async () => {
  const output: string[] = [];

  await runLlmCommand({ argv: ["node", "bestie", "llm", "models", "--provider", "openrouter"], paths: await createTempPaths(), writeLine: (message) => output.push(message), questioner: createQuestioner() });

  assert.match(output.join("\n"), /OpenRouter models/);
  assert.match(output.join("\n"), /openrouter\/openai\/gpt-4o-mini\tOpenAI GPT-4o mini\tdefault/);
  assert.match(output.join("\n"), /openrouter\/anthropic\/claude-3\.5-sonnet\tAnthropic Claude 3\.5 Sonnet/);
  assert.match(output.join("\n"), /openrouter\/meta-llama\/llama-3\.1-8b-instruct\tMeta Llama 3\.1 8B Instruct/);
});

test("runLlmCommand requires model for model tests", async () => {
  await assert.rejects(
    runLlmCommand({ argv: ["node", "bestie", "llm", "test"], paths: await createTempPaths(), writeLine: () => undefined, questioner: createQuestioner() }),
    /Missing --model/,
  );
});

test("runLlmCommand reports model test failures", async () => {
  const paths = await createConfiguredTempPaths();
  const output: string[] = [];

  try {
    await runLlmCommand({
      argv: ["node", "bestie", "llm", "test", "--model", "openai/test-model"],
      paths,
      writeLine: (message) => output.push(message),
      questioner: createQuestioner(),
    });

    assert.match(output.join("\n"), /LLM model test failed/);
    assert.match(output.join("\n"), /openai\/test-model/);
    assert.match(output.join("\n"), /OLD_API_KEY/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runLlmCommand adds and removes configured LLM models", async () => {
  const paths = await createConfiguredTempPaths();

  try {
    await runLlmCommand({ argv: ["node", "bestie", "llm", "models", "add", "--model", "openai/custom-model"], paths, writeLine: () => undefined, questioner: createQuestioner() });
    let config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    assert.deepEqual(config.llm.modelCatalog["openai/custom-model"], { profile: "openai:api-key" });

    await runLlmCommand({ argv: ["node", "bestie", "llm", "models", "remove", "--model", "openai/custom-model"], paths, writeLine: () => undefined, questioner: createQuestioner() });
    config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    assert.equal(config.llm.modelCatalog["openai/custom-model"], undefined);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runLlmCommand adds configured LLM models with explicit profiles", async () => {
  const paths = await createConfiguredTempPaths(configWithExtraProfiles());

  try {
    await runLlmCommand({ argv: ["node", "bestie", "llm", "models", "add", "--model", "anthropic/custom-model", "--profile", "anthropic:api-key"], paths, writeLine: () => undefined, questioner: createQuestioner() });
    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    assert.deepEqual(config.llm.modelCatalog["anthropic/custom-model"], { profile: "anthropic:api-key" });
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runLlmCommand protects active configured LLM models from removal", async () => {
  const primaryPaths = await createConfiguredTempPaths();
  try {
    await assert.rejects(
      runLlmCommand({ argv: ["node", "bestie", "llm", "models", "remove", "--model", "openai/test-model"], paths: primaryPaths, writeLine: () => undefined, questioner: createQuestioner() }),
      /Primary LLM model cannot be removed/,
    );
  } finally {
    await rm(primaryPaths.rootDir, { recursive: true, force: true });
  }

  const fallbackPaths = await createConfiguredTempPaths({
    ...configWithExtraProfiles(),
    llm: {
      ...configWithExtraProfiles().llm,
      fallbacks: ["anthropic/claude-sonnet-4-5"],
    },
  });
  try {
    await assert.rejects(
      runLlmCommand({ argv: ["node", "bestie", "llm", "models", "remove", "--model", "anthropic/claude-sonnet-4-5"], paths: fallbackPaths, writeLine: () => undefined, questioner: createQuestioner() }),
      /Fallback LLM model cannot be removed/,
    );
  } finally {
    await rm(fallbackPaths.rootDir, { recursive: true, force: true });
  }
});

test("runLlmCommand rejects invalid configured LLM model additions", async () => {
  const paths = await createConfiguredTempPaths();

  try {
    await assert.rejects(
      runLlmCommand({ argv: ["node", "bestie", "llm", "models", "add", "--model", "missing-format"], paths, writeLine: () => undefined, questioner: createQuestioner() }),
      /provider\/model format/,
    );
    await assert.rejects(
      runLlmCommand({ argv: ["node", "bestie", "llm", "models", "add", "--model", "openai/custom-model", "--profile", "missing:api-key"], paths, writeLine: () => undefined, questioner: createQuestioner() }),
      /Unknown LLM profile/,
    );
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runLlmCommand manages LLM fallbacks", async () => {
  const paths = await createConfiguredTempPaths({
    ...baseConfig,
    llm: {
      ...baseConfig.llm,
      profiles: {
        ...baseConfig.llm.profiles,
        "anthropic:api-key": { provider: "anthropic", mode: "api-key", baseUrl: "https://api.anthropic.com/v1", apiKeyEnv: "ANTHROPIC_API_KEY" },
      },
      modelCatalog: {
        ...baseConfig.llm.modelCatalog,
        "anthropic/claude-sonnet-4-5": { profile: "anthropic:api-key" },
      },
    },
  });
  const output: string[] = [];

  try {
    await runLlmCommand({ argv: ["node", "bestie", "llm", "fallbacks", "list"], paths, writeLine: (message) => output.push(message), questioner: createQuestioner() });
    assert.match(output.join("\n"), /No fallback models configured/);

    await runLlmCommand({ argv: ["node", "bestie", "llm", "fallbacks", "add", "--model", "anthropic/claude-sonnet-4-5"], paths, writeLine: (message) => output.push(message), questioner: createQuestioner() });
    let config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    assert.deepEqual(config.llm.fallbacks, ["anthropic/claude-sonnet-4-5"]);

    await runLlmCommand({ argv: ["node", "bestie", "llm", "fallbacks", "add", "--model", "anthropic/claude-sonnet-4-5"], paths, writeLine: () => undefined, questioner: createQuestioner() });
    config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    assert.deepEqual(config.llm.fallbacks, ["anthropic/claude-sonnet-4-5"]);

    output.length = 0;
    await runLlmCommand({ argv: ["node", "bestie", "llm", "fallbacks", "list"], paths, writeLine: (message) => output.push(message), questioner: createQuestioner() });
    assert.match(output.join("\n"), /1\. anthropic\/claude-sonnet-4-5\tanthropic:api-key/);

    await runLlmCommand({ argv: ["node", "bestie", "llm", "fallbacks", "remove", "--model", "anthropic/claude-sonnet-4-5"], paths, writeLine: () => undefined, questioner: createQuestioner() });
    config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    assert.equal(config.llm.fallbacks, undefined);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runLlmCommand rejects invalid fallback models", async () => {
  const paths = await createConfiguredTempPaths();

  try {
    await assert.rejects(
      runLlmCommand({ argv: ["node", "bestie", "llm", "fallbacks", "add", "--model", "missing/model"], paths, writeLine: () => undefined, questioner: createQuestioner() }),
      /not in llm\.modelCatalog/,
    );
    await assert.rejects(
      runLlmCommand({ argv: ["node", "bestie", "llm", "fallbacks", "add", "--model", "openai/test-model"], paths, writeLine: () => undefined, questioner: createQuestioner() }),
      /Primary model cannot also be an LLM fallback/,
    );
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runLlmCommand lists, shows, and removes LLM profiles", async () => {
  const paths = await createConfiguredTempPaths(configWithExtraProfiles());
  const output: string[] = [];

  try {
    await runLlmCommand({ argv: ["node", "bestie", "llm", "profiles", "list"], paths, writeLine: (message) => output.push(message), questioner: createQuestioner() });
    assert.match(output.join("\n"), /anthropic:api-key\tanthropic\tapi-key\thttps:\/\/api\.anthropic\.com\/v1\t1 model/);
    assert.match(output.join("\n"), /openai:api-key\topenai-compatible\tapi-key\thttps:\/\/old\.example\/v1\t1 model\tdefault/);

    output.length = 0;
    await runLlmCommand({ argv: ["node", "bestie", "llm", "profiles", "show", "--profile", "anthropic:api-key"], paths, writeLine: (message) => output.push(message), questioner: createQuestioner() });
    assert.match(output.join("\n"), /Profile\s+anthropic:api-key/);
    assert.match(output.join("\n"), /Models\s+anthropic\/claude-sonnet-4-5/);

    await runLlmCommand({ argv: ["node", "bestie", "llm", "profiles", "remove", "--profile", "anthropic:api-key"], paths, writeLine: () => undefined, questioner: createQuestioner() });
    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    assert.equal(config.llm.profiles["anthropic:api-key"], undefined);
    assert.equal(config.llm.modelCatalog["anthropic/claude-sonnet-4-5"], undefined);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runLlmCommand protects active LLM profiles from removal", async () => {
  const defaultPaths = await createConfiguredTempPaths(configWithExtraProfiles());
  try {
    await assert.rejects(
      runLlmCommand({ argv: ["node", "bestie", "llm", "profiles", "remove", "--profile", "openai:api-key"], paths: defaultPaths, writeLine: () => undefined, questioner: createQuestioner() }),
      /Default LLM auth profile cannot be removed/,
    );
  } finally {
    await rm(defaultPaths.rootDir, { recursive: true, force: true });
  }

  const fallbackPaths = await createConfiguredTempPaths({
    ...configWithExtraProfiles(),
    llm: {
      ...configWithExtraProfiles().llm,
      fallbacks: ["anthropic/claude-sonnet-4-5"],
    },
  });
  try {
    await assert.rejects(
      runLlmCommand({ argv: ["node", "bestie", "llm", "profiles", "remove", "--profile", "anthropic:api-key"], paths: fallbackPaths, writeLine: () => undefined, questioner: createQuestioner() }),
      /used by active model refs/,
    );
  } finally {
    await rm(fallbackPaths.rootDir, { recursive: true, force: true });
  }

  const unknownPaths = await createConfiguredTempPaths();
  try {
    await assert.rejects(
      runLlmCommand({ argv: ["node", "bestie", "llm", "profiles", "show", "--profile", "missing:api-key"], paths: unknownPaths, writeLine: () => undefined, questioner: createQuestioner() }),
      /Unknown LLM profile/,
    );
  } finally {
    await rm(unknownPaths.rootDir, { recursive: true, force: true });
  }
});

test("runLlmCommand adds Anthropic profile without changing primary by default", async () => {
  const paths = await createConfiguredTempPaths();

  try {
    await runLlmCommand({
      argv: ["node", "bestie", "llm", "setup", "--provider", "anthropic"],
      paths,
      questioner: createQuestioner({ selects: ["api-key", "claude-sonnet-4-5"], answers: ["", "", "sk-anthropic"] }),
      writeLine: () => undefined,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    const env = await readFile(paths.envPath, "utf8");

    assert.equal(config.llm.primary, "openai/test-model");
    assert.equal(config.llm.authProfile, "openai:api-key");
    assert.equal(config.llm.profiles["anthropic:api-key"]?.provider, "anthropic");
    assert.equal(config.llm.profiles["anthropic:api-key"]?.baseUrl, "https://api.anthropic.com/v1");
    assert.equal(config.llm.profiles["anthropic:api-key"]?.apiKeyEnv, "ANTHROPIC_API_KEY");
    assert.deepEqual(config.llm.modelCatalog["anthropic/claude-sonnet-4-5"], { profile: "anthropic:api-key" });
    assert.match(env, /ANTHROPIC_API_KEY="sk-anthropic"/);
    assert.match(env, /EXISTING="keep"/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runLlmCommand changes primary when --set-default is passed", async () => {
  const paths = await createConfiguredTempPaths();

  try {
    await runLlmCommand({
      argv: ["node", "bestie", "llm", "setup", "--provider", "anthropic", "--set-default"],
      paths,
      questioner: createQuestioner({ selects: ["api-key", "claude-sonnet-4-5"], answers: ["", "", "sk-anthropic"] }),
      writeLine: () => undefined,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;

    assert.equal(config.llm.primary, "anthropic/claude-sonnet-4-5");
    assert.equal(config.llm.authProfile, "anthropic:api-key");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runLlmCommand sets up custom OpenAI-compatible provider", async () => {
  const paths = await createConfiguredTempPaths();

  try {
    await runLlmCommand({
      argv: ["node", "bestie", "llm", "setup", "--provider=custom-openai"],
      paths,
      questioner: createQuestioner({ answers: ["https://llm.example/v1/", "custom-model", "CUSTOM_KEY", "secret"] }),
      writeLine: () => undefined,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    const env = await readFile(paths.envPath, "utf8");

    assert.equal(config.llm.primary, "openai/test-model");
    assert.equal(config.llm.profiles["custom-openai:api-key"]?.provider, "openai-compatible");
    assert.equal(config.llm.profiles["custom-openai:api-key"]?.baseUrl, "https://llm.example/v1");
    assert.equal(config.llm.profiles["custom-openai:api-key"]?.apiKeyEnv, "CUSTOM_KEY");
    assert.deepEqual(config.llm.modelCatalog["custom-openai/custom-model"], { profile: "custom-openai:api-key" });
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
      questioner: createQuestioner({ selects: ["llama3.2"], answers: [""] }),
      writeLine: () => undefined,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    const env = await readFile(paths.envPath, "utf8");

    assert.equal(config.llm.primary, "openai/test-model");
    assert.equal(config.llm.profiles["ollama:local"]?.provider, "openai-compatible");
    assert.equal(config.llm.profiles["ollama:local"]?.baseUrl, "http://127.0.0.1:11434/v1");
    assert.equal(config.llm.profiles["ollama:local"]?.apiKeyEnv, undefined);
    assert.deepEqual(config.llm.modelCatalog["ollama/llama3.2"], { profile: "ollama:local" });
    assert.doesNotMatch(env, /OLLAMA_API_KEY/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runLlmCommand sets up Gemini with native API key provider", async () => {
  const paths = await createConfiguredTempPaths();

  try {
    await runLlmCommand({
      argv: ["node", "bestie", "llm", "setup", "--provider", "gemini", "--set-default"],
      paths,
      questioner: createQuestioner({ selects: ["gemini-2.5-pro"], answers: ["", "", "gemini-secret"] }),
      writeLine: () => undefined,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    const env = await readFile(paths.envPath, "utf8");

    assert.equal(config.llm.primary, "gemini/gemini-2.5-pro");
    assert.equal(config.llm.authProfile, "gemini:api-key");
    assert.equal(config.llm.profiles["gemini:api-key"]?.provider, "gemini");
    assert.equal(config.llm.profiles["gemini:api-key"]?.baseUrl, undefined);
    assert.equal(config.llm.profiles["gemini:api-key"]?.apiKeyEnv, "GEMINI_API_KEY");
    assert.deepEqual(config.llm.modelCatalog["gemini/gemini-2.5-pro"], { profile: "gemini:api-key" });
    assert.match(env, /GEMINI_API_KEY="gemini-secret"/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runLlmCommand sets up Groq with OpenAI-compatible runtime provider", async () => {
  const paths = await createConfiguredTempPaths();

  try {
    await runLlmCommand({
      argv: ["node", "bestie", "llm", "setup", "--provider", "groq", "--set-default"],
      paths,
      questioner: createQuestioner({ selects: ["llama-3.3-70b-versatile"], answers: ["", "", "gsk-secret"] }),
      writeLine: () => undefined,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    const env = await readFile(paths.envPath, "utf8");

    assert.equal(config.llm.primary, "groq/llama-3.3-70b-versatile");
    assert.equal(config.llm.authProfile, "groq:api-key");
    assert.equal(config.llm.profiles["groq:api-key"]?.provider, "openai-compatible");
    assert.equal(config.llm.profiles["groq:api-key"]?.baseUrl, "https://api.groq.com/openai/v1");
    assert.equal(config.llm.profiles["groq:api-key"]?.apiKeyEnv, "GROQ_API_KEY");
    assert.deepEqual(config.llm.modelCatalog["groq/llama-3.3-70b-versatile"], { profile: "groq:api-key" });
    assert.match(env, /GROQ_API_KEY="gsk-secret"/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runLlmCommand sets up OpenRouter with namespaced model refs", async () => {
  const paths = await createConfiguredTempPaths();

  try {
    await runLlmCommand({
      argv: ["node", "bestie", "llm", "setup", "--provider", "openrouter", "--set-default"],
      paths,
      questioner: createQuestioner({ selects: ["anthropic/claude-3.5-sonnet"], answers: ["", "", "sk-or-secret"] }),
      writeLine: () => undefined,
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    const env = await readFile(paths.envPath, "utf8");

    assert.equal(config.llm.primary, "openrouter/anthropic/claude-3.5-sonnet");
    assert.equal(config.llm.authProfile, "openrouter:api-key");
    assert.equal(config.llm.profiles["openrouter:api-key"]?.provider, "openai-compatible");
    assert.equal(config.llm.profiles["openrouter:api-key"]?.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(config.llm.profiles["openrouter:api-key"]?.apiKeyEnv, "OPENROUTER_API_KEY");
    assert.deepEqual(config.llm.modelCatalog["openrouter/anthropic/claude-3.5-sonnet"], { profile: "openrouter:api-key" });
    assert.match(env, /OPENROUTER_API_KEY="sk-or-secret"/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runLlmCommand rejects unimplemented OAuth mode without writing config", async () => {
  const paths = await createConfiguredTempPaths();
  const output: string[] = [];

  try {
    await assert.rejects(
      runLlmCommand({
        argv: ["node", "bestie", "llm", "setup", "--provider", "antigravity"],
        paths,
        questioner: createQuestioner(),
        writeLine: (message) => output.push(message),
      }),
      /OAuth setup is not implemented yet/,
    );

    const env = await readFile(paths.envPath, "utf8");
    assert.doesNotMatch(env, /ANTIGRAVITY/);
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

async function createConfiguredTempPaths(config: AppConfig = baseConfig): Promise<RuntimePaths> {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await mkdir(paths.dataDir, { recursive: true });
  await writeConfig(config, paths);
  await writeEnvFile({ EXISTING: "keep" }, paths);
  return paths;
}

function configWithExtraProfiles(): AppConfig {
  return {
    ...baseConfig,
    llm: {
      ...baseConfig.llm,
      profiles: {
        ...baseConfig.llm.profiles,
        "anthropic:api-key": { provider: "anthropic", mode: "api-key", baseUrl: "https://api.anthropic.com/v1", apiKeyEnv: "ANTHROPIC_API_KEY" },
      },
      modelCatalog: {
        ...baseConfig.llm.modelCatalog,
        "anthropic/claude-sonnet-4-5": { profile: "anthropic:api-key" },
      },
    },
  };
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
