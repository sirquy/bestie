import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { addCronScheduleTool, listCronSchedulesTool, removeCronScheduleTool, toggleCronScheduleTool } from "./cron-tools.js";
import { getRuntimePaths, type RuntimePaths } from "../runtime/paths.js";

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-cron-test-"));
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

test("addCronScheduleTool creates an interval schedule", async () => {
  const paths = await createTempPaths();
  try {
    const result = await addCronScheduleTool(
      { name: "Test job", schedule_type: "interval", schedule_value: "30m", prompt: "Do something" },
      { config: TEST_CONFIG, paths },
    );

    assert.equal(result.ok, true);
    assert.equal(result.status, "pass");
    assert.ok(result.message?.includes("Test job"));
    assert.ok((result.result as Record<string, unknown>)?.scheduleId);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("addCronScheduleTool stores channel user destination", async () => {
  const paths = await createTempPaths();
  try {
    const result = await addCronScheduleTool(
      { name: "Report job", schedule_type: "interval", schedule_value: "30m", prompt: "Do something", channel: "telegram:12345" },
      { config: TEST_CONFIG, paths },
    );

    assert.equal(result.ok, true);
    assert.equal((result.result as Record<string, unknown>).channel, "telegram:12345");

    const listResult = await listCronSchedulesTool({ config: TEST_CONFIG, paths });
    const data = listResult.result as { schedules: Array<{ channel?: string }> };
    assert.equal(data.schedules[0].channel, "telegram:12345");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("addCronScheduleTool rejects invalid channel destination", async () => {
  const paths = await createTempPaths();
  try {
    const result = await addCronScheduleTool(
      { name: "Bad report", schedule_type: "interval", schedule_value: "30m", prompt: "Do something", channel: "telegram" },
      { config: TEST_CONFIG, paths },
    );

    assert.equal(result.ok, false);
    assert.match(result.message ?? "", /telegram:<userId>/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("addCronScheduleTool creates a cron_expr schedule", async () => {
  const paths = await createTempPaths();
  try {
    const result = await addCronScheduleTool(
      { name: "Morning brief", schedule_type: "cron_expr", schedule_value: "0 8 * * *", prompt: "Review tasks" },
      { config: TEST_CONFIG, paths },
    );

    assert.equal(result.ok, true);
    assert.equal(result.status, "pass");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("addCronScheduleTool rejects missing fields", async () => {
  const paths = await createTempPaths();
  try {
    const result1 = await addCronScheduleTool({}, { config: TEST_CONFIG, paths });
    assert.equal(result1.ok, false);
    assert.ok(result1.message?.includes("name"));

    const result2 = await addCronScheduleTool({ name: "x" }, { config: TEST_CONFIG, paths });
    assert.equal(result2.ok, false);
    assert.ok(result2.message?.includes("schedule_type"));

    const result3 = await addCronScheduleTool({ name: "x", schedule_type: "interval" }, { config: TEST_CONFIG, paths });
    assert.equal(result3.ok, false);
    assert.ok(result3.message?.includes("schedule_value"));

    const result4 = await addCronScheduleTool({ name: "x", schedule_type: "interval", schedule_value: "1h" }, { config: TEST_CONFIG, paths });
    assert.equal(result4.ok, false);
    assert.ok(result4.message?.includes("prompt"));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("addCronScheduleTool rejects invalid schedule", async () => {
  const paths = await createTempPaths();
  try {
    const result = await addCronScheduleTool(
      { name: "Bad", schedule_type: "interval", schedule_value: "invalid", prompt: "Do it" },
      { config: TEST_CONFIG, paths },
    );

    assert.equal(result.ok, false);
    assert.ok(result.message?.includes("Invalid schedule"));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("listCronSchedulesTool lists schedules", async () => {
  const paths = await createTempPaths();
  try {
    await addCronScheduleTool(
      { name: "Job A", schedule_type: "interval", schedule_value: "1h", prompt: "A" },
      { config: TEST_CONFIG, paths },
    );
    await addCronScheduleTool(
      { name: "Job B", schedule_type: "cron_expr", schedule_value: "0 9 * * *", prompt: "B" },
      { config: TEST_CONFIG, paths },
    );

    const result = await listCronSchedulesTool({ config: TEST_CONFIG, paths });
    assert.equal(result.ok, true);

    const data = result.result as { schedules: Array<{ id: number; name: string }> };
    assert.equal(data.schedules.length, 2);
    assert.ok(data.schedules.some((s) => s.name === "Job A"));
    assert.ok(data.schedules.some((s) => s.name === "Job B"));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("removeCronScheduleTool removes a schedule", async () => {
  const paths = await createTempPaths();
  try {
    const addResult = await addCronScheduleTool(
      { name: "To remove", schedule_type: "interval", schedule_value: "5m", prompt: "Remove me" },
      { config: TEST_CONFIG, paths },
    );
    const scheduleId = (addResult.result as Record<string, number>).scheduleId;

    const removeResult = await removeCronScheduleTool({ schedule_id: scheduleId }, { config: TEST_CONFIG, paths });
    assert.equal(removeResult.ok, true);

    const listResult = await listCronSchedulesTool({ config: TEST_CONFIG, paths });
    const data = listResult.result as { schedules: unknown[] };
    assert.equal(data.schedules.length, 0);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("removeCronScheduleTool rejects missing schedule_id", async () => {
  const paths = await createTempPaths();
  try {
    const result = await removeCronScheduleTool({}, { config: TEST_CONFIG, paths });
    assert.equal(result.ok, false);
    assert.ok(result.message?.includes("schedule_id"));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("toggleCronScheduleTool enables and disables", async () => {
  const paths = await createTempPaths();
  try {
    const addResult = await addCronScheduleTool(
      { name: "Toggle me", schedule_type: "interval", schedule_value: "1h", prompt: "Toggle" },
      { config: TEST_CONFIG, paths },
    );
    const scheduleId = (addResult.result as Record<string, number>).scheduleId;

    const disableResult = await toggleCronScheduleTool({ schedule_id: scheduleId, enabled: false }, { config: TEST_CONFIG, paths });
    assert.equal(disableResult.ok, true);
    assert.ok(disableResult.message?.includes("disabled"));

    const enableResult = await toggleCronScheduleTool({ schedule_id: scheduleId, enabled: true }, { config: TEST_CONFIG, paths });
    assert.equal(enableResult.ok, true);
    assert.ok(enableResult.message?.includes("enabled"));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});
