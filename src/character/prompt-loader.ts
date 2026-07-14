import { readFile } from "node:fs/promises";

import { EmptyPromptError, MissingCharacterFileError } from "../runtime/errors.js";
import { getRuntimePaths, type RuntimePaths } from "../runtime/paths.js";
import { buildInstalledSkillsPromptSection, loadInstalledSkills } from "../skills/loader.js";

export async function loadSystemPrompt(paths: RuntimePaths = getRuntimePaths()): Promise<string> {
  let prompt: string;

  try {
    prompt = await readFile(paths.systemPromptPath, "utf8");
  } catch {
    throw new MissingCharacterFileError(paths.systemPromptPath);
  }

  if (prompt.trim().length === 0) {
    throw new EmptyPromptError(paths.systemPromptPath);
  }

  return appendInstalledSkills(prompt, paths);
}

const MAX_SKILL_PROMPT_BYTES = 96 * 1024;

async function appendInstalledSkills(systemPrompt: string, paths: RuntimePaths): Promise<string> {
  const skillsSection = buildInstalledSkillsPromptSection(await loadInstalledSkills(paths, { maxBytes: MAX_SKILL_PROMPT_BYTES }));
  if (!skillsSection) {
    return systemPrompt;
  }

  return `${systemPrompt.trimEnd()}\n\n${skillsSection}`;
}