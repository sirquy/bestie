import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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

  const promptWithWorkspaceInstructions = await appendWorkspaceInstructions(prompt, paths);

  return appendInstalledSkills(promptWithWorkspaceInstructions, paths);
}

const MAX_SKILL_PROMPT_BYTES = 96 * 1024;

export async function loadWorkspaceInstructions(paths: RuntimePaths): Promise<string | undefined> {
  try {
    const text = await readFile(resolve(paths.appDir, "AGENTS.md"), "utf8");
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

export async function appendWorkspaceInstructions(systemPrompt: string, paths: RuntimePaths): Promise<string> {
  const workspaceInstructions = await loadWorkspaceInstructions(paths);
  if (!workspaceInstructions) {
    return systemPrompt;
  }

  return appendWorkspaceInstructionsText(systemPrompt, workspaceInstructions);
}

export function appendWorkspaceInstructionsText(systemPrompt: string, workspaceInstructions: string | undefined): string {
  const trimmed = workspaceInstructions?.trim();
  if (!trimmed) {
    return systemPrompt;
  }

  return `${systemPrompt.trimEnd()}\n\nRuntime workspace instructions from ~/.bestie/AGENTS.md:\n\n${trimmed}\n`;
}

async function appendInstalledSkills(systemPrompt: string, paths: RuntimePaths): Promise<string> {
  const skillsSection = buildInstalledSkillsPromptSection(await loadInstalledSkills(paths, { maxBytes: MAX_SKILL_PROMPT_BYTES }));
  if (!skillsSection) {
    return systemPrompt;
  }

  return `${systemPrompt.trimEnd()}\n\n${skillsSection}`;
}