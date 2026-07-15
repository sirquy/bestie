import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { writeConfig } from "../../runtime/config.js";
import { writeEnvFile } from "../../runtime/env.js";
import type { RuntimePaths } from "../../runtime/paths.js";
import { runChannelsCommand } from "./channels.js";

test("runChannelsCommand rejects unknown channels", async () => {
  const lines: string[] = [];
  const originalError = console.error;
  const originalExitCode = process.exitCode;

  try {
    process.exitCode = undefined;
    console.error = (message?: unknown) => {
      lines.push(String(message ?? ""));
    };

    await runChannelsCommand(["node", "bestie", "channels", "unknown"]);

    assert.equal(process.exitCode, 1);
    assert.match(lines.join("\n"), /Unknown channel: unknown/);
    assert.match(lines.join("\n"), /Available channels: telegram, zalo/);
  } finally {
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
});

test("runChannelsCommand lists channel config and daemon state", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 1,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY" },
        channels: {
          telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345" },
          zalo: { enabled: false, botTokenEnv: "BESTIE_ZALO_BOT_TOKEN", ownerUserId: "" },
        },
      },
      paths,
    );
    await writeFile(
      resolve(paths.appDir, "daemon-telegram.json"),
      `${JSON.stringify({ channel: "telegram", pid: 4242, command: process.execPath, args: ["/bestie", "channels", "telegram"], startedAt: new Date().toISOString(), logPath: resolve(paths.logsDir, "daemon-telegram.log") }, null, 2)}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      resolve(paths.appDir, "daemon-zalo.json"),
      `${JSON.stringify({ channel: "zalo", pid: 4343, command: process.execPath, args: ["/bestie", "channels", "zalo"], startedAt: new Date().toISOString(), logPath: resolve(paths.logsDir, "daemon-zalo.log") }, null, 2)}\n`,
      { mode: 0o600 },
    );

    await runChannelsCommand({ argv: ["node", "bestie", "channels", "list"], paths, writeLine: (message) => lines.push(message), isProcessRunning: (pid) => pid === 4242 });

    assert.match(lines.join("\n"), /Bestie Channels/);
    assert.match(lines.join("\n"), /Telegram\s+\[ON\]\s+\[OWNER\]\s+BESTIE_TELEGRAM_BOT_TOKEN\s+\[RUN\] pid 4242/);
    assert.match(lines.join("\n"), /Zalo\s+\[OFF\]\s+\[OWNER\?\]\s+BESTIE_ZALO_BOT_TOKEN\s+\[STALE\] pid 4343/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runChannelsCommand runs channel-focused doctor checks", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];
  const originalExitCode = process.exitCode;

  try {
    process.exitCode = undefined;
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 1,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY" },
        channels: {
          telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345" },
          zalo: { enabled: true, botTokenEnv: "BESTIE_ZALO_BOT_TOKEN", ownerUserId: "" },
        },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-token", BESTIE_ZALO_BOT_TOKEN: "zalo-token" }, paths);

    await runChannelsCommand({ argv: ["node", "bestie", "channels", "doctor", "--channel", "zalo"], paths, writeLine: (message) => lines.push(message) });

    assert.match(lines.join("\n"), /Bestie Channels Doctor/);
    assert.match(lines.join("\n"), /\[FAIL\] Zalo channel:/);
    assert.doesNotMatch(lines.join("\n"), /Telegram config/);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = originalExitCode;
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runChannelsCommand prints channel doctor JSON", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];
  const originalExitCode = process.exitCode;

  try {
    process.exitCode = undefined;
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 1,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY" },
        channels: {
          telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "12345" },
          zalo: { enabled: true, botTokenEnv: "BESTIE_ZALO_BOT_TOKEN", ownerUserId: "" },
        },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-token", BESTIE_ZALO_BOT_TOKEN: "zalo-token" }, paths);

    await runChannelsCommand({ argv: ["node", "bestie", "channels", "doctor", "--channel", "zalo", "--json"], paths, writeLine: (message) => lines.push(message) });

    const parsed = JSON.parse(lines.join("\n")) as { channels: Array<{ id: string; checks: Array<{ name: string; status: string }>; issueCount: number }>; issueCount: number };
    assert.equal(parsed.issueCount, 1);
    assert.deepEqual(parsed.channels.map((channel) => channel.id), ["zalo"]);
    assert.equal(parsed.channels[0]?.issueCount, 1);
    assert.equal(parsed.channels[0]?.checks[0]?.name, "Zalo channel");
    assert.equal(parsed.channels[0]?.checks[0]?.status, "fail");
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = originalExitCode;
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-channels-command-test-"));
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
