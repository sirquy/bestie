import assert from "node:assert/strict";
import test from "node:test";

import { completeTerminalSlashCommand, getTerminalSlashSuggestions, terminalSlashCommands } from "./terminal-slash-commands.js";

test("terminal slash commands expose every supported chat command", () => {
  assert.deepEqual(terminalSlashCommands.map((command) => command.command), [
    "/help",
    "/status",
    "/providers",
    "/memory",
    "/memory pause",
    "/memory resume",
    "/pending",
    "/exit",
  ]);
});

test("terminal slash command suggestions filter incrementally", () => {
  assert.deepEqual(getTerminalSlashSuggestions("/memory").map((command) => command.command), [
    "/memory",
    "/memory pause",
    "/memory resume",
  ]);
  assert.deepEqual(getTerminalSlashSuggestions("/pro").map((command) => command.command), ["/providers"]);
  assert.deepEqual(getTerminalSlashSuggestions("hello"), []);
});

test("terminal slash command completion preserves argument entry", () => {
  const memoryPause = terminalSlashCommands.find((command) => command.command === "/memory pause");
  const status = terminalSlashCommands.find((command) => command.command === "/status");

  assert.ok(memoryPause);
  assert.ok(status);
  assert.equal(completeTerminalSlashCommand("/mem", memoryPause), "/memory pause ");
  assert.equal(completeTerminalSlashCommand("/sta", status), "/status");
});
