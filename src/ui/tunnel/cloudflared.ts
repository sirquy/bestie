import { execFile, spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import type { RuntimePaths } from "../../runtime/paths.js";

const execFileAsync = promisify(execFile);
const CLOUDFLARED_PATH_ENV = "BESTIE_CLOUDFLARED_PATH";

export interface CloudflaredProcess {
  pid: number;
  executable: string;
  logPath: string;
}

export interface CloudflaredOptions {
  paths: RuntimePaths;
  runToken: string;
  executable?: string;
  spawnProcess?: typeof spawn;
  verifyExecutable?: (file: string, args: string[]) => Promise<void>;
}

export async function startCloudflared(options: CloudflaredOptions): Promise<CloudflaredProcess> {
  const executable = options.executable ?? process.env[CLOUDFLARED_PATH_ENV] ?? "cloudflared";
  await (options.verifyExecutable ?? verifyCloudflared)(executable, ["--version"]);
  await mkdir(options.paths.logsDir, { recursive: true, mode: 0o700 });
  const logPath = resolve(options.paths.logsDir, "tunnel-cloudflared.log");
  const logFd = openSync(logPath, "a", 0o600);
  let child: ChildProcess;
  try {
    child = (options.spawnProcess ?? spawn)(executable, ["tunnel", "run", "--token", options.runToken], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    }) as ChildProcess;
  } finally {
    closeSync(logFd);
  }
  if (!child.pid) throw new Error("cloudflared did not start.");
  child.unref();
  return { pid: child.pid, executable, logPath };
}

export function isCloudflaredRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function stopCloudflared(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function verifyCloudflared(file: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(file, args, { windowsHide: true, timeout: 10_000 });
  } catch {
    throw new Error(`cloudflared was not found or could not run: ${file}. Install cloudflared or set ${CLOUDFLARED_PATH_ENV}.`);
  }
}