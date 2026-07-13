import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { loadEnvFile, parseEnv, writeEnvFile } from "./env.js";
import type { RuntimePaths } from "./paths.js";

test("parseEnv reads JSON-quoted values", () => {
  assert.deepEqual(parseEnv('BESTIE_LLM_API_KEY="sk value # with spaces"\n'), {
    BESTIE_LLM_API_KEY: "sk value # with spaces",
  });
});

test("writeEnvFile round-trips values with spaces and symbols", async () => {
  const paths = await createTempPaths();

  try {
    await writeEnvFile({ BESTIE_LLM_API_KEY: 'sk value # "quoted"' }, paths);
    assert.deepEqual(await loadEnvFile(paths), {
      BESTIE_LLM_API_KEY: 'sk value # "quoted"',
    });
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-env-test-"));
  const appDir = rootDir;
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
