import { execFile, spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
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

export interface CloudflaredInstallerOptions {
  executable?: string;
  verifyExecutable?: (file: string, args: string[]) => Promise<void>;
  runInstaller?: (command: string, args: string[]) => Promise<void>;
}

export interface CloudflaredStatus {
  available: boolean;
  executable: string;
  message?: string;
}

export async function startCloudflared(options: CloudflaredOptions): Promise<CloudflaredProcess> {
  const executable = options.executable ?? await ensureCloudflared();
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

export async function ensureCloudflared(options: CloudflaredInstallerOptions = {}): Promise<string> {
  const executable = options.executable ?? process.env[CLOUDFLARED_PATH_ENV] ?? resolveCloudflaredExecutable();
  const verify = options.verifyExecutable ?? verifyCloudflared;

  try {
    await verify(executable, ["--version"]);
    return executable;
  } catch {
    if (options.executable || process.env[CLOUDFLARED_PATH_ENV]) {
      throw new Error(`cloudflared was not found or could not run: ${executable}. Check ${CLOUDFLARED_PATH_ENV}.`);
    }
  }

  const install = getCloudflaredInstallCommand();
  await (options.runInstaller ?? runCloudflaredInstaller)(install.command, install.args);
  await verify(executable, ["--version"]);
  return executable;
}

export async function getCloudflaredStatus(options: Pick<CloudflaredInstallerOptions, "executable" | "verifyExecutable"> = {}): Promise<CloudflaredStatus> {
  const executable = options.executable ?? process.env[CLOUDFLARED_PATH_ENV] ?? resolveCloudflaredExecutable();
  try {
    await (options.verifyExecutable ?? verifyCloudflared)(executable, ["--version"]);
    return { available: true, executable };
  } catch (error) {
    return { available: false, executable, message: error instanceof Error ? error.message : "cloudflared could not run." };
  }
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

function getCloudflaredInstallCommand(): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return { command: "winget", args: ["install", "--id", "Cloudflare.cloudflared", "--exact", "--accept-package-agreements", "--accept-source-agreements"] };
  }
  if (process.platform === "darwin") {
    return { command: "brew", args: ["install", "cloudflared"] };
  }
  return process.getuid?.() === 0
    ? { command: "apt-get", args: ["install", "-y", "cloudflared"] }
    : { command: "sudo", args: ["-n", "apt-get", "install", "-y", "cloudflared"] };
}

function resolveCloudflaredExecutable(): string {
  if (process.platform !== "win32") return "cloudflared";

  const installedPath = "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe";
  return existsSync(installedPath) ? installedPath : "cloudflared";
}

async function runCloudflaredInstaller(command: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(command, args, { windowsHide: true, timeout: 120_000 });
  } catch {
    throw new Error(`cloudflared is required but automatic installation failed. Install cloudflared manually or set ${CLOUDFLARED_PATH_ENV}.`);
  }
}
