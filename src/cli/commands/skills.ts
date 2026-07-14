import { loadInstalledSkills } from "../../skills/loader.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

export interface SkillsCommandOptions {
  argv?: string[];
  paths?: RuntimePaths;
  writeLine?: (message: string) => void;
}

export async function runSkillsCommand(options: SkillsCommandOptions | string[] = {}): Promise<void> {
  const argv = Array.isArray(options) ? options : options.argv ?? process.argv;
  const paths = Array.isArray(options) ? getRuntimePaths() : options.paths ?? getRuntimePaths();
  const writeLine = Array.isArray(options) ? console.log : options.writeLine ?? console.log;
  const subcommand = argv[3];

  if (subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    printSkillsHelp(writeLine);
    return;
  }

  if (subcommand && subcommand !== "list") {
    console.error(`Unknown skills command: ${subcommand}`);
    printSkillsHelp(writeLine);
    process.exitCode = 1;
    return;
  }

  const skills = await loadInstalledSkills(paths);
  if (skills.length === 0) {
    writeLine(`No installed skills found in ${paths.appDir}/skills.`);
    return;
  }

  writeLine("Installed skills");
  for (const skill of skills) {
    writeLine(`- ${skill.name} (${skill.path})`);
  }
}

function printSkillsHelp(writeLine: (message: string) => void): void {
  writeLine(`Bestie skills

Usage:
  bestie skills
  bestie skills list

Skills are loaded from .bestie/skills/<skill-name>/SKILL.md and injected into chat system prompts.`);
}
