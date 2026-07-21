import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { writeConfig } from "../../runtime/config.js";
import { writeEnvFile } from "../../runtime/env.js";
import type { RuntimePaths } from "../../runtime/paths.js";
import { runZaloCommand } from "./zalo.js";

test("runZaloCommand setup writes Zalo config and token env", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  let closed = false;

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(
      {
        version: 2,
        agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
        llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
      },
      paths,
    );
    await writeEnvFile({ OPENAI_API_KEY: "sk-test" }, paths);

    await runZaloCommand({
      argv: ["node", "bestie", "channels", "zalo", "setup"],
      paths,
      questioner: {
        ask: async () => "zalo-owner-1",
        askHidden: async () => "zalo-secret-token",
        close: () => {
          closed = true;
        },
      },
      writeLine: (message) => output.push(message),
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as {
      channels?: { zalo?: { enabled: boolean; botTokenEnv: string; ownerUserId: string } };
    };
    const envText = await readFile(paths.envPath, "utf8");

    assert.equal(closed, true);
    assert.equal(config.channels?.zalo?.enabled, true);
    assert.equal(config.channels?.zalo?.botTokenEnv, "BESTIE_ZALO_BOT_TOKEN");
    assert.equal(config.channels?.zalo?.ownerUserId, "zalo-owner-1");
    assert.match(envText, /OPENAI_API_KEY="sk-test"/);
    assert.match(envText, /BESTIE_ZALO_BOT_TOKEN="zalo-secret-token"/);
    assert.ok(output.some((line) => line.includes("Thiết lập Zalo")));
    assert.ok(output.some((line) => line.includes("Bot token") && line.includes("Nội dung nhập sẽ được ẩn")));
    assert.ok(output.some((line) => line.includes("Đã lưu cấu hình Zalo")));
    assert.ok(output.every((line) => !line.includes("zalo-secret-token")));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-zalo-command-test-"));
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