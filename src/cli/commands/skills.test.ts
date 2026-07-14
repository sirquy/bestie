import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { RuntimePaths } from "../../runtime/paths.js";
import { runSkillsCommand } from "./skills.js";

test("runSkillsCommand lists installed skills", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(resolve(paths.appDir, "skills", "weather"), { recursive: true });
    await writeFile(resolve(paths.appDir, "skills", "weather", "SKILL.md"), "Use weather APIs.\n");

    await runSkillsCommand({ argv: ["node", "bestie", "skills"], paths, writeLine: (line) => lines.push(line) });

    assert.equal(lines[0], "Installed skills");
    assert.match(lines[1] ?? "", /weather/);
    assert.match(lines[1] ?? "", /SKILL\.md/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runSkillsCommand reports no installed skills", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await runSkillsCommand({ argv: ["node", "bestie", "skills", "list"], paths, writeLine: (line) => lines.push(line) });

    assert.match(lines[0] ?? "", /No installed skills found/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-skills-command-test-"));
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
