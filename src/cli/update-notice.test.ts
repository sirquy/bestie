import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { RuntimePaths } from "../runtime/paths.js";
import { maybePrintUpdateNotice } from "./update-notice.js";

test("maybePrintUpdateNotice prints and caches available updates", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];
  let checks = 0;

  try {
    await maybePrintUpdateNotice({
      paths,
      writeLine: (line) => lines.push(line),
      now: new Date("2026-07-14T00:00:00.000Z"),
      checkForUpdate: async () => {
        checks += 1;
        return { packageName: "bestie-agent", currentVersion: "0.1.5", latestVersion: "0.1.6", updateAvailable: true };
      },
    });

    await maybePrintUpdateNotice({
      paths,
      writeLine: (line) => lines.push(line),
      now: new Date("2026-07-14T01:00:00.000Z"),
      checkForUpdate: async () => {
        checks += 1;
        return { packageName: "bestie-agent", currentVersion: "0.1.5", latestVersion: "0.1.7", updateAvailable: true };
      },
    });

    assert.equal(checks, 1);
    assert.match(lines.join("\n"), /Có bản Bestie mới: 0\.1\.5 -> 0\.1\.6/);
    assert.doesNotMatch(lines.join("\n"), /0\.1\.7/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("maybePrintUpdateNotice stays quiet when update checks fail", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await maybePrintUpdateNotice({
      paths,
      writeLine: (line) => lines.push(line),
      checkForUpdate: async () => {
        throw new Error("offline");
      },
    });

    assert.deepEqual(lines, []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-update-notice-test-"));
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