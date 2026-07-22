import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { loadInstalledSkills } from "../../skills/loader.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

export interface UiSkillsSummary {
  ok: true;
  count: number;
  skillsDir: string;
  skills: UiSkill[];
}

export interface UiSkill {
  name: string;
  path: string;
  bytes: number;
  preview: string;
}

export interface UiSkillWriteOptions {
  name: string;
  content: string;
  previousName?: string;
  paths?: RuntimePaths;
}

export interface UiSkillDeleteOptions {
  name: string;
  paths?: RuntimePaths;
}

export async function getUiSkillsSummary(paths: RuntimePaths = getRuntimePaths()): Promise<UiSkillsSummary> {
  const skills = await loadInstalledSkills(paths, { maxBytes: Number.MAX_SAFE_INTEGER });
  return {
    ok: true,
    count: skills.length,
    skillsDir: resolve(paths.appDir, "skills"),
    skills: skills.map((skill) => ({
      name: skill.name,
      path: skill.path,
      bytes: Buffer.byteLength(skill.content, "utf8"),
      preview: skill.content.slice(0, 220),
    })),
  };
}

export async function getUiSkill(name: string, paths: RuntimePaths = getRuntimePaths()): Promise<{ ok: true; name: string; path: string; content: string }> {
  const skillPath = resolveSkillPath(paths, name);
  return { ok: true, name: normalizeSkillName(name), path: skillPath, content: await readFile(skillPath, "utf8") };
}

export async function writeUiSkill(options: UiSkillWriteOptions): Promise<UiSkillsSummary> {
  const paths = options.paths ?? getRuntimePaths();
  const skillName = normalizeSkillName(options.name);
  if (!skillName) throw new Error("Skill name is required.");
  if (!options.content.trim()) throw new Error("Skill content is required.");

  const skillDir = resolve(paths.appDir, "skills", skillName);
  await mkdir(skillDir, { recursive: true, mode: 0o700 });
  await writeFile(resolve(skillDir, "SKILL.md"), options.content.endsWith("\n") ? options.content : `${options.content}\n`, { mode: 0o600 });
  const previousName = options.previousName ? normalizeSkillName(options.previousName) : "";
  if (previousName && previousName !== skillName) await rm(resolve(paths.appDir, "skills", previousName), { recursive: true, force: true });
  return getUiSkillsSummary(paths);
}

export async function deleteUiSkill(options: UiSkillDeleteOptions): Promise<UiSkillsSummary> {
  const paths = options.paths ?? getRuntimePaths();
  const skillName = normalizeSkillName(options.name);
  if (!skillName) throw new Error("Skill name is required.");
  await rm(resolve(paths.appDir, "skills", skillName), { recursive: true, force: true });
  return getUiSkillsSummary(paths);
}

function resolveSkillPath(paths: RuntimePaths, name: string): string {
  return resolve(paths.appDir, "skills", normalizeSkillName(name), "SKILL.md");
}

function normalizeSkillName(name: string): string {
  const cleaned = basename(name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-"));
  if (cleaned === "." || cleaned === "..") return "";
  return cleaned;
}
