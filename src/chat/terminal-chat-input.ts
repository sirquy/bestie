import { stdin as input, stdout as output } from "node:process";

import { bold, color, dim } from "../cli/ui.js";
import { completeTerminalSlashCommand, getTerminalSlashSuggestions, type TerminalSlashCommand } from "./terminal-slash-commands.js";

export interface TerminalChatInputOptions {
  askFallback: (question: string) => Promise<string | undefined>;
}

export function createTerminalChatInput(options: TerminalChatInputOptions): (question: string) => Promise<string | undefined> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    return options.askFallback;
  }

  return (question) => askWithSlashSuggestions(question);
}

function askWithSlashSuggestions(question: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    let value = "";
    let selectedIndex = 0;
    let renderedSuggestionCount = 0;

    const render = () => {
      const suggestions = getTerminalSlashSuggestions(value);
      selectedIndex = suggestions.length === 0 ? 0 : Math.min(selectedIndex, suggestions.length - 1);
      output.write(renderPromptFrame(question, value, suggestions, selectedIndex, renderedSuggestionCount));
      renderedSuggestionCount = suggestions.length;
    };

    const finish = (answer: string | undefined) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      clearPromptFrame(renderedSuggestionCount);
      output.write(`${question}${answer ?? ""}\n`);
      resolve(answer);
    };

    const onData = (chunk: Buffer) => {
      const key = chunk.toString("utf8");
      const suggestions = getTerminalSlashSuggestions(value);

      if (key === "\u0003") {
        finish(undefined);
        return;
      }
      if (key === "\r" || key === "\n") {
        finish(value);
        return;
      }
      if (key === "\u007f" || key === "\b") {
        value = value.slice(0, -1);
        selectedIndex = 0;
        render();
        return;
      }
      if (key === "\u001b[A") {
        if (suggestions.length > 0) {
          selectedIndex = (selectedIndex - 1 + suggestions.length) % suggestions.length;
          render();
        }
        return;
      }
      if (key === "\u001b[B") {
        if (suggestions.length > 0) {
          selectedIndex = (selectedIndex + 1) % suggestions.length;
          render();
        }
        return;
      }
      if (key === "\t") {
        const selected = suggestions[selectedIndex];
        if (selected) {
          value = completeTerminalSlashCommand(value, selected);
          selectedIndex = 0;
          render();
        }
        return;
      }
      if (!key.startsWith("\u001b")) {
        value += key;
        selectedIndex = 0;
        render();
      }
    };

    input.resume();
    input.setRawMode(true);
    input.on("data", onData);
    render();
  });
}

function renderPromptFrame(question: string, value: string, suggestions: TerminalSlashCommand[], selectedIndex: number, previousSuggestionCount: number): string {
  const clear = previousSuggestionCount > 0 ? `\x1b[${previousSuggestionCount}A` : "";
  const suggestionLines = suggestions.map((suggestion, index) => renderSuggestion(suggestion, index === selectedIndex));
  return `${clear}\r\x1b[J${question}${value}${suggestionLines.length > 0 ? `\n${suggestionLines.join("\n")}` : ""}`;
}

function renderSuggestion(suggestion: TerminalSlashCommand, selected: boolean): string {
  const marker = selected ? color("cyan", ">") : dim(" ");
  const command = selected ? bold(color("cyan", suggestion.command)) : color("gray", suggestion.command);
  return `  ${marker} ${command}  ${dim(suggestion.description)}`;
}

function clearPromptFrame(suggestionCount: number): void {
  const moveToPrompt = suggestionCount > 0 ? `\x1b[${suggestionCount}A` : "";
  output.write(`${moveToPrompt}\r\x1b[J`);
}
