import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { RuntimePaths } from "../../runtime/paths.js";
import { runUpdateCommand } from "./update.js";

test("runUpdateCommand reports an available update without applying it", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await runUpdateCommand({
      argv: ["node", "bestie", "update"],
      paths,
      writeLine: (line) => lines.push(line),
      writeError: (line) => lines.push(line),
      versionCheckOptions: { fetchImpl: fakeLatestVersionFetch("99.0.0") },
    });

    assert.match(lines.join("\n"), /Trạng thái\s+\[NEW\] .* -> 99\.0\.0/);
    assert.match(lines.join("\n"), /npm install -g bestie-agent@latest/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runUpdateCommand can apply an available update", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];
  const installedPackages: string[] = [];

  try {
    await runUpdateCommand({
      argv: ["node", "bestie", "update", "--apply"],
      paths,
      writeLine: (line) => lines.push(line),
      writeError: (line) => lines.push(line),
      versionCheckOptions: { fetchImpl: fakeLatestVersionFetch("99.0.0") },
      runInstaller: async (packageName) => {
        installedPackages.push(packageName);
        return 0;
      },
    });

    assert.deepEqual(installedPackages, ["bestie-agent"]);
    assert.match(lines.join("\n"), /Lệnh cập nhật Bestie đã chạy xong/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

function fakeLatestVersionFetch(version: string): typeof fetch {
  return async () => new Response(JSON.stringify({ version }), { status: 200, headers: { "content-type": "application/json" } });
}

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-update-command-test-"));
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