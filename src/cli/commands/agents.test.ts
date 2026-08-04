import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { writeConfig } from "../../runtime/config.js";
import type { RuntimePaths } from "../../runtime/paths.js";
import { createTestConfig } from "../../test-support/config.js";
import { runAgentsCommand } from "./agents.js";

test("runAgentsCommand hires and lists workforce agents", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const previousExitCode = process.exitCode;
  try {
    process.exitCode = undefined;
    await writeConfig(createTestConfig(), paths);

    await runAgentsCommand({
      paths,
      writeLine: (message) => output.push(message),
      argv: ["node", "bestie", "agents", "hire", "--id", "researcher", "--name", "Mika", "--role", "Research Assistant", "--description", "Research briefs"],
    });
    await runAgentsCommand({ paths, writeLine: (message) => output.push(message), argv: ["node", "bestie", "agents", "list"] });

    assert.equal(process.exitCode, undefined);
    assert.ok(output.some((line) => line.includes("Hired Mika")));
    assert.ok(output.some((line) => line.includes("researcher")));
    assert.ok(output.some((line) => line.includes("Research Assistant")));
  } finally {
    process.exitCode = previousExitCode;
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentsCommand assigns and updates workforce tasks", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const previousExitCode = process.exitCode;
  try {
    process.exitCode = undefined;
    await writeConfig(createTestConfig(), paths);
    await runAgentsCommand({
      paths,
      writeLine: (message) => output.push(message),
      argv: ["node", "bestie", "agents", "hire", "--id", "researcher", "--name", "Mika", "--role", "Research Assistant", "--description", "Research briefs"],
    });
    await runAgentsCommand({
      paths,
      writeLine: (message) => output.push(message),
      argv: ["node", "bestie", "agents", "assign", "--agent", "researcher", "--title", "Brief", "--brief", "Summarize this week"],
    });
    await runAgentsCommand({ paths, writeLine: (message) => output.push(message), argv: ["node", "bestie", "agents", "tasks", "--agent", "researcher"] });

    const assignedLine = output.find((line) => line.includes("Assigned task"));
    const taskId = assignedLine?.match(/task-[a-zA-Z0-9-]+/)?.[0];
    assert.ok(taskId);

    await runAgentsCommand({ paths, writeLine: (message) => output.push(message), argv: ["node", "bestie", "agents", "task-status", taskId, "--status", "done", "--result", "Delivered"] });
    await runAgentsCommand({ paths, writeLine: (message) => output.push(message), argv: ["node", "bestie", "agents", "task", taskId] });

    assert.equal(process.exitCode, undefined);
    assert.ok(output.some((line) => line.includes("Brief")));
    assert.ok(output.some((line) => line.includes("is now done")));
    assert.ok(output.some((line) => line.includes("Delivered")));
  } finally {
    process.exitCode = previousExitCode;
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-agents-command-test-"));
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
