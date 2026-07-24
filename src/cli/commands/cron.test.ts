import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { SqliteMemoryStore } from "../../memory/sqlite-store.js";
import { writeConfig, type AppConfig } from "../../runtime/config.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { runCronCommand } from "./cron.js";

const TEST_CONFIG: AppConfig = {
  version: 2,
  agent: { name: "Bestie", ownerName: "Owner", language: "vi", timeZone: "Asia/Bangkok", toneIntensity: 7 },
  llm: {
    primary: "openai/test-model",
    authProfile: "openai:api-key",
    profiles: {
      "openai:api-key": {
        provider: "openai-compatible",
        mode: "api-key",
        baseUrl: "http://127.0.0.1:9/v1",
        apiKeyEnv: "BESTIE_TEST_MISSING_OPENAI_API_KEY",
      },
    },
    modelCatalog: {
      "openai/test-model": { profile: "openai:api-key" },
    },
  },
};

test("runCronCommand updates an existing schedule", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(TEST_CONFIG, paths);
    const store = await SqliteMemoryStore.open(paths);
    const schedule = store.addCronSchedule({
      name: "Original",
      scheduleType: "interval",
      scheduleValue: "1h",
      prompt: "Original task",
      channel: "telegram:12345",
      nextRunAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const originalNextRunAt = schedule.nextRunAt;
    store.close();

    await runCronCommand({
      argv: ["node", "bestie", "cron", "update", String(schedule.id), "--name", "Updated", "--prompt", "Updated task", "--channel", "none", "--disable"],
      paths,
      writeLine: (message) => output.push(message),
    });

    const verifyStore = await SqliteMemoryStore.open(paths);
    const updated = verifyStore.getCronSchedule(schedule.id);
    verifyStore.close();

    assert.equal(updated.name, "Updated");
    assert.equal(updated.prompt, "Updated task");
    assert.equal(updated.channel, undefined);
    assert.equal(updated.enabled, false);
    assert.equal(updated.nextRunAt, originalNextRunAt);
    assert.match(output.join("\n"), /Đã cập nhật lịch cron/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runCronCommand triggers a schedule immediately", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(TEST_CONFIG, paths);
    const store = await SqliteMemoryStore.open(paths);
    const schedule = store.addCronSchedule({
      name: "Trigger me",
      scheduleType: "interval",
      scheduleValue: "1h",
      prompt: "Try to run",
      nextRunAt: new Date(Date.now() + 60_000).toISOString(),
    });
    store.close();

    await runCronCommand({ argv: ["node", "bestie", "cron", "trigger", String(schedule.id)], paths, writeLine: (message) => output.push(message) });

    const verifyStore = await SqliteMemoryStore.open(paths);
    const logs = verifyStore.listCronLogs(schedule.id);
    verifyStore.close();

    assert.equal(logs.length, 1);
    assert.equal(logs[0].result, "error");
    assert.match(output.join("\n"), /Đã trigger lịch cron/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-cron-cli-test-"));
  return getRuntimePaths(rootDir);
}
