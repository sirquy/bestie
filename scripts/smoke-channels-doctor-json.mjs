import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { runChannelsCommand } from "../dist/cli/commands/channels.js";
import { writeConfig } from "../dist/runtime/config.js";
import { writeEnvFile } from "../dist/runtime/env.js";

const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-channels-doctor-json-smoke-"));
const paths = createRuntimePaths(rootDir);
const lines = [];

try {
  await mkdir(paths.appDir, { recursive: true });
  await writeConfig(
    {
      version: 2,
      agent: { name: "Bestie", ownerName: "Boss", language: "vi", toneIntensity: 7 },
      llm: {
        primary: "openai/test-model",
        authProfile: "openai:api-key",
        profiles: {
          "openai:api-key": {
            provider: "openai-compatible",
            mode: "api-key",
            baseUrl: "http://127.0.0.1:9/v1",
            apiKeyEnv: "OPENAI_API_KEY",
          },
        },
        modelCatalog: {
          "openai/test-model": { profile: "openai:api-key" },
        },
      },
      channels: {
        telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345" },
        zalo: { enabled: true, botTokenEnv: "BESTIE_ZALO_BOT_TOKEN", ownerUserId: "67890" },
      },
    },
    paths,
  );
  await writeEnvFile({ OPENAI_API_KEY: "test-key", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-token", BESTIE_ZALO_BOT_TOKEN: "zalo-token" }, paths);

  await runChannelsCommand({ argv: ["node", "bestie", "channels", "doctor", "--channel", "all", "--json"], paths, writeLine: (message) => lines.push(message) });

  const report = JSON.parse(lines.join("\n"));
  assert.equal(report.issueCount, 0);
  assert.deepEqual(report.channels.map((channel) => channel.id), ["telegram", "zalo", "zalo-personal"]);
  assert.equal(report.channels.every((channel) => Number.isInteger(channel.issueCount)), true);
  assert.equal(report.channels.every((channel) => Array.isArray(channel.checks)), true);

  console.log(`${report.channels.length} channels, ${report.issueCount} issues`);
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
