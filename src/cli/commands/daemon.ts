import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { UserFacingError } from "../../runtime/errors.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

const DAEMON_STOP_TIMEOUT_MS = 30_000;
const DAEMON_STOP_POLL_INTERVAL_MS = 1000;

interface DaemonCommandOptions {
  argv?: string[];
  paths?: RuntimePaths;
  writeLine?: (message: string) => void;
  spawnProcess?: typeof spawn;
  isProcessRunning?: (pid: number) => boolean;
  killProcess?: (pid: number) => void;
  getProcessCommandLine?: (pid: number) => string[] | undefined;
  stopTimeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface DaemonState {
  pid: number;
  command: string;
  args: string[];
  startedAt: string;
  logPath: string;
}

export async function runDaemonCommand(optionsOrArgv: string[] | DaemonCommandOptions = process.argv): Promise<void> {
  const options = Array.isArray(optionsOrArgv) ? { argv: optionsOrArgv } : optionsOrArgv;
  const argv = options.argv ?? process.argv;
  const subcommand = argv[3] ?? "status";
  const paths = options.paths ?? getRuntimePaths();
  const writeLine = options.writeLine ?? console.log;

  if (subcommand === "start") {
    await startDaemon({ ...options, paths, writeLine });
    return;
  }

  if (subcommand === "stop") {
    await stopDaemon({ ...options, paths, writeLine });
    return;
  }

  if (subcommand === "restart") {
    await restartDaemon({ ...options, paths, writeLine });
    return;
  }

  if (subcommand === "status") {
    await showDaemonStatus({ ...options, paths, writeLine });
    return;
  }

  throw new UserFacingError("Usage: bestie daemon start|stop|restart|status", "DaemonUsageError");
}

async function startDaemon(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions): Promise<void> {
  const state = await readDaemonState(options.paths);
  const isRunning = options.isProcessRunning ?? defaultIsProcessRunning;
  if (state && isRunning(state.pid)) {
    options.writeLine(`Daemon already running with pid ${state.pid}.`);
    return;
  }

  const command = process.execPath;
  const cliEntry = process.argv[1] ? resolve(process.argv[1]) : resolve(options.paths.rootDir, "dist/cli/index.js");
  const args = [cliEntry, "telegram"];
  const logPath = resolve(options.paths.logsDir, "daemon.log");

  await mkdir(options.paths.logsDir, { recursive: true });
  const logFd = openSync(logPath, "a", 0o600);
  let child: ChildProcess;
  try {
    child = (options.spawnProcess ?? spawn)(command, args, {
      cwd: options.paths.rootDir,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    }) as ChildProcess;
  } finally {
    closeSync(logFd);
  }

  if (!child.pid) {
    throw new UserFacingError("Daemon process did not start.", "DaemonStartError");
  }

  child.unref();
  await writeDaemonState(options.paths, { pid: child.pid, command, args, startedAt: new Date().toISOString(), logPath });
  options.writeLine(`Daemon started with pid ${child.pid}.`);
  options.writeLine(`Logs: ${logPath}`);
}

async function stopDaemon(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions): Promise<void> {
  const state = await readDaemonState(options.paths);
  if (!state) {
    options.writeLine("Daemon is not running.");
    return;
  }

  const isRunning = options.isProcessRunning ?? defaultIsProcessRunning;
  if (isRunning(state.pid)) {
    const getProcessCommandLine = options.getProcessCommandLine ?? (options.isProcessRunning ? undefined : defaultGetProcessCommandLine);
    if (getProcessCommandLine) {
      const commandLine = getProcessCommandLine(state.pid);
      if (!commandLine || !isRecordedDaemonProcess(state, commandLine)) {
        await rm(getDaemonStatePath(options.paths), { force: true });
        options.writeLine(`Daemon state was stale; pid ${state.pid} belongs to a different process.`);
        return;
      }
    }

    try {
      (options.killProcess ?? defaultKillProcess)(state.pid);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ESRCH") {
        throw error;
      }
    }
    await waitForProcessExit(state.pid, isRunning, options.stopTimeoutMs ?? DAEMON_STOP_TIMEOUT_MS, options.sleep ?? sleep);
  }

  await rm(getDaemonStatePath(options.paths), { force: true });
  options.writeLine(`Daemon stopped: ${state.pid}.`);
}

async function restartDaemon(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions): Promise<void> {
  await stopDaemon(options);
  await startDaemon(options);
}

async function showDaemonStatus(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions): Promise<void> {
  const state = await readDaemonState(options.paths);
  if (!state) {
    options.writeLine("Daemon is stopped.");
    return;
  }

  const isRunning = options.isProcessRunning ?? defaultIsProcessRunning;
  options.writeLine(isRunning(state.pid) ? `Daemon is running with pid ${state.pid}.` : `Daemon pid ${state.pid} is stale.`);
  options.writeLine(`Logs: ${state.logPath}`);
}

async function readDaemonState(paths: RuntimePaths): Promise<DaemonState | undefined> {
  try {
    const parsed = JSON.parse(await readFile(getDaemonStatePath(paths), "utf8")) as unknown;
    if (!isDaemonState(parsed)) {
      return undefined;
    }
    return parsed;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function writeDaemonState(paths: RuntimePaths, state: DaemonState): Promise<void> {
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(getDaemonStatePath(paths), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function getDaemonStatePath(paths: RuntimePaths): string {
  return resolve(paths.appDir, "daemon.json");
}

function defaultIsProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function defaultKillProcess(pid: number): void {
  process.kill(pid, "SIGTERM");
}

function defaultGetProcessCommandLine(pid: number): string[] | undefined {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
  } catch {
    try {
      const output = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim();
      return output ? output.split(/\s+/) : undefined;
    } catch {
      return undefined;
    }
  }
}

function isRecordedDaemonProcess(state: DaemonState, commandLine: string[]): boolean {
  return commandLine[0] === state.command && state.args.every((arg, index) => commandLine[index + 1] === arg);
}

async function waitForProcessExit(pid: number, isProcessRunning: (pid: number) => boolean, timeoutMs: number, sleepFn: (milliseconds: number) => Promise<void>): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (isProcessRunning(pid)) {
    if (Date.now() >= deadline) {
      throw new UserFacingError(`Daemon pid ${pid} did not stop within ${timeoutMs}ms.`, "DaemonStopTimeoutError");
    }

    await sleepFn(Math.min(DAEMON_STOP_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
  }
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function isDaemonState(value: unknown): value is DaemonState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const state = value as Record<string, unknown>;
  return typeof state.pid === "number" && typeof state.command === "string" && Array.isArray(state.args) && state.args.every((arg) => typeof arg === "string") && typeof state.startedAt === "string" && typeof state.logPath === "string";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
