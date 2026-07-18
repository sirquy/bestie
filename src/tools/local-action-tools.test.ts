import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { DEFAULT_INTERNAL_EXEC_TIMEOUT_MS, type AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { applyPatchTool, editLocalFileTool, execLocalTool, listProcessesTool, writeLocalFileTool } from "./local-action-tools.js";

test("writeLocalFileTool obeys deny and allow policies", async () => {
  const paths = await createTempPaths();

  try {
    const denied = await writeLocalFileTool({ config: createConfig({ "internal.write_file": "deny" }), paths, path: "note.txt", content: "nope\n" });
    assert.equal(denied.allowed, false);
    assert.match(denied.reason, /denied by config/);

    const written = await writeLocalFileTool({ config: createConfig({ "internal.write_file": "allow" }), paths, path: "note.txt", content: "hello\n" });
    assert.equal(written.allowed, true);
    assert.equal(await readFile(resolve(paths.workspaceDir, "note.txt"), "utf8"), "hello\n");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("editLocalFileTool requires ask approval by default", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.workspaceDir, { recursive: true });
    await writeFile(resolve(paths.workspaceDir, "note.txt"), "hello\n");
    const denied = await editLocalFileTool({ config: createConfig(), paths, path: "note.txt", oldText: "hello", newText: "hi" });
    assert.equal(denied.allowed, false);
    assert.match(denied.reason, /Approval required/);

    const approved = await editLocalFileTool({
      config: createConfig(),
      paths,
      path: "note.txt",
      oldText: "hello",
      newText: "hi",
      approver: async () => ({ approved: true, reason: "test approved" }),
    });
    assert.equal(approved.allowed, true);
    assert.equal(approved.replacements, 1);
    assert.equal(await readFile(resolve(paths.workspaceDir, "note.txt"), "utf8"), "hi\n");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("applyPatchTool applies git-compatible patches when allowed", async () => {
  const paths = await createTempPaths();

  try {
    await writeFile(resolve(paths.rootDir, "note.txt"), "hello\n");
    const patch = [
      "diff --git a/note.txt b/note.txt",
      "--- a/note.txt",
      "+++ b/note.txt",
      "@@ -1 +1 @@",
      "-hello",
      "+hello patched",
      "",
    ].join("\n");
    const result = await applyPatchTool({ config: createConfig({ "internal.apply_patch": "allow" }), paths, patch });
    assert.equal(result.allowed, true);
    assert.equal(await readFile(resolve(paths.rootDir, "note.txt"), "utf8"), "hello patched\n");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("applyPatchTool rejects non-git apply patch markers", async () => {
  const paths = await createTempPaths();

  try {
    const result = await applyPatchTool({ config: createConfig({ "internal.apply_patch": "allow" }), paths, patch: "*** Begin Patch\n*** Update File: note.txt\n*** End Patch" });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /git apply compatible diff/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("execLocalTool and listProcessesTool honor policies", async () => {
  const paths = await createTempPaths();

  try {
    const denied = await execLocalTool({ config: createConfig({ "internal.exec": "deny" }), paths, command: process.execPath, args: ["--version"] });
    assert.equal(denied.allowed, false);

    const executed = await execLocalTool({ config: createConfig({ "internal.exec": "allow" }), paths, command: process.execPath, args: ["-e", "console.log('ok')"] });
    assert.equal(executed.allowed, true);
    assert.equal(executed.exitCode, 0);
    assert.match(executed.stdout, /ok/);

    const processes = await listProcessesTool({ config: createConfig({ "internal.list_processes": "allow" }), paths, limit: 5 });
    assert.equal(processes.allowed, true);
    assert.ok(processes.processes.length > 0);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("execLocalTool uses configured default timeout", async () => {
  const paths = await createTempPaths();
  const config: AppConfig = { ...createConfig({ "internal.exec": "allow" }), internalTools: { policies: { "internal.exec": "allow" }, exec: { timeoutMs: 25 } } };

  try {
    const result = await execLocalTool({ config, paths, command: process.execPath, args: ["-e", "setTimeout(() => {}, 1000)"] });

    assert.equal(result.allowed, true);
    assert.equal(result.timedOut, true);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("execLocalTool uses long default timeout for heavy agent tasks", async () => {
  const paths = await createTempPaths();

  try {
    const result = await execLocalTool({ config: createConfig({ "internal.exec": "allow" }), paths, command: process.execPath, args: ["-e", "console.log('ok')"] });

    assert.equal(result.allowed, true);
    assert.equal(result.timedOut, false);
    assert.equal(DEFAULT_INTERNAL_EXEC_TIMEOUT_MS, 300_000);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("execLocalTool resolves bestie without relying on PATH", async () => {
  const paths = await createTempPaths();

  try {
    const result = await execLocalTool({ config: createConfig({ "internal.exec": "allow" }), paths, command: "bestie", args: ["--help"] });

    assert.equal(result.allowed, true);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Local-first Bestie agent CLI/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("execLocalTool exposes the current Node bin directory for npm commands", async () => {
  const paths = await createTempPaths();
  const originalPath = process.env.PATH;

  try {
    process.env.PATH = "/usr/bin:/bin";
    const result = await execLocalTool({ config: createConfig({ "internal.exec": "allow" }), paths, command: "npm", args: ["--version"] });

    assert.equal(result.allowed, true);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("local action tools use the default agent workspace for relative paths", async () => {
  const paths = await createTempPaths();

  try {
    const result = await writeLocalFileTool({ config: createConfig({ "internal.write_file": "allow" }), paths, path: "scratch.txt", content: "workspace\n" });

    assert.equal(result.allowed, true);
    assert.equal(await readFile(resolve(paths.workspaceDir, "scratch.txt"), "utf8"), "workspace\n");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("local action tools honor configured workspace default path", async () => {
  const paths = await createTempPaths();
  const workspacePath = resolve(paths.rootDir, ".bestie", "agent-scratch");
  const config: AppConfig = { ...createConfig({ "internal.write_file": "allow", "internal.exec": "allow" }), workspace: { defaultPath: workspacePath } };

  try {
    const written = await writeLocalFileTool({ config, paths, path: "scratch.txt", content: "configured workspace\n" });
    assert.equal(written.allowed, true);
    assert.equal(await readFile(resolve(workspacePath, "scratch.txt"), "utf8"), "configured workspace\n");

    const executed = await execLocalTool({ config, paths, command: process.execPath, args: ["-e", "console.log(process.cwd())"] });
    assert.equal(executed.allowed, true);
    assert.equal(executed.stdout.trim(), workspacePath);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("local action tools allow configured external paths", async () => {
  const paths = await createTempPaths();
  const externalDir = await mkdtemp(resolve(tmpdir(), "bestie-local-action-external-"));

  try {
    const config = { ...createConfig({ "internal.write_file": "allow" }), workspace: { externalPaths: [externalDir] } };
    const result = await writeLocalFileTool({ config, paths, path: resolve(externalDir, "note.txt"), content: "external\n" });

    assert.equal(result.allowed, true);
    assert.equal(await readFile(resolve(externalDir, "note.txt"), "utf8"), "external\n");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
    await rm(externalDir, { recursive: true, force: true });
  }
});

test("local action tools reject unconfigured external paths", async () => {
  const paths = await createTempPaths();
  const outsidePath = resolve(paths.rootDir, "../outside-note.txt");

  try {
    await assert.rejects(
      () => writeLocalFileTool({ config: createConfig({ "internal.write_file": "allow" }), paths, path: outsidePath, content: "nope\n" }),
      /outside the project, agent workspace, and configured external write paths/,
    );
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

function createConfig(policies: Record<string, "allow" | "ask" | "deny"> = {}): AppConfig {
  return {
    version: 1,
    agent: { name: "Bea", ownerName: "Andy", language: "vi", toneIntensity: 7 },
    llm: { provider: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", model: "test-model", apiKeyEnv: "OPENAI_API_KEY" },
    internalTools: { policies },
  };
}

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-local-action-tools-test-"));
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
