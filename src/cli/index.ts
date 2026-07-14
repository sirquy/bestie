#!/usr/bin/env node

import { runChatCommand } from "./commands/chat.js";
import { runDaemonCommand } from "./commands/daemon.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runLogsCommand } from "./commands/logs.js";
import { runMemoryCommand } from "./commands/memory.js";
import { runMcpCommand } from "./commands/mcp.js";
import { runOnboardCommand } from "./commands/onboard.js";
import { runStatusCommand } from "./commands/status.js";
import { runTelegramCommand } from "./commands/telegram.js";
import { runToolsCommand } from "./commands/tools.js";
import { runZaloCommand } from "./commands/zalo.js";

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
  telegram: runTelegramCommand,
  tools: runToolsCommand,
  zalo: runZaloCommand,
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
  telegram  Start the local Telegram polling bot
  tools     Run permission-gated local tools
  zalo      Start the local Zalo polling bot

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

Telegram options:
  setup   Configure Telegram owner id and local bot token
  voice setup-local  Configure local voice transcription from existing whisper.cpp files
  voice models  List local whisper.cpp models and the configured model
  voice download-model <name> --confirm [--use] [--force]
    Download tiny, small, medium, or large-v3-turbo whisper.cpp model
  --once  Poll Telegram once, then exit
  --transcript <path>  Write a redacted JSONL smoke transcript for Telegram polling

Zalo options:
  setup   Configure Zalo owner id and local bot token
  --once  Poll Zalo once, then exit

Daemon options:
  start   Start Telegram polling in the background
  stop    Stop the background daemon
  restart Stop and start the background daemon
  status  Show daemon status

Tools options:
  logs --lines N  Read recent redacted app logs through the permission gate
  memories --limit N  Read active local memories through the permission gate
  attachments cleanup --older-than 7d --kinds voice,audio --confirm
    Delete old Telegram attachment files; omit --confirm for a dry run
`;

async function main(argv: string[]): Promise<void> {
  const command = argv[2];

  if (!command || command === "--help" || command === "-h") {
    console.log(helpText);
    return;
  }

  const handler = commandHandlers[command];

  if (!handler) {
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
