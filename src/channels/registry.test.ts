import assert from "node:assert/strict";
import test from "node:test";

import { CHANNELS, TELEGRAM_CHANNEL, ZALO_CHANNEL, formatChannelHelpCommands } from "./registry.js";

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
  assert.match(help, /\/memory rebalance dry-run/);
  assert.match(help, /\/memory resume/);
  assert.match(help, /\/approve/);
  assert.doesNotMatch(
    TELEGRAM_CHANNEL.commands.filter((command) => command.native).map((command) => command.command).join(","),
    /approve|deny/,
  );
});

test("Zalo channel descriptor starts as text polling only", () => {
  assert.deepEqual(CHANNELS.map((channel) => channel.id), ["telegram", "zalo"]);
  assert.equal(ZALO_CHANNEL.id, "zalo");
  assert.equal(ZALO_CHANNEL.capabilities.polling, true);
  assert.equal(ZALO_CHANNEL.capabilities.attachments, false);
  assert.equal(ZALO_CHANNEL.capabilities.voiceReply, false);
  assert.equal(ZALO_CHANNEL.capabilities.toolActivity, true);
  assert.deepEqual(
    ZALO_CHANNEL.commands.filter((command) => command.native).map((command) => command.command),
    ["help", "status", "providers", "memory", "approvals"],
  );
});