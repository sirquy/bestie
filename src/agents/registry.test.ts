import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { createTestConfig } from "../test-support/config.js";
import { loadConfig, writeConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { bindWorkforceAgentChannel, getWorkforceAgent, hireWorkforceAgent, listWorkforceAgents, removeWorkforceAgent, setWorkforceAgentEnabled, unbindWorkforceAgentChannel, updateWorkforceAgent } from "./registry.js";

test("hireWorkforceAgent creates a fixed role agent profile and prompt", async () => {
  const paths = await createTempPaths();
  try {
    await writeConfig(createTestConfig(), paths);

    const agent = await hireWorkforceAgent(paths, {
      id: "Researcher",
      displayName: "Mika",
      role: "Research Assistant",
      description: "Research and summarize information.",
      model: "openai/test-model",
      tools: ["internal.read_file", "internal.read_file"],
    });

    assert.equal(agent.id, "researcher");
    assert.equal(agent.enabled, true);
    assert.equal(agent.memoryScope, "agent:researcher");
    assert.deepEqual(agent.tools, ["internal.read_file"]);
    assert.match(await readFile(agent.promptPath, "utf8"), /Research Assistant/);
    assert.deepEqual((await loadConfig(paths)).agents?.researcher, {
      enabled: true,
      displayName: "Mika",
      role: "Research Assistant",
      description: "Research and summarize information.",
      promptPath: agent.promptPath,
      model: "openai/test-model",
      tools: ["internal.read_file"],
      memoryScope: "agent:researcher",
      approvalPolicy: "ask-for-external-actions",
    });
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("hireWorkforceAgent rejects a model that is not a provider/model reference", async () => {
  const paths = await createTempPaths();
  try {
    await writeConfig(createTestConfig(), paths);

    await assert.rejects(
      () => hireWorkforceAgent(paths, { id: "customer-success", displayName: "Cami", role: "Customer Success", description: "Support customers.", model: "openai:gpt-4.1-mini" }),
      /model must use provider\/model format/,
    );
    assert.equal((await loadConfig(paths)).agents?.["customer-success"], undefined);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("workforce registry lists, pauses, resumes, and removes agents", async () => {
  const paths = await createTempPaths();
  try {
    await writeConfig(createTestConfig(), paths);
    await hireWorkforceAgent(paths, { id: "coder", displayName: "Codey", role: "Coder", description: "Implement code changes." });

    assert.equal((await listWorkforceAgents(paths))[0]?.id, "coder");
    assert.equal((await setWorkforceAgentEnabled(paths, "coder", false)).enabled, false);
    assert.equal((await getWorkforceAgent(paths, "coder"))?.enabled, false);
    assert.equal((await setWorkforceAgentEnabled(paths, "coder", true)).enabled, true);
    assert.equal((await removeWorkforceAgent(paths, "coder")).id, "coder");
    assert.deepEqual(await listWorkforceAgents(paths), []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("updateWorkforceAgent edits profile without replacing stable runtime fields", async () => {
  const paths = await createTempPaths();
  try {
    await writeConfig(createTestConfig(), paths);
    const hired = await hireWorkforceAgent(paths, { id: "ops", displayName: "Omi", role: "Ops", description: "Ops follow-up.", model: "openai/old", tools: ["internal.read_file"] });

    const updated = await updateWorkforceAgent(paths, "ops", { displayName: "Omi 2", role: "Ops Lead", description: "Own ops follow-up.", model: "", tools: ["internal.git_status"], approvalPolicy: "ask-for-all-actions" });

    assert.equal(updated.displayName, "Omi 2");
    assert.equal(updated.role, "Ops Lead");
    assert.equal(updated.model, undefined);
    assert.deepEqual(updated.tools, ["internal.git_status"]);
    assert.equal(updated.promptPath, hired.promptPath);
    assert.equal(updated.memoryScope, "agent:ops");
    assert.equal((await loadConfig(paths)).agents?.ops?.approvalPolicy, "ask-for-all-actions");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("channel binding moves a channel to one workforce agent and supports unbinding", async () => {
  const paths = await createTempPaths();
  try {
    await writeConfig(createTestConfig(), paths);
    await hireWorkforceAgent(paths, { id: "researcher", displayName: "Mika", role: "Research", description: "Research." });
    await hireWorkforceAgent(paths, { id: "writer", displayName: "Nia", role: "Writer", description: "Write." });

    await bindWorkforceAgentChannel(paths, "researcher", "telegram");
    const writer = await bindWorkforceAgentChannel(paths, "writer", "telegram");
    assert.deepEqual(writer.channels, ["telegram"]);
    assert.equal((await getWorkforceAgent(paths, "researcher"))?.channels, undefined);
    assert.deepEqual((await unbindWorkforceAgentChannel(paths, "writer", "telegram")).channels, undefined);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-agents-test-"));
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
