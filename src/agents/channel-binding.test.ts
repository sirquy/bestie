import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { createTestConfig } from "../test-support/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { evaluateActionPermission } from "../safety/permission-policy.js";
import { buildChannelAgentToolRunner, resolveChannelAgentRuntime } from "./channel-binding.js";

test("resolves the bound agent with model override, prompt, policy, and isolated conversation key", async () => {
  const paths = await createTempPaths();
  try {
    const promptPath = resolve(paths.appDir, "agents", "researcher", "system-prompt.md");
    await mkdir(resolve(paths.appDir, "agents", "researcher"), { recursive: true });
    await writeFile(promptPath, "You are the research specialist.");
    const config = createTestConfig({
      agents: {
        researcher: {
          enabled: true,
          displayName: "Mika",
          role: "Research",
          description: "Research assistant.",
          promptPath,
          model: "openai/research-model",
          tools: ["internal.read_file"],
          channels: ["telegram"],
          memoryScope: "agent:researcher",
          approvalPolicy: "deny-external-actions",
        },
      },
    });

    const runtime = await resolveChannelAgentRuntime(config, paths, "telegram", "owner-1");
    assert.equal(runtime?.agent.id, "researcher");
    assert.equal(runtime?.config.llm.primary, "openai/research-model");
    assert.equal(runtime?.conversationUserId, "agent:researcher:user:owner-1");
    assert.match(runtime?.systemPrompt ?? "", /research specialist/);
    assert.equal(evaluateActionPermission({ category: "external_write", action: "send" }, runtime?.policy).decision, "deny");

    const runner = buildChannelAgentToolRunner(runtime!.agent, async () => ({ ok: true, status: "pass", message: "ok" }));
    const rejected = await runner({ request: { tool: "internal.write_file", arguments: {} }, config, paths });
    assert.equal(rejected.ok, false);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("returns undefined for an unbound channel", async () => {
  const paths = await createTempPaths();
  try {
    const config = createTestConfig();
    assert.equal(await resolveChannelAgentRuntime(config, paths, "zalo", "owner-1"), undefined);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-channel-agent-test-"));
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
