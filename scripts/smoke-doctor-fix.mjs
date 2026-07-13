import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.env.INIT_CWD ?? process.cwd();
const cliPath = resolve(projectRoot, "dist/cli/index.js");
const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-doctor-fix-"));

try {
  const appDir = resolve(rootDir, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");
  const envPath = resolve(appDir, ".env");
  const appLogPath = resolve(logsDir, "app.log");
  const memoryDbPath = resolve(dataDir, "memory.sqlite");

  await mkdir(logsDir, { recursive: true });
  await writeFile(envPath, 'OPENAI_API_KEY="sk-smoke-secret"\n', { mode: 0o644 });
  await writeFile(appLogPath, '{"event":"smoke"}\n', { mode: 0o644 });

  const result = spawnSync(process.execPath, [cliPath, "doctor", "--fix", "--json"], {
    cwd: rootDir,
    encoding: "utf8",
  });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /sk-smoke-secret/);

  const report = JSON.parse(result.stdout);
  assert.ok(Array.isArray(report.checks));
  assert.ok(Array.isArray(report.fixes));
  assert.equal(typeof report.issueCount, "number");
  assert.ok(report.issueCount > 0, "safe fixes must not create config or prompt files");
  assert.ok(report.fixes.some((fix) => fix.name === "Memory database" && fix.status === "fixed"));
  assert.ok(report.fixes.some((fix) => fix.name === ".env permissions" && fix.status === "fixed"));
  assert.ok(report.fixes.some((fix) => fix.name === "Log file permissions" && fix.status === "fixed"));

  assert.ok((await stat(appDir)).isDirectory());
  assert.ok((await stat(logsDir)).isDirectory());
  assert.ok((await stat(dataDir)).isDirectory());
  assert.ok((await stat(memoryDbPath)).isFile());
  assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  assert.equal((await stat(appLogPath)).mode & 0o777, 0o600);

  const envText = await readFile(envPath, "utf8");
  assert.match(envText, /sk-smoke-secret/);

  console.log(`${report.fixes.length} fixes checked, ${report.issueCount} issues after fix`);
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
