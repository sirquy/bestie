import { stdin as input, stdout as output } from "node:process";

import { bold, color, dim } from "../cli/ui.js";
import { completeTerminalSlashCommand, getTerminalSlashSuggestions, type TerminalSlashCommand } from "./terminal-slash-commands.js";

export interface TerminalChatInputOptions {
  askFallback: (question: string) => Promise<string | undefined>;
}

const DEFAULT_TERMINAL_COLUMNS = 80;

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
    let renderedRowCount = 1;

    const render = () => {
      const suggestions = getTerminalSlashSuggestions(value);
      selectedIndex = suggestions.length === 0 ? 0 : Math.min(selectedIndex, suggestions.length - 1);
      output.write(renderPromptFrame(question, value, suggestions, selectedIndex, renderedRowCount));
      renderedRowCount = getPromptFrameRowCount(question, value, suggestions, output.columns);
    };

    const finish = (answer: string | undefined) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      clearPromptFrame(renderedRowCount);
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
        value = removeLastGrapheme(value);
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

export function renderPromptFrame(question: string, value: string, suggestions: TerminalSlashCommand[], selectedIndex: number, previousRowCount = 1): string {
  const clear = previousRowCount > 1 ? `\x1b[${previousRowCount - 1}A` : "";
  const suggestionLines = suggestions.map((suggestion, index) => renderSuggestion(suggestion, index === selectedIndex));
  return `${clear}\r\x1b[J${question}${value}${suggestionLines.length > 0 ? `\n${suggestionLines.join("\n")}` : ""}`;
}

function renderSuggestion(suggestion: TerminalSlashCommand, selected: boolean): string {
  const marker = selected ? color("cyan", ">") : dim(" ");
  const command = selected ? bold(color("cyan", suggestion.command)) : color("gray", suggestion.command);
  return `  ${marker} ${command}  ${dim(suggestion.description)}`;
}

function clearPromptFrame(rowCount: number): void {
  const moveToPrompt = rowCount > 1 ? `\x1b[${rowCount - 1}A` : "";
  output.write(`${moveToPrompt}\r\x1b[J`);
}

export function getPromptFrameRowCount(question: string, value: string, suggestions: TerminalSlashCommand[], columns = DEFAULT_TERMINAL_COLUMNS): number {
  const safeColumns = columns > 0 ? columns : DEFAULT_TERMINAL_COLUMNS;
  return countDisplayRows(`${question}${value}`, safeColumns) + suggestions.length;
}

export function removeLastGrapheme(value: string): string {
  if (!value) return value;

  const Segmenter = Intl.Segmenter;
  if (Segmenter) {
    const segments = [...new Segmenter().segment(value)];
    return segments.slice(0, -1).map((segment) => segment.segment).join("");
  }

  return Array.from(value).slice(0, -1).join("");
}

function countDisplayRows(value: string, columns: number): number {
  return value.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(getDisplayWidth(line) / columns)), 0);
}

function getDisplayWidth(value: string): number {
  return [...value].reduce((width, character) => width + (isWideCharacter(character) ? 2 : 1), 0);
}

function isWideCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f || codePoint === 0x2329 || codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  );
}
