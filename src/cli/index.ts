#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { CommanderError, type Command } from "commander";

import { runChatCommand } from "./commands/chat.js";
import { runDaemonCommand } from "./commands/daemon.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runLogsCommand } from "./commands/logs.js";
import { runMemoryCommand } from "./commands/memory.js";
import { runMcpCommand } from "./commands/mcp.js";
import { runOnboardCommand } from "./commands/onboard.js";
import { runStatusCommand } from "./commands/status.js";
import { runChannelsCommand } from "./commands/channels.js";
import { runSkillsCommand } from "./commands/skills.js";
import { runToolsCommand } from "./commands/tools.js";
import { runUpdateCommand } from "./commands/update.js";
import { createCliProgram, type CliCommandSpec } from "./command-router.js";
import { badge, dim } from "./ui.js";

const bannerText = String.raw`
 ____            _   _            _                    _   
| __ )  ___  ___| |_(_) ___      / \   __ _  ___ _ __ | |_ 
|  _ \ / _ \/ __| __| |/ _ \    / _ \ / _' |/ _ \ '_ \| __|
| |_) |  __/\__ \ |_| |  __/   / ___ \ (_| |  __/ | | | |_ 
|____/ \___||___/\__|_|\___|  /_/   \_\__, |\___|_| |_|\__|
                                      |___/                 
`;

const helpDetails = `
Onboard options:
  --skip-provider-test  Save local files without calling the configured provider

Doctor options:
  --json  Print machine-readable diagnostic output
  --fix  Repair safe local filesystem, permission, and SQLite issues
  --telegram-connect  Verify enabled Telegram bot identity with a network call
  --zalo-connect  Verify enabled Zalo bot identity with a network call
  --telegram-speech-test  Generate and convert a local Telegram voice sample

MCP options:
  Run bestie mcp --help for MCP server commands.

Channels options:
  Run bestie channels --help for channel adapters and diagnostics.

Daemon options:
  start [--channel telegram|zalo|all]    Start channel polling in the background
  stop [--channel telegram|zalo|all]     Stop channel daemon(s)
  restart [--channel telegram|zalo|all]  Stop and start channel daemon(s)
  status [--channel telegram|zalo|all]   Show channel daemon status

Tools options:
  logs --lines N  Read recent redacted app logs through the permission gate
  memories --limit N  Read active local memories through the permission gate
  attachments cleanup --older-than 7d --kinds voice,audio --confirm
    Delete old Telegram attachment files; omit --confirm for a dry run

Update options:
  --apply  Run npm install -g bestie-agent@latest after a newer version is found
`;

const commandSpecs: CliCommandSpec[] = [
  { name: "onboard", description: "Create local .bestie config and character files", handler: runOnboardCommand },
  { name: "chat", description: "Start terminal chat after onboarding", handler: runChatCommand },
  { name: "status", description: "Show local setup status", handler: runStatusCommand },
  { name: "daemon", description: "Start, stop, or inspect the local background daemon", handler: runDaemonCommand },
  { name: "logs", description: "Show recent redacted operational logs", handler: runLogsCommand },
  { name: "doctor", description: "Diagnose local setup problems", handler: runDoctorCommand },
  { name: "memory", description: "Inspect or manually add local memories", handler: runMemoryCommand },
  {
    name: "mcp",
    description: "List, inspect, classify, or call configured MCP servers",
    handler: runMcpCommand,
    children: [
      { name: "list", description: "List configured MCP servers without starting them", handler: runMcpCommand },
      { name: "show <name>", description: "Show one MCP server without env values", handler: runMcpCommand },
      { name: "test <name>", description: "Run config-only checks, or add --connect to start briefly", handler: runMcpCommand },
      { name: "tools <name>", description: "List tool metadata; add --connect to start the server", handler: runMcpCommand },
      { name: "classify <server> <tool>", description: "Update local MCP tool classification", handler: runMcpCommand },
      { name: "call <server> <tool>", description: "Run a read-only MCP tool through the permission gate", handler: runMcpCommand },
    ],
  },
  createChannelsCommandSpec("channels", false),
  createChannelsCommandSpec("channel", true),
  { name: "skills", description: "List installed skills from .bestie/skills", handler: runSkillsCommand },
  { name: "tools", description: "Run permission-gated local tools", handler: runToolsCommand },
  { name: "update", description: "Check npm for a newer Bestie version, or install it with --apply", handler: runUpdateCommand },
];

export async function main(argv: string[]): Promise<void> {
  await showBanner(argv);

  if (!argv[2]) {
    console.log(createProgram(argv).helpInformation().trimEnd());
    return;
  }

  try {
    await createProgram(argv).parseAsync(argv, { from: "node" });
  } catch (error) {
    if (error instanceof CommanderError) {
      handleCommanderError(error, argv[2]);
      return;
    }

    throw error;
  }
}

function createProgram(argv: string[]): Command {
  return createCliProgram({
    argv,
    commands: commandSpecs,
    description: "Local-first Bestie agent CLI",
    helpDetails,
    name: "bestie",
    usage: "<command>",
    writeOut: console.log,
    writeErr: console.error,
  });
}

function createChannelsCommandSpec(name: "channel" | "channels", hidden: boolean): CliCommandSpec {
  return {
    name,
    description: hidden ? "Alias for channels" : "Start, configure, or inspect channel adapters",
    handler: runChannelsCommand,
    hidden,
    children: [
      { name: "list", description: "Show configured channels and daemon state", handler: runChannelsCommand },
      { name: "status", description: "Alias for list", handler: runChannelsCommand },
      { name: "doctor", description: "Run channel-focused diagnostics", handler: runChannelsCommand },
      {
        name: "telegram",
        description: "Start or configure the Telegram channel adapter",
        handler: runChannelsCommand,
        children: [
          { name: "setup", description: "Configure Telegram owner id/username and bot token", handler: runChannelsCommand },
          { name: "whoami", description: "Show the id and username from the most recent Telegram bot message", handler: runChannelsCommand },
          { name: "voice", description: "Configure or inspect Telegram local voice support", handler: runChannelsCommand },
        ],
      },
      {
        name: "zalo",
        description: "Start or configure the Zalo channel adapter",
        handler: runChannelsCommand,
        children: [{ name: "setup", description: "Configure Zalo owner id and bot token", handler: runChannelsCommand }],
      },
    ],
  };
}

function handleCommanderError(error: CommanderError, command?: string): void {
  if (error.code === "commander.helpDisplayed") {
    return;
  }

  if (command === "telegram" || command === "zalo") {
    console.error(`${badge("MOVED", "yellow")} Channel commands now live under \`bestie channels ${command}\`.`);
    console.error(`${dim("Next")} Run \`bestie channels ${command} --help\` to see available options.`);
    process.exitCode = 1;
    return;
  }

  if (error.code === "commander.unknownCommand") {
    console.error(`${badge("ERROR", "red")} ${error.message}`);
    console.error(`${dim("Next")} Run \`bestie --help\` to see available commands.`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = error.exitCode;
}

async function showBanner(argv: string[]): Promise<void> {
  if (shouldSuppressBanner(argv)) {
    return;
  }

  if (!shouldAnimateBanner()) {
    console.log(bannerText);
    return;
  }

  await animateBanner(bannerText);
}

function shouldAnimateBanner(): boolean {
  if (process.env.BESTIE_BANNER === "static") {
    return false;
  }
  if (process.env.BESTIE_BANNER === "animate") {
    return true;
  }

  return Boolean(process.stdout.isTTY);
}

async function animateBanner(text: string): Promise<void> {
  const frames = [".", "o", "O", "@"];
  const lines = text.trimEnd().split("\n");

  for (let frame = 0; frame < frames.length; frame += 1) {
    const glyph = frames[frame] ?? "@";
    const rendered = lines.map((line) => line.replace(/[^\s]/g, glyph)).join("\n");
    process.stdout.write(`${rendered}\n`);
    await sleep(28);
    process.stdout.write(`\x1b[${lines.length}A\x1b[J`);
  }

  console.log(bannerText);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function shouldSuppressBanner(argv: string[]): boolean {
  const command = argv[2];
  if (process.env.BESTIE_NO_BANNER === "1") {
    return true;
  }
  if (command === "doctor" && argv.includes("--json")) {
    return true;
  }
  if (command === "channels" && argv[3] === "doctor" && argv.includes("--json")) {
    return true;
  }
  if (command === "mcp" && argv[3] === "call" && argv.includes("--json")) {
    return true;
  }
  if (command === "memory" && argv[3] === "export") {
    return true;
  }

  return false;
}

if (isCliEntrypoint()) {
  main(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unexpected CLI error.";
    console.error(message);
    process.exitCode = 1;
  });
}

function isCliEntrypoint(): boolean {
  return process.argv[1] ? import.meta.url === new URL(realpathSync(process.argv[1]), "file:").href : false;
}
