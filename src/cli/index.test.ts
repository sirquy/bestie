import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { main } from "./index.js";

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

test("NO_COLOR disables ANSI color in human output", async () => {
  const { stdout } = await captureMain(["node", "bestie", "skills"], { BESTIE_NO_BANNER: "1", NO_COLOR: "1" });

  assert.doesNotMatch(stdout, /\x1b\[[0-9;]*m/);
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