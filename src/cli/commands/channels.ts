import { runTelegramCommand } from "./telegram.js";
import { runZaloCommand } from "./zalo.js";

type ChannelHandler = (argv?: string[]) => Promise<void> | void;

const channelHandlers: Record<string, ChannelHandler> = {
  telegram: runTelegramCommand,
  zalo: runZaloCommand,
};

const helpText = `Bestie channels

Usage:
  bestie channels <channel> [options]

Channels:
  telegram  Start the local Telegram polling bot
  zalo      Start the local Zalo polling bot

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
  --transcript <path>  Write a redacted JSONL smoke transcript for Zalo polling
  --capture-shape  Include redacted getUpdates result structure in the transcript
`;

export async function runChannelsCommand(argv: string[] = process.argv): Promise<void> {
  const channelName = argv[3];

  if (!channelName || channelName === "--help" || channelName === "-h") {
    console.log(helpText);
    return;
  }

  const handler = channelHandlers[channelName];

  if (!handler) {
    console.error(`Unknown channel: ${channelName}`);
    console.error("Available channels: telegram, zalo");
    console.error("Run `bestie channels --help` to see available channels.");
    process.exitCode = 1;
    return;
  }

  await handler(argv);
}
