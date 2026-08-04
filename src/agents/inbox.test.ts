import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { writeConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { createTestConfig } from "../test-support/config.js";
import { hireWorkforceAgent, setWorkforceAgentEnabled } from "./registry.js";
import { assignWorkforceTask, listWorkforceTasks, updateWorkforceTaskStatus, workforceTasksPath } from "./inbox.js";

test("assignWorkforceTask appends queued tasks for active agents", async () => {
  const paths = await createTempPaths();
  try {
    await writeConfig(createTestConfig(), paths);
    await hireWorkforceAgent(paths, { id: "researcher", displayName: "Mika", role: "Researcher", description: "Research briefs." });

    const task = await assignWorkforceTask(paths, { agentId: "researcher", title: "Weekly brief", brief: "Summarize market signals.", createdBy: "bestie" });

    assert.equal(task.agentId, "researcher");
    assert.equal(task.status, "queued");
    assert.equal(task.createdBy, "bestie");
    assert.equal((await listWorkforceTasks(paths, { agentId: "researcher" }))[0]?.id, task.id);
    assert.match(await readFile(workforceTasksPath(paths), "utf8"), /Weekly brief/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("workforce tasks can be filtered and marked done", async () => {
  const paths = await createTempPaths();
  try {
    await writeConfig(createTestConfig(), paths);
    await hireWorkforceAgent(paths, { id: "coder", displayName: "Codey", role: "Coder", description: "Code changes." });
    const task = await assignWorkforceTask(paths, { agentId: "coder", brief: "Refactor the provider page." });

    assert.equal((await listWorkforceTasks(paths, { status: "queued" })).length, 1);
    const updated = await updateWorkforceTaskStatus(paths, task.id, "done", "Refactor complete.");

    assert.equal(updated.status, "done");
    assert.equal(updated.result, "Refactor complete.");
    assert.equal((await listWorkforceTasks(paths, { status: "queued" })).length, 0);
    assert.equal((await listWorkforceTasks(paths, { status: "done" }))[0]?.id, task.id);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("assignWorkforceTask rejects paused agents", async () => {
  const paths = await createTempPaths();
  try {
    await writeConfig(createTestConfig(), paths);
    await hireWorkforceAgent(paths, { id: "ops", displayName: "Omi", role: "Ops", description: "Ops follow-up." });
    await setWorkforceAgentEnabled(paths, "ops", false);

    await assert.rejects(() => assignWorkforceTask(paths, { agentId: "ops", brief: "Check reminders." }), /paused/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-agent-inbox-test-"));
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
