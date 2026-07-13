import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { appendLog } from "../runtime/logger.js";
import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import { listActiveMemoriesTool, listLocalFilesTool, readGitDiffTool, readGitLogTool, readGitStatusTool, readLocalFileTool, readManyLocalFilesTool, readMarkdownBundleTool, readRecentAppLogsTool, searchLocalFilesTool, searchMemoriesTool } from "./local-read-tools.js";

test("readRecentAppLogsTool reads recent logs through the permission gate", async () => {
  const paths = await createTempPaths();

  try {
    await appendLog({ event: "first_event", detail: { ok: true } }, { paths });
    await appendLog({ event: "second_event", detail: { ok: true } }, { paths });

    const result = await readRecentAppLogsTool({ paths, lineCount: 3 });

    assert.equal(result.allowed, true);
    assert.match(result.reason, /Trusted read-only/);
    assert.equal(result.lines.length, 3);
    assert.match(result.lines.join("\n"), /second_event/);
    assert.match(result.lines.join("\n"), /action_permission_decision/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("readRecentAppLogsTool returns denied result when trusted reads are disabled", async () => {
  const paths = await createTempPaths();

  try {
    await appendLog({ event: "private_event", detail: { ok: true } }, { paths });

    const result = await readRecentAppLogsTool({ paths, policy: { allowTrustedRead: false } });

    assert.equal(result.allowed, false);
    assert.match(result.reason, /no approver/);
    assert.deepEqual(result.lines, []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("listActiveMemoriesTool reads active memories through the permission gate", async () => {
  const paths = await createTempPaths();

  try {
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "preference", content: "likes concise replies", importance: 4 });
      store.addMemory({ type: "project_context", content: "building Telegram MVP", importance: 5 });
    } finally {
      store.close();
    }

    const result = await listActiveMemoriesTool({ paths, limit: 1 });

    assert.equal(result.allowed, true);
    assert.equal(result.memories.length, 1);
    assert.equal(result.memories[0].content, "building Telegram MVP");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("listActiveMemoriesTool returns up to 50 memories by default", async () => {
  const paths = await createTempPaths();

  try {
    const store = await SqliteMemoryStore.open(paths);
    try {
      for (let index = 1; index <= 55; index += 1) {
        store.addMemory({ type: "preference", content: `memory ${index}`, importance: 1 });
      }
    } finally {
      store.close();
    }

    const result = await listActiveMemoriesTool({ paths });

    assert.equal(result.allowed, true);
    assert.equal(result.memories.length, 50);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("listActiveMemoriesTool returns denied result when trusted reads are disabled", async () => {
  const paths = await createTempPaths();

  try {
    const result = await listActiveMemoriesTool({ paths, policy: { allowTrustedRead: false } });

    assert.equal(result.allowed, false);
    assert.match(result.reason, /no approver/);
    assert.deepEqual(result.memories, []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("searchMemoriesTool searches active memories through the permission gate", async () => {
  const paths = await createTempPaths();

  try {
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "preference", content: "likes concise replies", importance: 4 });
      store.addMemory({ type: "project_context", content: "building Telegram MVP", importance: 5 });
    } finally {
      store.close();
    }

    const result = await searchMemoriesTool({ paths, query: "concise", limit: 5 });

    assert.equal(result.allowed, true);
    assert.equal(result.query, "concise");
    assert.deepEqual(result.memories.map((memory) => memory.content), ["likes concise replies"]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("searchMemoriesTool returns denied result when trusted reads are disabled", async () => {
  const paths = await createTempPaths();

  try {
    const result = await searchMemoriesTool({ paths, query: "concise", policy: { allowTrustedRead: false } });

    assert.equal(result.allowed, false);
    assert.match(result.reason, /no approver/);
    assert.equal(result.query, "concise");
    assert.deepEqual(result.memories, []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("readLocalFileTool reads project files through the permission gate", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.logsDir, { recursive: true });
    await writeFile(paths.appLogPath, "hello log\n", { mode: 0o600 });

    const result = await readLocalFileTool({ paths, path: ".bestie/logs/app.log" });

    assert.equal(result.allowed, true);
    assert.match(result.content ?? "", /^hello log\n/);
    assert.match(result.path ?? "", /app\.log$/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("readLocalFileTool rejects paths outside the project", async () => {
  const paths = await createTempPaths();

  try {
    await assert.rejects(() => readLocalFileTool({ paths, path: resolve(paths.rootDir, "../outside.txt") }), /outside the project, agent workspace, and configured external read paths/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("readLocalFileTool allows configured external paths", async () => {
  const paths = await createTempPaths();
  const externalDir = await mkdtemp(resolve(tmpdir(), "bestie-local-read-external-"));

  try {
    await writeFile(resolve(externalDir, "note.txt"), "external read\n");
    const result = await readLocalFileTool({ config: createConfig({ externalPaths: [externalDir] }), paths, path: resolve(externalDir, "note.txt") });

    assert.equal(result.allowed, true);
    assert.equal(result.content, "external read\n");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
    await rm(externalDir, { recursive: true, force: true });
  }
});

test("readLocalFileTool rejects ignored project directories", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(resolve(paths.rootDir, "node_modules/pkg"), { recursive: true });
    await writeFile(resolve(paths.rootDir, "node_modules/pkg/README.md"), "ignored\n");

    const result = await readLocalFileTool({ paths, path: "node_modules/pkg/README.md" });

    assert.equal(result.allowed, false);
    assert.match(result.reason, /ignored directory/);
    assert.equal(result.content, undefined);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("readLocalFileTool reports missing files without throwing", async () => {
  const paths = await createTempPaths();

  try {
    const result = await readLocalFileTool({ paths, path: "src/runtime/runtime.ts" });

    assert.equal(result.allowed, false);
    assert.match(result.reason, /does not exist/);
    assert.equal(result.content, undefined);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("listLocalFilesTool lists workspace entries by default", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.workspaceDir, { recursive: true });
    await writeFile(resolve(paths.rootDir, "note.txt"), "hi\n");
    await writeFile(resolve(paths.workspaceDir, "scratch.txt"), "hi\n");

    const result = await listLocalFilesTool({ paths, path: "." });

    assert.equal(result.allowed, true);
    assert.ok(result.entries.some((entry) => entry.name === "scratch.txt" && entry.type === "file"));
    assert.ok(!result.entries.some((entry) => entry.name === "note.txt"));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("listLocalFilesTool lists explicit project paths", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(resolve(paths.rootDir, "src"), { recursive: true });
    await writeFile(resolve(paths.rootDir, "src", "index.ts"), "export {};\n");

    const result = await listLocalFilesTool({ paths, path: "src" });

    assert.equal(result.allowed, true);
    assert.ok(result.entries.some((entry) => entry.name === "index.ts" && entry.type === "file"));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("listLocalFilesTool returns empty default workspace when it does not exist", async () => {
  const paths = await createTempPaths();

  try {
    const result = await listLocalFilesTool({ paths, path: "." });

    assert.equal(result.allowed, true);
    assert.deepEqual(result.entries, []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("listLocalFilesTool reports missing directories without throwing", async () => {
  const paths = await createTempPaths();

  try {
    const result = await listLocalFilesTool({ paths, path: "src/missing" });

    assert.equal(result.allowed, false);
    assert.match(result.reason, /does not exist/);
    assert.deepEqual(result.entries, []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("searchLocalFilesTool searches workspace by default and explicit project paths", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.logsDir, { recursive: true });
    await writeFile(paths.appLogPath, "hello log\n", { mode: 0o600 });
    await writeFile(resolve(paths.rootDir, "config.sample.json"), "{}\n");
    await mkdir(paths.workspaceDir, { recursive: true });
    await writeFile(resolve(paths.workspaceDir, "workspace.log"), "hello log\n");

    const logResult = await searchLocalFilesTool({ paths, query: "*.log", path: "." });
    const configResult = await searchLocalFilesTool({ paths, query: "config", path: "." });
    const projectResult = await searchLocalFilesTool({ paths, query: "config", path: paths.rootDir });

    assert.equal(logResult.allowed, true);
    assert.ok(logResult.matches.some((match) => match.path === "workspace.log" && match.type === "file"));
    assert.equal(configResult.matches.length, 0);
    assert.ok(projectResult.matches.some((match) => match.path === "config.sample.json"));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("searchLocalFilesTool rejects paths outside the project", async () => {
  const paths = await createTempPaths();

  try {
    await assert.rejects(() => searchLocalFilesTool({ paths, query: "*.log", path: resolve(paths.rootDir, "../outside") }), /outside the project, agent workspace, and configured external read paths/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("searchLocalFilesTool reports missing roots without throwing", async () => {
  const paths = await createTempPaths();

  try {
    const result = await searchLocalFilesTool({ paths, query: "runtime", path: "src/missing" });

    assert.equal(result.allowed, false);
    assert.match(result.reason, /does not exist/);
    assert.deepEqual(result.matches, []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("readManyLocalFilesTool reads multiple project files with stable budgets", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(resolve(paths.rootDir, "docs"), { recursive: true });
    await writeFile(resolve(paths.rootDir, "README.md"), "hello readme\n");
    await writeFile(resolve(paths.rootDir, "docs/spec.md"), "0123456789abcdef\n");

    const result = await readManyLocalFilesTool({ paths, pathsToRead: ["README.md", "docs/spec.md"], maxBytesPerFile: 10, maxTotalBytes: 20 });

    assert.equal(result.allowed, true);
    assert.equal(result.totalBytes, 20);
    assert.deepEqual(result.files.map((file) => ({ path: file.path, content: file.content, truncated: file.truncated })), [
      { path: "README.md", content: "hello read", truncated: true },
      { path: "docs/spec.md", content: "0123456789", truncated: true },
    ]);
    assert.deepEqual(result.skipped, []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("readManyLocalFilesTool rejects traversal and skipped directories", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(resolve(paths.rootDir, "node_modules/pkg"), { recursive: true });
    await writeFile(resolve(paths.rootDir, "node_modules/pkg/README.md"), "ignored\n");

    const result = await readManyLocalFilesTool({ paths, pathsToRead: [resolve(paths.rootDir, "../outside.md"), "node_modules/pkg/README.md"] });

    assert.equal(result.allowed, true);
    assert.deepEqual(result.files, []);
    assert.equal(result.skipped.length, 2);
    assert.match(result.skipped[0].reason, /outside the project, agent workspace, and configured external read paths/);
    assert.match(result.skipped[1].reason, /ignored directory/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("readManyLocalFilesTool skips missing files without throwing", async () => {
  const paths = await createTempPaths();

  try {
    await writeFile(resolve(paths.rootDir, "README.md"), "hello readme\n");

    const result = await readManyLocalFilesTool({ paths, pathsToRead: ["README.md", "src/runtime/runtime.ts"] });

    assert.equal(result.allowed, true);
    assert.deepEqual(result.files.map((file) => file.path), ["README.md"]);
    assert.deepEqual(result.skipped, [{ path: "src/runtime/runtime.ts", reason: "Path does not exist." }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("readMarkdownBundleTool sorts root docs before docs directory files", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(resolve(paths.rootDir, "docs"), { recursive: true });
    await writeFile(resolve(paths.rootDir, "docs/NOW_BUILD_SPEC.md"), "now\n");
    await writeFile(resolve(paths.rootDir, "PROJECT.md"), "project\n");
    await writeFile(resolve(paths.rootDir, "README.md"), "readme\n");
    await writeFile(resolve(paths.rootDir, "AGENTS.md"), "agents\n");

    const result = await readMarkdownBundleTool({ paths, path: "." });

    assert.equal(result.allowed, true);
    assert.deepEqual(result.manifest, ["README.md", "PROJECT.md", "AGENTS.md", "docs/NOW_BUILD_SPEC.md"]);
    assert.deepEqual(result.files.map((file) => file.path), result.manifest);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("readMarkdownBundleTool skips ignored directories and respects limits", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(resolve(paths.rootDir, "docs"), { recursive: true });
    await mkdir(resolve(paths.rootDir, "node_modules/pkg"), { recursive: true });
    await writeFile(resolve(paths.rootDir, "README.md"), "readme\n");
    await writeFile(resolve(paths.rootDir, "docs/A.md"), "a\n");
    await writeFile(resolve(paths.rootDir, "node_modules/pkg/README.md"), "ignored\n");

    const result = await readMarkdownBundleTool({ paths, path: ".", limit: 1 });

    assert.equal(result.allowed, true);
    assert.deepEqual(result.manifest, ["README.md"]);
    assert.deepEqual(result.skipped, []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("readMarkdownBundleTool reports truncated files under byte budgets", async () => {
  const paths = await createTempPaths();

  try {
    await writeFile(resolve(paths.rootDir, "README.md"), "0123456789abcdef\n");

    const result = await readMarkdownBundleTool({ paths, path: ".", maxBytesPerFile: 5, maxTotalBytes: 5 });

    assert.equal(result.allowed, true);
    assert.equal(result.totalBytes, 5);
    assert.deepEqual(result.truncatedFiles, ["README.md"]);
    assert.equal(result.files[0].content, "01234");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("readMarkdownBundleTool reports missing roots without throwing", async () => {
  const paths = await createTempPaths();

  try {
    const result = await readMarkdownBundleTool({ paths, path: "src/missing" });

    assert.equal(result.allowed, false);
    assert.match(result.reason, /does not exist/);
    assert.deepEqual(result.manifest, []);
    assert.deepEqual(result.files, []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("git read tools inspect status diff and log through the permission gate", async () => {
  const paths = await createTempPaths();

  try {
    await runGit(paths.rootDir, ["init"]);
    await runGit(paths.rootDir, ["config", "user.email", "bestie@example.test"]);
    await runGit(paths.rootDir, ["config", "user.name", "Bestie Test"]);
    await writeFile(resolve(paths.rootDir, "note.txt"), "hello\n");
    await runGit(paths.rootDir, ["add", "note.txt"]);
    await runGit(paths.rootDir, ["commit", "-m", "initial"]);
    await writeFile(resolve(paths.rootDir, "note.txt"), "hello\nchanged\n");

    const status = await readGitStatusTool({ paths });
    const diff = await readGitDiffTool({ paths });
    const log = await readGitLogTool({ paths, limit: 5 });

    assert.equal(status.allowed, true);
    assert.match(status.output, /M note\.txt/);
    assert.equal(diff.allowed, true);
    assert.match(diff.output, /\+changed/);
    assert.equal(diff.truncated, false);
    assert.equal(log.allowed, true);
    assert.match(log.output, /initial/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("git read tools return denied result when trusted reads are disabled", async () => {
  const paths = await createTempPaths();

  try {
    const result = await readGitStatusTool({ paths, policy: { allowTrustedRead: false } });

    assert.equal(result.allowed, false);
    assert.match(result.reason, /no approver/);
    assert.equal(result.output, "");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-local-tool-test-"));
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

function createConfig(workspace: NonNullable<AppConfig["workspace"]>): AppConfig {
  return {
    version: 1,
    agent: { name: "Bea", ownerName: "Andy", language: "vi", toneIntensity: 7 },
    llm: { provider: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", model: "test-model", apiKeyEnv: "OPENAI_API_KEY" },
    workspace,
  };
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  const { execFile } = await import("node:child_process");
  await new Promise<void>((resolvePromise, reject) => {
    execFile("git", args, { cwd }, (error) => {
      if (error) {
        reject(error);
      } else {
        resolvePromise();
      }
    });
  });
}