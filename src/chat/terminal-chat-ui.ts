import { stdout as output } from "node:process";

import { badge, bold, color, dim, rule, supportsColor } from "../cli/ui.js";

export interface TerminalChatPresentation {
  agentName: string;
  ownerName: string;
  model: string;
  runtimePath: string;
}

const TERMINAL_HEADER_WIDTH = 68;

export function isInteractiveTerminalChat(): boolean {
  return Boolean(output.isTTY && supportsColor());
}

export function renderTerminalChatHeader(presentation: TerminalChatPresentation): string[] {
  if (!isInteractiveTerminalChat()) {
    return [
      bold(color("magenta", "Bestie chat")) + " " + dim("local terminal session"),
      dim("Runtime") + " " + presentation.runtimePath,
      dim("Model") + " " + presentation.model,
      badge("BOT", "cyan") + " " + bold(presentation.agentName) + " " + dim("with") + " " + badge("YOU", "green") + " " + bold(presentation.ownerName),
      dim("Commands") + " /help  /status  /providers  /memory  /pending  /exit",
      rule(28),
    ];
  }

  return [
    "",
    color("magenta", `+${"-".repeat(TERMINAL_HEADER_WIDTH)}+`),
    formatHeaderLine("  BESTIE  Your private local AI companion"),
    formatHeaderLine(`  [ONLINE] ${presentation.agentName} for ${presentation.ownerName} | ${presentation.model}`),
    formatHeaderLine("  Type / for commands; arrows navigate, Tab completes, Enter runs"),
    color("magenta", `+${"-".repeat(TERMINAL_HEADER_WIDTH)}+`),
    "",
  ];
}

export function formatHeaderLine(value: string, width = TERMINAL_HEADER_WIDTH): string {
  const content = truncateTerminalText(value, width);
  return color("magenta", "|") + content.padEnd(width) + color("magenta", "|");
}

export function truncateTerminalText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return ".".repeat(maxLength);
  return `${value.slice(0, maxLength - 3)}...`;
}

export function formatTerminalPrompt(ownerName?: string): string {
  const label = ownerName || "you";
  if (!isInteractiveTerminalChat()) {
    return badge("YOU", "green") + " " + label + " " + dim("> ");
  }

  const newline = String.fromCharCode(10);
  return newline + color("green", "+-") + " " + bold(color("green", label)) + " " + dim("say what you mean") + newline + color("green", "-> ");
}

export function formatTerminalAssistantStart(agentName?: string): string {
  const label = agentName || "bestie";
  if (!isInteractiveTerminalChat()) {
    return badge("BOT", "cyan") + " " + label + " " + dim("> ");
  }

  const newline = String.fromCharCode(10);
  return newline + color("cyan", "+-") + " " + bold(color("cyan", label)) + " " + dim("is here") + newline + color("cyan", "-> ");
}

export function formatTerminalAssistantMessage(agentName: string | undefined, message: string): string {
  return formatTerminalAssistantStart(agentName) + message;
}

export function formatTerminalError(message: string): string {
  if (!isInteractiveTerminalChat()) {
    return badge("FAIL", "red") + " " + message;
  }

  const newline = String.fromCharCode(10);
  return newline + color("red", "+- ! Something needs attention") + newline + color("red", "->") + " " + message;
}

export function formatTerminalToolActivity(agentName: string | undefined, toolName: string, label: string): string {
  if (!isInteractiveTerminalChat()) {
    return formatTerminalAssistantMessage(agentName, badge("TOOL", "yellow") + " " + toolName + " " + dim(label));
  }

  return String.fromCharCode(10) + color("yellow", "+-") + " " + badge("TOOL", "yellow") + " " + bold(toolName) + " " + dim(label);
}

export function formatTerminalThinking(agentName?: string, frame = ""): string {
  const label = agentName || "bestie";
  return color("cyan", "o") + " " + bold(label) + " " + dim("is thinking") + color("cyan", frame);
}

export function formatTerminalGoodbye(): string {
  return isInteractiveTerminalChat() ? String.fromCharCode(10) + color("magenta", "*") + " " + bold("Bestie signed off.") + " " + dim("Take care of yourself, menace.") : "Bye.";
}
