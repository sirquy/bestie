import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { appendLog, readRecentLogs, redactSecrets } from "./logger.js";
import type { RuntimePaths } from "./paths.js";

test("redactSecrets removes known secrets and token-like values", () => {
  const output = redactSecrets(
    {
      apiKey: "sk-test-secret",
      shortKey: "sk-secret-value",
      header: "Bearer abcdefghijklmnopqrstuvwxyz1234567890",
      note: "token abcdefghijklmnopqrstuvwxyz1234567890",
    },
    ["sk-test-secret"],
  );

  assert(!output.includes("sk-test-secret"));
  assert(!output.includes("sk-secret-value"));
  assert(!output.includes("abcdefghijklmnopqrstuvwxyz1234567890"));
  assert(output.includes("[REDACTED]"));
});

test("appendLog redacts known secrets and writes private log file", async () => {
  const paths = await createTempPaths();

  try {
    await appendLog(
      {
        event: "provider_error",
        detail: {
          message: "request failed",
          apiKey: "sk-test-secret",
          header: "Bearer abcdefghijklmnopqrstuvwxyz1234567890",
        },
      },
      { paths, knownSecrets: ["sk-test-secret"] },
    );

    const lines = await readRecentLogs(paths);
    const logMode = (await stat(paths.appLogPath)).mode & 0o777;
    const text = lines.join("\n");

    assert.equal(lines.length, 1);
    assert.equal(logMode, 0o600);
    assert(!text.includes("sk-test-secret"));
    assert(!text.includes("abcdefghijklmnopqrstuvwxyz1234567890"));
    assert(text.includes("[REDACTED]"));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-logger-test-"));
  const appDir = resolve(rootDir, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");

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
