import assert from "node:assert/strict";
import test from "node:test";

import { CHANNELS, TELEGRAM_CHANNEL, formatChannelHelpCommands } from "./registry.js";

test("Telegram channel descriptor exposes native commands and capabilities", () => {
  assert.equal(CHANNELS[0], TELEGRAM_CHANNEL);
  assert.equal(TELEGRAM_CHANNEL.id, "telegram");
  assert.equal(TELEGRAM_CHANNEL.capabilities.polling, true);
  assert.equal(TELEGRAM_CHANNEL.capabilities.toolActivity, true);
  assert.deepEqual(
    TELEGRAM_CHANNEL.commands.filter((command) => command.native).map((command) => command.command),
    ["start", "help", "status", "providers", "doctor", "memory", "approvals"],
  );
});

test("formatChannelHelpCommands includes aliases without registering them natively", () => {
  const help = formatChannelHelpCommands(TELEGRAM_CHANNEL);

  assert.match(help, /\/memory pending/);
  assert.match(help, /\/memory resume/);
  assert.match(help, /\/approve/);
  assert.doesNotMatch(
    TELEGRAM_CHANNEL.commands.filter((command) => command.native).map((command) => command.command).join(","),
    /approve|deny/,
  );
});