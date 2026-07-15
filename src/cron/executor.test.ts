import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { CronExecutor } from "./executor.js";
import { buildCronSystemPrompt } from "./isolated-chat.js";
import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import { writeEnvFile } from "../runtime/env.js";
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

const CHANNEL_CONFIG = {
  ...TEST_CONFIG,
  channels: {
    telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "111" },
    zalo: { enabled: true, botTokenEnv: "BESTIE_ZALO_BOT_TOKEN", ownerUserId: "zalo-owner" },
  },
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

test("cron isolated prompt exposes internal and configured MCP tools", () => {
  const prompt = buildCronSystemPrompt({
    ...TEST_CONFIG,
    mcp: { servers: [{ name: "composio", enabled: true, transport: "http", url: "https://connect.composio.dev/mcp", tools: [{ name: "gmail_search", category: "read" }] }] },
  });

  assert.match(prompt, /Available internal tools/);
  assert.match(prompt, /internal\.mcp_list_tools/);
  assert.match(prompt, /Available read-only MCP tools/);
  assert.match(prompt, /composio\/gmail_search/);
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

test("CronExecutor notifies when a due job fails", async () => {
  const paths = await createTempPaths();
  const notifications: Array<{ status: string; name: string; error?: string }> = [];
  try {
    const store = await SqliteMemoryStore.open(paths);
    store.addCronSchedule({
      name: "Notify failure",
      scheduleType: "interval",
      scheduleValue: "1h",
      prompt: "Test prompt",
      nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    });
    store.close();

    const executor = new CronExecutor({
      config: TEST_CONFIG,
      paths,
      tickIntervalMs: 100,
      notifier: async (notification) => {
        notifications.push({ status: notification.status, name: notification.job.name, error: notification.error });
      },
    });

    await executor.tick();

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].status, "error");
    assert.equal(notifications[0].name, "Notify failure");
    assert.match(notifications[0].error ?? "", /Missing API key for OPENAI_API_KEY/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("CronExecutor notification failures do not fail the cron job", async () => {
  const paths = await createTempPaths();
  try {
    const store = await SqliteMemoryStore.open(paths);
    store.addCronSchedule({
      name: "Notifier failure",
      scheduleType: "once",
      scheduleValue: new Date(Date.now() - 60_000).toISOString(),
      prompt: "Test prompt",
      nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    });
    store.close();

    const executor = new CronExecutor({
      config: TEST_CONFIG,
      paths,
      tickIntervalMs: 100,
      notifier: async () => {
        throw new Error("notify failed");
      },
    });

    await executor.tick();

    const verifyStore = await SqliteMemoryStore.open(paths);
    const [schedule] = verifyStore.listCronSchedules();
    assert.equal(schedule.lastResult, "error");
    assert.match(schedule.lastError ?? "", /Missing API key for OPENAI_API_KEY/);
    verifyStore.close();
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("CronExecutor reports to schedule channel destination", async () => {
  const paths = await createTempPaths();
  const requests: Array<{ url: string; body: string }> = [];
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await mkdir(paths.appDir, { recursive: true });
    await writeEnvFile({ BESTIE_TELEGRAM_BOT_TOKEN: "telegram-token", BESTIE_ZALO_BOT_TOKEN: "zalo-token" }, paths);

    const store = await SqliteMemoryStore.open(paths);
    store.addCronSchedule({
      name: "Destination failure",
      scheduleType: "once",
      scheduleValue: new Date(Date.now() - 60_000).toISOString(),
      prompt: "Test prompt",
      channel: "zalo:b66e0333b96650380977",
      nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    });
    store.close();

    const executor = new CronExecutor({ config: CHANNEL_CONFIG, paths, tickIntervalMs: 100 });
    await executor.tick();

    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /zaloplatforms/);
    assert.match(requests[0].body, /b66e0333b96650380977/);
    assert.doesNotMatch(requests[0].body, /zalo-owner/);
  } finally {
    globalThis.fetch = originalFetch;
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
