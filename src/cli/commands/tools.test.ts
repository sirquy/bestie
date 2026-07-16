import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { appendLog } from "../../runtime/logger.js";
import type { RuntimePaths } from "../../runtime/paths.js";
import { SqliteMemoryStore } from "../../memory/sqlite-store.js";
import { runToolsCommand } from "./tools.js";

test("runToolsCommand prints recent logs through the gated local tool", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await appendLog({ event: "tool_test_first" }, { paths });
    await appendLog({ event: "tool_test_second" }, { paths });

    await runToolsCommand({ argv: ["node", "bestie", "tools", "logs", "--lines", "3"], paths, writeLine: (line) => lines.push(line) });

    assert.equal(lines.length, 3);
    assert.match(lines.join("\n"), /tool_test_second/);
    assert.match(lines.join("\n"), /action_permission_decision/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runToolsCommand rejects invalid line counts", async () => {
  await assert.rejects(
    runToolsCommand({ argv: ["node", "bestie", "tools", "logs", "--lines", "0"], paths: await createTempPaths() }),
    /--lines phải là số nguyên từ 1 đến 200/,
  );
});

test("runToolsCommand prints active memories through the gated local tool", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    const store = await SqliteMemoryStore.open(paths);
    try {
      store.addMemory({ type: "preference", content: "prefers short answers", importance: 4 });
    } finally {
      store.close();
    }

    await runToolsCommand({ argv: ["node", "bestie", "tools", "memories", "--limit", "1"], paths, writeLine: (line) => lines.push(line) });

    assert.equal(lines.length, 1);
    assert.match(lines[0], /prefers short answers/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runToolsCommand rejects invalid memory limits", async () => {
  await assert.rejects(
    runToolsCommand({ argv: ["node", "bestie", "tools", "memories", "--limit", "0"], paths: await createTempPaths() }),
    /--limit phải là số nguyên từ 1 đến 50/,
  );
});

test("runToolsCommand prints usage for missing subcommand", async () => {
  const lines: string[] = [];

  await runToolsCommand({ argv: ["node", "bestie", "tools"], paths: await createTempPaths(), writeLine: (line) => lines.push(line) });

  assert.deepEqual(lines, ["Cách dùng: bestie tools logs [--lines N] | memories [--limit N] | git status | git diff [--staged] | git log [--limit N] | attachments cleanup [--older-than 7d] [--kinds voice,audio] [--confirm]"]);
});

test("runToolsCommand dry-runs Telegram attachment cleanup", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    const voicePath = resolve(paths.workspaceDir, "telegram/2026-07-11/1-2-voice-message.ogg");
    const photoPath = resolve(paths.workspaceDir, "telegram/2026-07-11/1-3-photo-image.jpg");
    await mkdir(resolve(paths.workspaceDir, "telegram/2026-07-11"), { recursive: true });
    await writeFile(voicePath, new Uint8Array([1, 2, 3]));
    await writeFile(photoPath, new Uint8Array([1, 2]));

    await runToolsCommand({ argv: ["node", "bestie", "tools", "attachments", "cleanup", "--older-than", "0s", "--kinds", "voice,audio"], paths, writeLine: (line) => lines.push(line) });

    assert.match(lines.join("\n"), /Sẽ xóa 1 file attachment Telegram/);
    assert.match(lines.join("\n"), /Chỉ chạy thử/);
    assert.match(lines.join("\n"), /voice/);
    await access(voicePath);
    await access(photoPath);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runToolsCommand deletes confirmed Telegram attachments", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    const voicePath = resolve(paths.workspaceDir, "telegram/2026-07-11/1-2-voice-message.ogg");
    const documentPath = resolve(paths.workspaceDir, "telegram/2026-07-11/1-3-document-note.txt");
    await mkdir(resolve(paths.workspaceDir, "telegram/2026-07-11"), { recursive: true });
    await writeFile(voicePath, new Uint8Array([1, 2, 3]));
    await writeFile(documentPath, new Uint8Array([1, 2]));

    await runToolsCommand({ argv: ["node", "bestie", "tools", "attachments", "cleanup", "--older-than", "0s", "--kinds", "voice", "--confirm"], paths, writeLine: (line) => lines.push(line) });

    assert.match(lines.join("\n"), /Đã xóa 1 file attachment Telegram/);
    await assert.rejects(() => access(voicePath));
    await access(documentPath);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runToolsCommand prints git status diff and log", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await runGit(paths.rootDir, ["init"]);
    await runGit(paths.rootDir, ["config", "user.email", "bestie@example.test"]);
    await runGit(paths.rootDir, ["config", "user.name", "Bestie Test"]);
    await writeFile(resolve(paths.rootDir, "note.txt"), "hello\n");
    await runGit(paths.rootDir, ["add", "note.txt"]);
    await runGit(paths.rootDir, ["commit", "-m", "initial"]);
    await writeFile(resolve(paths.rootDir, "note.txt"), "hello\nchanged\n");

    await runToolsCommand({ argv: ["node", "bestie", "tools", "git", "status"], paths, writeLine: (line) => lines.push(line) });
    await runToolsCommand({ argv: ["node", "bestie", "tools", "git", "diff"], paths, writeLine: (line) => lines.push(line) });
    await runToolsCommand({ argv: ["node", "bestie", "tools", "git", "log", "--limit", "1"], paths, writeLine: (line) => lines.push(line) });

    assert.match(lines.join("\n"), /M note\.txt/);
    assert.match(lines.join("\n"), /\+changed/);
    assert.match(lines.join("\n"), /initial/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-tools-command-test-"));
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
