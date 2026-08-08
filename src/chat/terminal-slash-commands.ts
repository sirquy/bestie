export interface TerminalSlashCommand {
  command: string;
  description: string;
}

export const terminalSlashCommands: TerminalSlashCommand[] = [
  { command: "/help", description: "Show available commands" },
  { command: "/status", description: "Show memory and provider health" },
  { command: "/providers", description: "Show provider fallback diagnostics" },
  { command: "/memory", description: "List saved memories" },
  { command: "/memory pause", description: "Pause memory reads and writes" },
  { command: "/memory resume", description: "Resume memory reads and writes" },
  { command: "/pending", description: "Show pending memory approvals" },
  { command: "/exit", description: "End this chat session" },
];

export function getTerminalSlashSuggestions(value: string, limit = 6): TerminalSlashCommand[] {
  const query = value.trimStart().toLowerCase();
  if (!query.startsWith("/")) {
    return [];
  }

  return terminalSlashCommands
    .filter((command) => command.command.startsWith(query) || command.command.includes(query))
    .slice(0, limit);
}

export function completeTerminalSlashCommand(value: string, command: TerminalSlashCommand): string {
  const needsTrailingSpace = command.command.startsWith("/memory ");
  return needsTrailingSpace ? `${command.command} ` : command.command;
}
