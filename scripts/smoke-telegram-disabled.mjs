import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { writeConfig } from "../dist/runtime/config.js";

const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-telegram-disabled-smoke-"));
const projectRoot = process.env.INIT_CWD ?? process.cwd();
const cliPath = resolve(projectRoot, "dist/cli/index.js");

try {
  const appDir = resolve(rootDir, ".bestie");
  await mkdir(appDir, { recursive: true });
  await writeConfig({
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
      modelCatalog: { "openai/test-model": { profile: "openai:api-key" } },
    },
  }, { rootDir, appDir, configPath: resolve(appDir, "config.json"), envPath: resolve(appDir, ".env"), characterPath: resolve(appDir, "character.json"), systemPromptPath: resolve(appDir, "system-prompt.md"), logsDir: resolve(appDir, "logs"), appLogPath: resolve(appDir, "logs", "app.log"), dataDir: resolve(appDir, "data"), memoryDbPath: resolve(appDir, "data", "memory.sqlite"), workspaceDir: resolve(appDir, "workspace") });

  const result = spawnSync(process.execPath, [cliPath, "channels", "telegram"], {
    cwd: rootDir,
    env: { ...process.env, HOME: rootDir, USERPROFILE: rootDir, HOMEDRIVE: "", HOMEPATH: rootDir },
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(`${result.stdout}\n${result.stderr}`, /Telegram chưa được bật/);
  console.log("Telegram disabled smoke passed.");
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
