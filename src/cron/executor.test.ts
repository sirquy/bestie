import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { CronExecutor } from "./executor.js";
import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import { getRuntimePaths, type RuntimePaths } from "../runtime/paths.js";

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-cron-exec-test-"));
  const appDir = resolve(rootDir, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");

  return {
    ...getRuntimePaths(rootDir),
    logsDir,
    dataDir,
    memoryDbPath: resolve(dataDir, "memory.sqlite"),
  };
}

const TEST_CONFIG = {
  version: 1 as const,
  agent: { name: "Test", ownerName: "Boss", language: "vi" as const, toneIntensity: 5 },
  llm: { provider: "openai-compatible", baseUrl: "http://localhost:1/v1", model: "test", apiKeyEnv: "OPENAI_API_KEY" },
};

test("CronExecutor starts and stops cleanly", async () => {
  const paths = await createTempPaths();
  try {
    const executor = new CronExecutor({ config: TEST_CONFIG, paths, tickIntervalMs: 100 });
    assert.equal(executor.isRunning(), false);

    executor.start();
    assert.equal(executor.isRunning(), true);

    executor.stop();
    assert.equal(executor.isRunning(), false);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("CronExecutor tick picks up due jobs", async () => {
  const paths = await createTempPaths();
  try {
    const store = await SqliteMemoryStore.open(paths);
    const now = new Date().toISOString();
    // Add a job that is already due (next_run_at is in the past)
    store.addCronSchedule({
      name: "Due job",
      scheduleType: "interval",
      scheduleValue: "1h",
      prompt: "Test prompt",
      nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    });
    store.close();

    const executor = new CronExecutor({ config: TEST_CONFIG, paths, tickIntervalMs: 100 });

    // Run tick manually and let it find the job
    // Since the LLM will fail (no API key), the job should be logged as error
    await executor.tick();

    const verifyStore = await SqliteMemoryStore.open(paths);
    const schedules = verifyStore.listCronSchedules();
    assert.equal(schedules.length, 1);
    // The job should have been attempted (run_count incremented or next_run updated)
    const logs = verifyStore.listCronLogs(schedules[0].id);
    assert.ok(logs.length > 0, "Expected at least one cron log entry");
    verifyStore.close();
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("CronExecutor skips jobs already running", async () => {
  const paths = await createTempPaths();
  try {
    const store = await SqliteMemoryStore.open(paths);
    store.addCronSchedule({
      name: "Overlap test",
      scheduleType: "interval",
      scheduleValue: "1h",
      prompt: "Test",
      nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    });
    store.close();

    const executor = new CronExecutor({ config: TEST_CONFIG, paths, tickIntervalMs: 100 });

    // Run tick twice rapidly — the second should not create a second log for the same job
    await Promise.all([executor.tick(), executor.tick()]);

    const verifyStore = await SqliteMemoryStore.open(paths);
    const schedules = verifyStore.listCronSchedules();
    const logs = verifyStore.listCronLogs(schedules[0].id);
    // Should only have 1 log (not 2) since the job was skipped on overlap
    assert.equal(logs.length, 1, `Expected 1 cron log but got ${logs.length}`);
    verifyStore.close();
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("CronExecutor one-shot job sets empty next_run_at", async () => {
  const paths = await createTempPaths();
  try {
    const store = await SqliteMemoryStore.open(paths);
    store.addCronSchedule({
      name: "One-shot",
      scheduleType: "once",
      scheduleValue: new Date(Date.now() - 60_000).toISOString(),
      prompt: "Do once",
      nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    });
    store.close();

    const executor = new CronExecutor({ config: TEST_CONFIG, paths, tickIntervalMs: 100 });
    await executor.tick();

    const verifyStore = await SqliteMemoryStore.open(paths);
    const schedules = verifyStore.listCronSchedules();
    assert.equal(schedules[0].nextRunAt, "", "One-shot job should have empty next_run_at after execution");
    verifyStore.close();
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});
