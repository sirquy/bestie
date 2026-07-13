import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { EmptyPromptError } from "../runtime/errors.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { loadSystemPrompt } from "./prompt-loader.js";

test("loadSystemPrompt returns editable prompt text", async () => {
  const paths = await createTempPaths();

  try {
    await writeFile(paths.systemPromptPath, "Hello prompt\n");
    assert.equal(await loadSystemPrompt(paths), "Hello prompt\n");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("loadSystemPrompt rejects empty prompt files", async () => {
  const paths = await createTempPaths();

  try {
    await writeFile(paths.systemPromptPath, "  \n");
    await assert.rejects(() => loadSystemPrompt(paths), EmptyPromptError);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-test-"));
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