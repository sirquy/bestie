import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { writeConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { createTestConfig } from "../test-support/config.js";
import { assignWorkforceTask, listWorkforceTasks } from "./inbox.js";
import { runQueuedWorkforceTasks, watchQueuedWorkforceTasks } from "./executor.js";
import { hireWorkforceAgent, setWorkforceAgentEnabled } from "./registry.js";

test("runQueuedWorkforceTasks executes queued tasks with agent prompt", async () => {
  const paths = await createTempPaths();
  try {
    const config = createTestConfig();
    await writeConfig(config, paths);
    await hireWorkforceAgent(paths, { id: "researcher", displayName: "Mika", role: "Research Assistant", description: "Research briefs." });
    const queued = await assignWorkforceTask(paths, { agentId: "researcher", title: "Brief", brief: "Summarize the docs." });
    const seenMessages: string[] = [];

    const results = await runQueuedWorkforceTasks({
      config,
      paths,
      apiKey: "test-key",
      chatCompletion: async (_config, _apiKey, options) => {
        seenMessages.push(options.messages.map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content)).join("\n"));
        return "Docs summarized.";
      },
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.task.id, queued.id);
    assert.equal(results[0]?.status, "done");
    assert.match(seenMessages.join("\n"), /Research Assistant/);
    assert.match(seenMessages.join("\n"), /Summarize the docs/);
    assert.equal((await listWorkforceTasks(paths, { status: "done" }))[0]?.result, "Docs summarized.");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runQueuedWorkforceTasks blocks tasks for paused agents", async () => {
  const paths = await createTempPaths();
  try {
    const config = createTestConfig();
    await writeConfig(config, paths);
    await hireWorkforceAgent(paths, { id: "ops", displayName: "Omi", role: "Ops", description: "Ops follow-up." });
    await assignWorkforceTask(paths, { agentId: "ops", brief: "Check reminders." });
    await setWorkforceAgentEnabled(paths, "ops", false);

    const results = await runQueuedWorkforceTasks({ config, paths, apiKey: "test-key", chatCompletion: async () => "unused" });

    assert.equal(results[0]?.status, "blocked");
    assert.match(results[0]?.error ?? "", /paused/);
    assert.equal((await listWorkforceTasks(paths, { status: "blocked" })).length, 1);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runQueuedWorkforceTasks enforces agent tool allowlist", async () => {
  const paths = await createTempPaths();
  try {
    const config = createTestConfig();
    await writeConfig(config, paths);
    await hireWorkforceAgent(paths, { id: "researcher", displayName: "Mika", role: "Research Assistant", description: "Research briefs.", tools: ["internal.read_file"] });
    await assignWorkforceTask(paths, { agentId: "researcher", brief: "Check git status." });
    let toolRunnerCalls = 0;
    let completionCalls = 0;

    const results = await runQueuedWorkforceTasks({
      config,
      paths,
      apiKey: "test-key",
      chatCompletion: async () => {
        completionCalls += 1;
        return completionCalls === 1 ? '{"tool":"internal.git_status","arguments":{}}' : '{"answer":"Cannot use git_status with this agent scope."}';
      },
      toolRunner: async () => {
        toolRunnerCalls += 1;
        return { ok: true, status: "pass", message: "should not run" };
      },
    });

    assert.equal(toolRunnerCalls, 0);
    assert.equal(results[0]?.status, "done");
    assert.equal((await listWorkforceTasks(paths, { status: "done" }))[0]?.result, "Cannot use git_status with this agent scope.");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("watchQueuedWorkforceTasks runs batches until stopped", async () => {
  const paths = await createTempPaths();
  try {
    const config = createTestConfig();
    await writeConfig(config, paths);
    await hireWorkforceAgent(paths, { id: "researcher", displayName: "Mika", role: "Research Assistant", description: "Research briefs." });
    await assignWorkforceTask(paths, { agentId: "researcher", brief: "Summarize the queue." });
    let stop = false;
    let batchCount = 0;

    await watchQueuedWorkforceTasks({
      config,
      paths,
      apiKey: "test-key",
      intervalMs: 1_000,
      shouldStop: () => stop,
      onBatch: () => {
        batchCount += 1;
        stop = true;
      },
      chatCompletion: async () => "Queue summarized.",
    });

    assert.equal(batchCount, 1);
    assert.equal((await listWorkforceTasks(paths, { status: "done" }))[0]?.result, "Queue summarized.");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-agent-executor-test-"));
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
