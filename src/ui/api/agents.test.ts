import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { writeConfig } from "../../runtime/config.js";
import type { RuntimePaths } from "../../runtime/paths.js";
import { createTestConfig } from "../../test-support/config.js";
import { getUiAgentsSummary, runUiAgentsAction } from "./agents.js";

test("getUiAgentsSummary reports workforce agents, tasks, and daemon state", async () => {
  const paths = await createTempPaths();
  try {
    await writeConfig(createTestConfig(), paths);
    await runUiAgentsAction({ action: "hire", id: "researcher", displayName: "Mika", role: "Research Assistant", description: "Research and summarize information.", confirm: true, paths });
    await runUiAgentsAction({ action: "assign", agentId: "researcher", title: "Weekly brief", brief: "Summarize this week.", confirm: true, paths });

    const summary = await getUiAgentsSummary(paths);

    assert.equal(summary.ok, true);
    assert.equal(summary.agents.length, 1);
    assert.equal(summary.agents[0]?.id, "researcher");
    assert.equal(summary.counts.activeAgents, 1);
    assert.equal(summary.counts.queuedTasks, 1);
    assert.equal(summary.tasks[0]?.title, "Weekly brief");
    assert.ok(summary.availableTools.some((tool) => tool.name === "internal.read_file" && tool.category === "Tệp & dữ liệu"));
    assert.ok(summary.availableTools.some((tool) => tool.name === "internal.exec" && tool.risk === "high"));
    assert.equal(summary.daemon.state, "stopped");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runUiAgentsAction manages profiles and task state", async () => {
  const paths = await createTempPaths();
  try {
    await writeConfig(createTestConfig(), paths);
    await assert.rejects(() => runUiAgentsAction({ action: "hire", id: "ops", displayName: "Omi", role: "Ops", description: "Ops follow-up.", confirm: false, paths }), /confirm=true/);

    const hired = await runUiAgentsAction({ action: "hire", id: "ops", displayName: "Omi", role: "Ops", description: "Ops follow-up.", model: "openai/example-model", tools: ["internal.read_file"], confirm: true, paths });
    assert.equal(hired.agents[0]?.displayName, "Omi");
    assert.equal(hired.messages[0], "Đã thuê Omi cho vai trò Ops.");

    const updated = await runUiAgentsAction({ action: "update", id: "ops", displayName: "Omi 2", role: "Ops Lead", description: "Own ops follow-up.", model: "", tools: ["internal.git_status"], approvalPolicy: "deny-external-actions", confirm: true, paths });
    assert.equal(updated.agents[0]?.displayName, "Omi 2");
    assert.equal(updated.agents[0]?.role, "Ops Lead");
    assert.equal(updated.agents[0]?.model, undefined);
    assert.deepEqual(updated.agents[0]?.tools, ["internal.git_status"]);
    assert.equal(updated.agents[0]?.approvalPolicy, "deny-external-actions");

    const assigned = await runUiAgentsAction({ action: "assign", agentId: "ops", brief: "Check reminders.", confirm: true, paths });
    const taskId = assigned.tasks[0]?.id;
    assert.ok(taskId);
    assert.equal(assigned.counts.queuedTasks, 1);

    const done = await runUiAgentsAction({ action: "task_status", id: taskId, status: "done", result: "Reminder check complete.", confirm: true, paths });
    assert.equal(done.counts.doneTasks, 1);
    assert.equal(done.tasks[0]?.result, "Reminder check complete.");

    const paused = await runUiAgentsAction({ action: "pause", id: "ops", confirm: true, paths });
    assert.equal(paused.counts.pausedAgents, 1);
    const resumed = await runUiAgentsAction({ action: "resume", id: "ops", confirm: true, paths });
    assert.equal(resumed.counts.activeAgents, 1);

    const bound = await runUiAgentsAction({ action: "bind_channel", id: "ops", channel: "telegram", confirm: true, paths });
    assert.deepEqual(bound.agents[0]?.channels, ["telegram"]);
    assert.equal(bound.messages[0], "Đã gán Telegram cho Omi 2.");

    const unbound = await runUiAgentsAction({ action: "unbind_channel", id: "ops", channel: "telegram", confirm: true, paths });
    assert.equal(unbound.agents[0]?.channels, undefined);

    const removed = await runUiAgentsAction({ action: "remove", id: "ops", confirm: true, paths });
    assert.equal(removed.agents.length, 0);
    assert.equal(removed.tasks.length, 1);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runUiAgentsAction can drain an empty queue without provider calls", async () => {
  const paths = await createTempPaths();
  try {
    await writeConfig(createTestConfig(), paths);

    const result = await runUiAgentsAction({ action: "run", limit: 5, confirm: true, paths });

    assert.equal(result.action, "run");
    assert.deepEqual(result.runResults, []);
    assert.equal(result.messages[0], "Không có việc nào đang chờ.");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-ui-agents-test-"));
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
