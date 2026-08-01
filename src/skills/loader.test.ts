import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { RuntimePaths } from "../runtime/paths.js";
import { buildInstalledSkillsPromptSection, loadInstalledSkills } from "./loader.js";

test("loadInstalledSkills skips disabled skills unless requested", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(resolve(paths.appDir, "skills", "active-skill"), { recursive: true });
    await mkdir(resolve(paths.appDir, "skills", "disabled-skill"), { recursive: true });
    await writeFile(resolve(paths.appDir, "skills", "active-skill", "SKILL.md"), "# Active Skill\n\nUse me.\n");
    await writeFile(resolve(paths.appDir, "skills", "disabled-skill", "SKILL.md"), "# Disabled Skill\n\nDo not inject me.\n");
    await writeFile(resolve(paths.appDir, "skills", "disabled-skill", "bestie-skill.json"), `${JSON.stringify({ schemaVersion: 1, name: "disabled-skill", source: "local", installedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), contentHash: "x", enabled: false }, null, 2)}\n`);

    const activeOnly = await loadInstalledSkills(paths);
    assert.deepEqual(activeOnly.map((skill) => skill.name), ["active-skill"]);
    assert.equal(buildInstalledSkillsPromptSection(activeOnly)?.includes("Disabled Skill"), false);

    const all = await loadInstalledSkills(paths, { includeDisabled: true });
    assert.deepEqual(all.map((skill) => [skill.name, skill.enabled]), [["active-skill", true], ["disabled-skill", false]]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-skills-loader-test-"));
  const appDir = resolve(rootDir, ".bestie");
  return {
    rootDir,
    appDir,
    configPath: resolve(appDir, "config.json"),
    envPath: resolve(appDir, ".env"),
    characterPath: resolve(appDir, "character.json"),
    systemPromptPath: resolve(appDir, "system-prompt.md"),
    logsDir: resolve(appDir, "logs"),
    appLogPath: resolve(appDir, "logs", "app.log"),
    dataDir: resolve(appDir, "data"),
    memoryDbPath: resolve(appDir, "data", "memory.sqlite"),
    workspaceDir: resolve(appDir, "workspace"),
  };
}
