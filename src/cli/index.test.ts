import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { main } from "./index.js";
import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import { getRuntimePaths } from "../runtime/paths.js";

const execFileAsync = promisify(execFile);

test("main suppresses the banner when BESTIE_NO_BANNER is set", async () => {
  const { stdout } = await captureMain(["node", "bestie"], { BESTIE_NO_BANNER: "1" });

  assert.doesNotMatch(stdout, /____/);
  assert.match(stdout, /Usage:/);
});

test("main renders the static banner when BESTIE_BANNER is static", async () => {
  const { stdout } = await captureMain(["node", "bestie"], { BESTIE_BANNER: "static" });

  assert.match(stdout, /____/);
  assert.match(stdout, /Usage:/);
  assert.match(stdout, /chat\s+Bắt đầu chat terminal sau khi onboard/);
  assert.match(stdout, /status\s+Xem trạng thái thiết lập local/);
});

test("main suppresses the banner for memory export JSON", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const { stdout } = await captureMain(["node", "bestie", "memory", "export"], { HOME: homeDir });

    assert.doesNotMatch(stdout, /____/);
    const parsed = JSON.parse(stdout) as { memories: unknown[]; pendingMemories: unknown[]; messages: unknown[] };
    assert.ok(Array.isArray(parsed.memories));
    assert.ok(Array.isArray(parsed.pendingMemories));
    assert.ok(Array.isArray(parsed.messages));
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("main suppresses the banner for memory analyze JSON", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const { stdout } = await captureMain(["node", "bestie", "memory", "analyze", "--json"], { HOME: homeDir });

    assert.doesNotMatch(stdout, /____/);
    const parsed = JSON.parse(stdout) as { allowed: boolean; checked: number; duplicateGroups: unknown[]; staleMemories: unknown[]; conflictGroups: unknown[] };
    assert.equal(parsed.allowed, true);
    assert.equal(parsed.checked, 0);
    assert.ok(Array.isArray(parsed.duplicateGroups));
    assert.ok(Array.isArray(parsed.staleMemories));
    assert.ok(Array.isArray(parsed.conflictGroups));
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory cleanup dry-run JSON reports planned deletions", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "preference", content: "Duplicate memory", importance: 4 });
      store.addMemory({ type: "preference", content: "Duplicate memory", importance: 1 });
    } finally {
      store.close();
    }

    const { stdout } = await captureMain(["node", "bestie", "memory", "cleanup", "--dry-run", "--json"], { HOME: homeDir });
    const parsed = JSON.parse(stdout) as { allowed: boolean; applied: boolean; plan: { deleteIds: number[] } };

    assert.equal(parsed.allowed, true);
    assert.equal(parsed.applied, false);
    assert.deepEqual(parsed.plan.deleteIds, [2]);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory cleanup apply defaults to ask without deleting", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "preference", content: "Duplicate memory", importance: 4 });
      store.addMemory({ type: "preference", content: "Duplicate memory", importance: 1 });
    } finally {
      store.close();
    }

    const { stdout } = await captureMain(["node", "bestie", "memory", "cleanup", "--apply", "--json"], { HOME: homeDir });
    const parsed = JSON.parse(stdout) as { allowed: boolean; applied: boolean; reason: string; plan: { deleteIds: number[] } };

    assert.equal(parsed.allowed, false);
    assert.equal(parsed.applied, false);
    assert.match(parsed.reason, /deletePolicy is ask/);
    assert.deepEqual(parsed.plan.deleteIds, [2]);

    const verifyStore = await SqliteMemoryStore.open(paths);
    try {
      assert.equal(verifyStore.listActiveMemories().length, 2);
    } finally {
      verifyStore.close();
    }
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory maintenance install creates a cron report schedule", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const { stdout } = await captureMain(
      ["node", "bestie", "memory", "maintenance", "install", "--channel", "telegram:123", "--schedule", "0 9 * * 1"],
      { HOME: homeDir, BESTIE_NO_BANNER: "1" },
    );

    assert.match(stdout, /Memory maintenance report installed/);

    const store = await SqliteMemoryStore.open(getRuntimePaths(homeDir));
    try {
      const [schedule] = store.listCronSchedules();
      assert.equal(schedule.name, "Bestie memory maintenance report");
      assert.equal(schedule.scheduleType, "cron_expr");
      assert.equal(schedule.scheduleValue, "0 9 * * 1");
      assert.equal(schedule.channel, "telegram:123");
      assert.match(schedule.prompt, /internal\.analyze_memories/);
    } finally {
      store.close();
    }
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory maintenance remove deletes the installed cron report schedule", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    await captureMain(["node", "bestie", "memory", "maintenance", "install", "--channel", "zalo:owner"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const { stdout } = await captureMain(["node", "bestie", "memory", "maintenance", "remove"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });

    assert.match(stdout, /Memory maintenance report removed/);

    const store = await SqliteMemoryStore.open(getRuntimePaths(homeDir));
    try {
      assert.equal(store.listCronSchedules().length, 0);
    } finally {
      store.close();
    }
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory governance policy updates retrieval policy in config", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.configPath, `${JSON.stringify(createTestConfig(), null, 2)}\n`, { mode: 0o600 });

    const { stdout } = await captureMain(["node", "bestie", "memory", "governance", "policy", "governed"], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const updated = JSON.parse(await readFile(paths.configPath, "utf8")) as { memory?: { retrievalPolicy?: string } };

    assert.match(stdout, /memory\.retrievalPolicy set to governed/);
    assert.equal(updated.memory?.retrievalPolicy, "governed");
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("memory pin and unpin update active memory metadata", async () => {
  const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-index-test-"));

  try {
    const paths = getRuntimePaths(homeDir);
    const store = await SqliteMemoryStore.open(paths);
    let id: number;
    try {
      id = store.addMemory({ type: "preference", content: "Pinned via CLI" }).id;
    } finally {
      store.close();
    }

    const pinned = await captureMain(["node", "bestie", "memory", "pin", String(id)], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const unpinned = await captureMain(["node", "bestie", "memory", "unpin", String(id)], { HOME: homeDir, BESTIE_NO_BANNER: "1" });
    const checkStore = await SqliteMemoryStore.open(paths);
    try {
      assert.match(pinned.stdout, /Memory pinned/);
      assert.match(unpinned.stdout, /Memory unpinned/);
      assert.equal(checkStore.getActiveMemory(id)?.pinned, false);
    } finally {
      checkStore.close();
    }
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("NO_COLOR disables ANSI color in human output", async () => {
  const { stdout } = await captureMain(["node", "bestie", "skills"], { BESTIE_NO_BANNER: "1", NO_COLOR: "1" });

  assert.doesNotMatch(stdout, /\x1b\[[0-9;]*m/);
});

test("nested command help is available for channels and MCP", async () => {
  const env = { BESTIE_NO_BANNER: "1" };
  const channelsHelp = await captureMain(["node", "bestie", "channels", "-h"], env);
  const mcpHelp = await captureMain(["node", "bestie", "mcp", "-h"], env);
  const telegramHelp = await captureMain(["node", "bestie", "channels", "telegram", "-h"], env);

  assert.match(channelsHelp.stdout, /Usage: bestie channels/);
  assert.match(channelsHelp.stdout, /telegram\s+Khởi động hoặc cấu hình channel adapter Telegram/);
  assert.match(mcpHelp.stdout, /Usage: bestie mcp/);
  assert.match(mcpHelp.stdout, /classify <server> <tool>/);
  assert.match(telegramHelp.stdout, /Usage: bestie channels telegram/);
  assert.match(telegramHelp.stdout, /voice\s+Alias cho lệnh voice dùng chung/);
});

test("linked bin entrypoint runs through npm symlinks", async () => {
  const linkedBin = await mkdtemp(resolve(tmpdir(), "bestie-linked-bin-test-"));
  const symlinkPath = resolve(linkedBin, "bestie");

  try {
    await symlink(resolve(process.cwd(), "dist/cli/index.js"), symlinkPath);
    const { stdout } = await execFileAsync(symlinkPath, ["--help"], { env: { ...process.env, BESTIE_BANNER: "static" } });

    assert.match(stdout, /Usage:/);
  } finally {
    await rm(linkedBin, { recursive: true, force: true });
  }
});

async function captureMain(argv: string[], env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string }> {
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const originalEnv: Record<string, string | undefined> = {};
  const stdout: string[] = [];
  const stderr: string[] = [];

  for (const key of Object.keys(env)) {
    originalEnv[key] = process.env[key];
    process.env[key] = env[key];
  }

  console.log = (message?: unknown) => stdout.push(String(message ?? ""));
  console.error = (message?: unknown) => stderr.push(String(message ?? ""));

  try {
    await main(argv);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  return { stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

function createTestConfig(): unknown {
  return {
    version: 1,
    agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
    llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "example-model", apiKeyEnv: "OPENAI_API_KEY" },
    memory: { writePolicy: "ask", deletePolicy: "ask" },
  };
}