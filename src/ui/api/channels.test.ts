import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { bindWorkforceAgentChannel, hireWorkforceAgent, updateWorkforceAgent } from "../../agents/registry.js";
import { loadConfig, writeConfig } from "../../runtime/config.js";
import type { RuntimePaths } from "../../runtime/paths.js";
import { createTestConfig } from "../../test-support/config.js";
import { getUiChannelConfigSummary, runUiChannelAction, updateUiChannelConfig } from "./channels.js";

test("runUiChannelAction updates owner and admin IDs", async () => {
  const paths = await createTempPaths();
  try {
    await writeConfig(createChannelConfig(), paths);
    const result = await runUiChannelAction({ action: "update_access", channel: "telegram", ownerUserIds: ["owner-1", "owner-2"], adminUserIds: ["admin-1"], confirm: true, paths });
    assert.deepEqual(result.channels.find((channel) => channel.id === "telegram")?.ownerUserIds, ["owner-1", "owner-2"]);
    assert.deepEqual(result.channels.find((channel) => channel.id === "telegram")?.adminUserIds, ["admin-1"]);
    const config = await loadConfig(paths);
    assert.deepEqual(config.channels?.telegram?.ownerUserId, ["owner-1", "owner-2"]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("public channel access requires an enabled public bound agent", async () => {
  const paths = await createTempPaths();
  try {
    await writeConfig(createChannelConfig(), paths);
    await assert.rejects(() => runUiChannelAction({ action: "update_access", channel: "telegram", ownerUserIds: ["*"], confirm: true, paths }), /requires a bound workforce agent/);

    await hireWorkforceAgent(paths, { id: "support", displayName: "Support", role: "Customer Support", description: "Help customers safely." });
    await updateWorkforceAgent(paths, "support", {
      displayName: "Support",
      role: "Customer Support",
      description: "Help customers safely.",
      public: { enabled: true, customerMemory: "isolated", customerMemoryWrite: "pending", knowledgeAccess: "agent-only", toolPolicy: "deny" },
    });
    await bindWorkforceAgentChannel(paths, "support", "telegram");

    const result = await runUiChannelAction({ action: "update_access", channel: "telegram", ownerUserIds: ["*"], confirm: true, paths });
    assert.deepEqual(result.channels.find((channel) => channel.id === "telegram")?.ownerUserIds, ["*"]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("channel config update merges attachment settings and redacts secrets", async () => {
  const paths = await createTempPaths();
  try {
    await writeConfig(createTestConfig({ channels: {
      telegram: {
        enabled: false,
        botTokenEnv: "TELEGRAM_BOT_TOKEN",
        ownerUserId: "owner",
        attachments: { downloadPolicy: "allow", maxBytes: 1_024, allowedMimeTypes: ["image/png"] },
      },
    } }), paths);

    const result = await updateUiChannelConfig({
      channel: "telegram",
      config: { ownerUserId: ["owner", "admin"], attachments: { visionPolicy: "deny" } },
      confirm: true,
      paths,
    });
    const channel = result.channels.find((item) => item.id === "telegram");
    assert.deepEqual(channel?.ownerUserIds, ["owner", "admin"]);
    assert.deepEqual(channel?.attachments, { downloadPolicy: "allow", maxBytes: 1_024, allowedMimeTypes: ["image/png"], visionPolicy: "deny" });
    assert.equal("botToken" in (channel ?? {}), false);

    const config = await loadConfig(paths);
    assert.equal(config.channels?.telegram?.botTokenEnv, "TELEGRAM_BOT_TOKEN");
    assert.equal(config.channels?.telegram?.attachments?.maxBytes, 1_024);
    assert.equal(config.channels?.telegram?.attachments?.visionPolicy, "deny");
    assert.equal((await getUiChannelConfigSummary(paths)).channels.find((item) => item.id === "telegram")?.credentialEnv, "TELEGRAM_BOT_TOKEN");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

function createChannelConfig() {
  return createTestConfig({ channels: { telegram: { enabled: false, botTokenEnv: "TELEGRAM_BOT_TOKEN", ownerUserId: "owner" } } });
}

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-ui-channels-test-"));
  const appDir = resolve(rootDir, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");
  await mkdir(appDir, { recursive: true });
  return {
    rootDir,
    appDir,
    configPath: resolve(appDir, "config.json"),
    envPath: resolve(appDir, ".env"),
    characterPath: resolve(appDir, "character.json"),
    systemPromptPath: resolve(appDir, "system-prompt.md"),
    logsDir,
    appLogPath: resolve(logsDir, "app.log"),
    dataDir,
    memoryDbPath: resolve(dataDir, "memory.sqlite"),
    workspaceDir: resolve(appDir, "workspace"),
  };
}
