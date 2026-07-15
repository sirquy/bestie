import { runChannelsCommand } from "./commands/channels.js";
import { runChatCommand } from "./commands/chat.js";
import { runCronCommand } from "./commands/cron.js";
import { runDaemonCommand } from "./commands/daemon.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runLogsCommand } from "./commands/logs.js";
import { runMcpCommand } from "./commands/mcp.js";
import { runMemoryCommand } from "./commands/memory.js";
import { runOnboardCommand } from "./commands/onboard.js";
import { runSkillsCommand } from "./commands/skills.js";
import { runStatusCommand } from "./commands/status.js";
import { runToolsCommand } from "./commands/tools.js";
import { runUpdateCommand } from "./commands/update.js";
import { runVoiceCommand } from "./commands/voice.js";
import type { CliCommandSpec } from "./command-router.js";

export const cliHelpDetails = `
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
  start [--channel telegram|zalo|cron|all]    Start runtime daemon(s) in the background
  stop [--channel telegram|zalo|cron|all]     Stop runtime daemon(s)
  restart [--channel telegram|zalo|cron|all]  Stop and start runtime daemon(s)
  status [--channel telegram|zalo|cron|all]   Show runtime daemon status
  install                                    Install and start user systemd service(s)
  uninstall                                  Stop and remove user systemd service(s)

Tools options:
  logs --lines N  Read recent redacted app logs through the permission gate
  memories --limit N  Read active local memories through the permission gate
  attachments cleanup --older-than 7d --kinds voice,audio --confirm
    Delete old Telegram attachment files; omit --confirm for a dry run

Update options:
  --apply  Run npm install -g bestie-agent@latest after a newer version is found

Cron options:
  list           List all cron schedules
  add            Create a new cron schedule (interactive or with --name --type --schedule --prompt)
  remove <id>    Remove a cron schedule by ID
  toggle <id>    Toggle a cron schedule on/off
  logs [id]      Show recent cron execution logs
  run            Run the cron scheduler until stopped

Voice options:
  setup-local       Configure local whisper.cpp transcription
  setup-elevenlabs  Configure ElevenLabs speech and transcription
  models            List local whisper.cpp models
  download-model    Download a local whisper.cpp model
`;

export const cliCommandSpecs: CliCommandSpec[] = [
  { name: "onboard", description: "Create local .bestie config and character files", handler: runOnboardCommand },
  { name: "chat", description: "Start terminal chat after onboarding", handler: runChatCommand },
  { name: "status", description: "Show local setup status", handler: runStatusCommand },
  {
    name: "daemon",
    description: "Start, stop, inspect, or install the local background daemon",
    handler: runDaemonCommand,
    children: [
      { name: "start", description: "Start runtime daemon(s)", handler: runDaemonCommand },
      { name: "stop", description: "Stop runtime daemon(s)", handler: runDaemonCommand },
      { name: "restart", description: "Restart runtime daemon(s)", handler: runDaemonCommand },
      { name: "status", description: "Show runtime daemon status", handler: runDaemonCommand },
      { name: "install", description: "Install and start user systemd service(s)", handler: runDaemonCommand },
      { name: "uninstall", description: "Stop and remove user systemd service(s)", handler: runDaemonCommand },
      { name: "install-service", description: "Alias for install", handler: runDaemonCommand, hidden: true },
      { name: "uninstall-service", description: "Alias for uninstall", handler: runDaemonCommand, hidden: true },
    ],
  },
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
  {
    name: "voice",
    description: "Configure shared voice input and speech output",
    handler: runVoiceCommand,
    children: [
      { name: "setup-local", description: "Configure local whisper.cpp transcription", handler: runVoiceCommand },
      { name: "setup-elevenlabs", description: "Configure ElevenLabs voice support", handler: runVoiceCommand },
      { name: "models", description: "List local whisper.cpp models", handler: runVoiceCommand },
      { name: "download-model <model>", description: "Download a local whisper.cpp model", handler: runVoiceCommand },
    ],
  },
  {
    name: "cron",
    description: "Manage scheduled cron jobs for the agent",
    handler: runCronCommand,
    children: [
      { name: "list", description: "List all cron schedules", handler: runCronCommand },
      { name: "add", description: "Create a cron schedule", handler: runCronCommand },
      { name: "remove <id>", description: "Remove a cron schedule", handler: runCronCommand },
      { name: "toggle <id>", description: "Toggle a cron schedule", handler: runCronCommand },
      { name: "logs [id]", description: "Show cron execution logs", handler: runCronCommand },
      { name: "run", description: "Run the cron scheduler until stopped", handler: runCronCommand },
    ],
  },
  { name: "update", description: "Check npm for a newer Bestie version, or install it with --apply", handler: runUpdateCommand },
];

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
          { name: "voice", description: "Alias for shared voice commands", handler: runChannelsCommand },
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
