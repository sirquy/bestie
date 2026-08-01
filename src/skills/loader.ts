import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { RuntimePaths } from "../runtime/paths.js";

export interface InstalledSkill {
  name: string;
  content: string;
  path: string;
  enabled: boolean;
}

const MAX_SKILL_PROMPT_BYTES = 96 * 1024;

export async function loadInstalledSkills(paths: RuntimePaths, options: { maxBytes?: number; includeDisabled?: boolean } = {}): Promise<InstalledSkill[]> {
  const skillsDir = resolve(paths.appDir, "skills");
  let entries: Dirent[];

  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: InstalledSkill[] = [];
  let usedBytes = 0;
  const maxBytes = options.maxBytes ?? MAX_SKILL_PROMPT_BYTES;

  for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith(".")).sort((left, right) => left.name.localeCompare(right.name))) {
    const skillPath = resolve(skillsDir, entry.name, "SKILL.md");
    let content: string;

    try {
      content = await readFile(skillPath, "utf8");
    } catch {
      continue;
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      continue;
    }

    const enabled = await isSkillEnabled(skillsDir, entry.name);
    if (!enabled && options.includeDisabled !== true) {
      continue;
    }

    const nextBytes = Buffer.byteLength(trimmedContent, "utf8");
    if (usedBytes + nextBytes > maxBytes) {
      break;
    }

    skills.push({ name: entry.name, content: trimmedContent, path: skillPath, enabled });
    usedBytes += nextBytes;
  }

  return skills;
}

async function isSkillEnabled(skillsDir: string, name: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(resolve(skillsDir, name, "bestie-skill.json"), "utf8"));
    return manifest?.enabled !== false;
  } catch {
    return true;
  }
}

export function buildInstalledSkillsPromptSection(skills: InstalledSkill[]): string | undefined {
  if (skills.length === 0) {
    return undefined;
  }

  return `Installed skills from .bestie/skills. Use a skill when the user's request matches its purpose; follow the relevant SKILL.md instructions while preserving higher-priority system, safety, and project rules.\n\n${skills.map((skill) => `## Skill: ${skill.name}\n${skill.content}`).join("\n\n")}`;
}
