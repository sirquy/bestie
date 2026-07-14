import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { runTelegramCommand } from "../dist/cli/commands/telegram.js";
import { writeConfig } from "../dist/runtime/config.js";
import { writeEnvFile } from "../dist/runtime/env.js";

const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-telegram-setup-smoke-"));
const paths = createRuntimePaths(rootDir);
const output = [];

try {
  await mkdir(paths.appDir, { recursive: true });
  await writeConfig(
    {
      version: 1,
      agent: { name: "Bestie", ownerName: "Boss", language: "vi", toneIntensity: 7 },
      llm: { provider: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", model: "test-model", apiKeyEnv: "OPENAI_API_KEY" },
    },
    paths,
  );
  await writeEnvFile({ OPENAI_API_KEY: "test-key" }, paths);

  await runTelegramCommand({
    argv: ["node", "bestie", "channels", "telegram", "setup"],
    paths,
    questioner: {
      ask: async () => "12345",
      askHidden: async () => "test-telegram-token",
      close: () => undefined,
    },
    writeLine: (message) => output.push(message),
    useColor: false,
  });

  const configText = await readFile(paths.configPath, "utf8");
  const envText = await readFile(paths.envPath, "utf8");

  assertIncludes(configText, '"telegram"');
  assertIncludes(configText, '"ownerUserId": "12345"');
  assertIncludes(envText, 'BESTIE_TELEGRAM_BOT_TOKEN="test-telegram-token"');
  assertNotIncludes(output.join("\n"), "test-telegram-token");
  console.log("Telegram setup smoke passed.");
} finally {
  await rm(rootDir, { recursive: true, force: true });
}

function createRuntimePaths(root) {
  const appDir = resolve(root, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");

  return {
    rootDir: root,
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

function assertIncludes(value, expected) {
  if (!value.includes(expected)) {
    throw new Error(`Expected output to include ${expected}`);
  }
}

function assertNotIncludes(value, unexpected) {
  if (value.includes(unexpected)) {
    throw new Error(`Expected output not to include ${unexpected}`);
  }
}