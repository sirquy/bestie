import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("loadSystemPrompt injects runtime AGENTS.md instructions", async () => {
  const paths = await createTempPaths();

  try {
    await writeFile(paths.systemPromptPath, "Hello prompt\n");
    await writeFile(resolve(paths.appDir, "AGENTS.md"), "# Runtime Guide\n\nUse live context first.\n");

    const prompt = await loadSystemPrompt(paths);

    assert.match(prompt, /^Hello prompt\n\nRuntime workspace instructions from ~\/\.bestie\/AGENTS\.md:/);
    assert.match(prompt, /# Runtime Guide/);
    assert.match(prompt, /Use live context first/);
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

test("loadSystemPrompt appends installed skills from .bestie/skills", async () => {
  const paths = await createTempPaths();

  try {
    await writeFile(paths.systemPromptPath, "Hello prompt\n");
    await mkdir(resolve(paths.appDir, "skills", "weather"), { recursive: true });
    await mkdir(resolve(paths.appDir, "skills", "self-improving-agent"), { recursive: true });
    await writeFile(resolve(paths.appDir, "skills", "weather", "SKILL.md"), "Use weather APIs only when asked for forecasts.\n");
    await writeFile(resolve(paths.appDir, "skills", "self-improving-agent", "SKILL.md"), "Reflect on failures and propose improvements.\n");

    const prompt = await loadSystemPrompt(paths);

    assert.match(prompt, /^Hello prompt\n\nInstalled skills from \.bestie\/skills\./);
    assert.match(prompt, /## Skill: self-improving-agent\nReflect on failures/);
    assert.match(prompt, /## Skill: weather\nUse weather APIs/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("loadSystemPrompt ignores missing and empty skills", async () => {
  const paths = await createTempPaths();

  try {
    await writeFile(paths.systemPromptPath, "Hello prompt\n");
    await mkdir(resolve(paths.appDir, "skills", "empty"), { recursive: true });
    await mkdir(resolve(paths.appDir, "skills", "missing"), { recursive: true });
    await writeFile(resolve(paths.appDir, "skills", "empty", "SKILL.md"), "  \n");

    assert.equal(await loadSystemPrompt(paths), "Hello prompt\n");
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