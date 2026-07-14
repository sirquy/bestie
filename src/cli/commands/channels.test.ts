import assert from "node:assert/strict";
import test from "node:test";

import { runChannelsCommand } from "./channels.js";

test("runChannelsCommand prints channels help", async () => {
  const lines: string[] = [];
  const originalLog = console.log;

  try {
    console.log = (message?: unknown) => {
      lines.push(String(message ?? ""));
    };

    await runChannelsCommand(["node", "bestie", "channels", "--help"]);

    assert.match(lines.join("\n"), /bestie channels <channel>/);
    assert.match(lines.join("\n"), /telegram/);
    assert.match(lines.join("\n"), /zalo/);
  } finally {
    console.log = originalLog;
  }
});

test("runChannelsCommand rejects unknown channels", async () => {
  const lines: string[] = [];
  const originalError = console.error;
  const originalExitCode = process.exitCode;

  try {
    process.exitCode = undefined;
    console.error = (message?: unknown) => {
      lines.push(String(message ?? ""));
    };

    await runChannelsCommand(["node", "bestie", "channels", "unknown"]);

    assert.equal(process.exitCode, 1);
    assert.match(lines.join("\n"), /Unknown channel: unknown/);
    assert.match(lines.join("\n"), /Available channels: telegram, zalo/);
  } finally {
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
});
