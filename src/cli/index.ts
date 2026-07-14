#!/usr/bin/env node

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

type CommandHandler = (argv?: string[]) => Promise<void> | void;

const commandHandlers: Record<string, CommandHandler> = {
  onboard: runOnboardCommand,
  chat: runChatCommand,
  status: runStatusCommand,
  daemon: runDaemonCommand,
  logs: runLogsCommand,
  doctor: runDoctorCommand,
  memory: runMemoryCommand,
  mcp: runMcpCommand,
  channel: runChannelsCommand,
  channels: runChannelsCommand,
  skills: runSkillsCommand,
  tools: runToolsCommand,
  update: runUpdateCommand,
};

const helpText = `Bestie

Usage:
  bestie <command>

Commands:
  onboard   Create local .bestie config and character files
  chat      Start terminal chat after onboarding
  status    Show local setup status
  daemon    Start, stop, or inspect the local background daemon
  logs      Show recent redacted operational logs
  doctor    Diagnose local setup problems
  memory    Inspect or manually add local memories
  mcp       List configured MCP servers
  channels  Start, configure, or inspect channel adapters (telegram, zalo)
  skills    List installed skills from .bestie/skills
  tools     Run permission-gated local tools
  update    Check npm for a newer Bestie version, or install it with --apply

Options:
  -h, --help  Show this help

Onboard options:
  --skip-provider-test  Save local files without calling the configured provider

Doctor options:
  --json  Print machine-readable diagnostic output
  --fix  Repair safe local filesystem, permission, and SQLite issues
  --telegram-connect  Verify enabled Telegram bot identity with a network call
  --zalo-connect  Verify enabled Zalo bot identity with a network call
  --telegram-speech-test  Generate and convert a local Telegram voice sample

MCP options:
  list  List configured MCP servers without starting them
  show <name>  Show one MCP server without env values
  test <name>  Run config-only MCP server checks without starting it
  test <name> --connect  Start one MCP server briefly and check initialize
  tools <name> --connect  Start one MCP server briefly and list tool metadata
  classify <server> <tool> --category read  Update local MCP tool classification without starting it
  call <server> <tool> --read --json '{...}'  Run a read-only MCP tool through the permission gate
  call <server> <tool> --read --ask --json '{...}'  Prompt before this read-only MCP call

Channels options:
  telegram  Telegram channel adapter (see bestie channels telegram --help)
  zalo      Zalo channel adapter (see bestie channels zalo --help)

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

async function main(argv: string[]): Promise<void> {
  const command = argv[2];

  if (!command || command === "--help" || command === "-h") {
    console.log(helpText);
    return;
  }

  const handler = commandHandlers[command];

  if (!handler) {
    if (command === "telegram" || command === "zalo") {
      console.error(`Channel commands now live under \`bestie channels ${command}\`.`);
      console.error(`Run \`bestie channels ${command} --help\` to see available options.`);
      process.exitCode = 1;
      return;
    }

    console.error(`Unknown command: ${command}`);
    console.error("Run `bestie --help` to see available Phase Now commands.");
    process.exitCode = 1;
    return;
  }

  await handler(argv);
}

main(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected CLI error.";
  console.error(message);
  process.exitCode = 1;
});
