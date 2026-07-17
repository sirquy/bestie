export interface ChannelCommandDescriptor {
  command: string;
  description: string;
  aliases?: string[];
  native?: boolean;
}

export interface ChannelDescriptor {
  id: string;
  displayName: string;
  configKey: string;
  capabilities: {
    polling: boolean;
    attachments: boolean;
    voiceInput: boolean;
    voiceReply: boolean;
    toolActivity: boolean;
    approvals: boolean;
  };
  commands: ChannelCommandDescriptor[];
}

export const TELEGRAM_CHANNEL: ChannelDescriptor = {
  id: "telegram",
  displayName: "Telegram",
  configKey: "telegram",
  capabilities: {
    polling: true,
    attachments: true,
    voiceInput: true,
    voiceReply: true,
    toolActivity: true,
    approvals: true,
  },
  commands: [
    { command: "start", description: "Check that Bestie is online", native: true },
    { command: "help", description: "Show supported commands", native: true },
    { command: "status", description: "Show local bot and memory status", native: true },
    { command: "providers", description: "Show recent provider fallback diagnostics", native: true },
    { command: "doctor", description: "Run local diagnostics summary", native: true },
    { command: "memory", description: "Show or control local memory", aliases: ["memory list", "memory tiers", "memory rebalance dry-run", "memory scope core", "memory inspect <id>", "memory move <id> project", "memory supersede <oldId> <newId>", "memory analyze", "memory hygiene", "memory hygiene status", "memory hygiene trend", "memory hygiene doctor", "memory hygiene apply", "memory hygiene apply confirm", "memory cleanup dry-run", "memory governance status", "memory governance policy governed", "memory pin <id>", "memory unpin <id>", "memory maintenance status", "memory maintenance install", "memory maintenance remove", "memory pending", "memory pause", "memory resume"], native: true },
    { command: "approvals", description: "Show pending action approvals", native: true },
    { command: "approve", description: "Approve a pending request" },
    { command: "deny", description: "Deny a pending request" },
  ],
};

export const ZALO_CHANNEL: ChannelDescriptor = {
  id: "zalo",
  displayName: "Zalo",
  configKey: "zalo",
  capabilities: {
    polling: true,
    attachments: false,
    voiceInput: false,
    voiceReply: false,
    toolActivity: true,
    approvals: true,
  },
  commands: [
    { command: "help", description: "Show supported commands", native: true },
    { command: "status", description: "Show local bot and memory status", native: true },
    { command: "providers", description: "Show recent provider fallback diagnostics", native: true },
    { command: "memory", description: "Show or control local memory", aliases: ["memory list", "memory tiers", "memory rebalance dry-run", "memory scope core", "memory inspect <id>", "memory move <id> project", "memory supersede <oldId> <newId>", "memory analyze", "memory hygiene", "memory hygiene status", "memory hygiene trend", "memory hygiene doctor", "memory hygiene apply", "memory hygiene apply confirm", "memory cleanup dry-run", "memory governance status", "memory governance policy governed", "memory pin <id>", "memory unpin <id>", "memory maintenance status", "memory maintenance install", "memory maintenance remove", "memory pending", "memory pause", "memory resume"], native: true },
    { command: "approvals", description: "Show pending action approvals", native: true },
    { command: "approve", description: "Approve a pending request" },
    { command: "deny", description: "Deny a pending request" },
  ],
};

export const CHANNELS = [TELEGRAM_CHANNEL, ZALO_CHANNEL] as const;

export function formatChannelHelpCommands(channel: ChannelDescriptor): string {
  const commands = channel.commands.flatMap((entry) => [entry.command, ...(entry.aliases ?? [])]);
  return `Commands: ${commands.map((command) => `/${command}`).join(", ")}`;
}