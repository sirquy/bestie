import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { UserFacingError } from "../../runtime/errors.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { maybePrintUpdateNotice } from "../update-notice.js";

const DAEMON_STOP_TIMEOUT_MS = 30_000;
const DAEMON_STOP_POLL_INTERVAL_MS = 1000;
export const DAEMON_CHANNELS = ["telegram", "zalo"] as const;

export type DaemonChannel = (typeof DAEMON_CHANNELS)[number];
type DaemonChannelSelection = DaemonChannel | "all";

interface DaemonCommandOptions {
  argv?: string[];
  paths?: RuntimePaths;
  writeLine?: (message: string) => void;
  printUpdateNotice?: (paths: RuntimePaths, writeLine: (message: string) => void) => Promise<void>;
  spawnProcess?: typeof spawn;
  isProcessRunning?: (pid: number) => boolean;
  killProcess?: (pid: number) => void;
  getProcessCommandLine?: (pid: number) => string[] | undefined;
  stopTimeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface DaemonState {
  channel?: DaemonChannel;
  pid: number;
  command: string;
  args: string[];
  startedAt: string;
  logPath: string;
}

export interface DaemonChannelStatus {
  channel: DaemonChannel;
  state: "running" | "stale" | "stopped";
  pid?: number;
  logPath?: string;
}

export async function runDaemonCommand(optionsOrArgv: string[] | DaemonCommandOptions = process.argv): Promise<void> {
  const options = Array.isArray(optionsOrArgv) ? { argv: optionsOrArgv } : optionsOrArgv;
  const argv = options.argv ?? process.argv;
  const subcommand = argv[3] ?? "status";
  const channels = getSelectedDaemonChannels(argv);
  const paths = options.paths ?? getRuntimePaths();
  const writeLine = options.writeLine ?? console.log;

  if (subcommand === "start") {
    await printDaemonUpdateNotice(options, paths, writeLine);
    for (const channel of channels) {
      await startDaemon({ ...options, paths, writeLine }, channel);
    }
    return;
  }

  if (subcommand === "stop") {
    for (const channel of channels) {
      await stopDaemon({ ...options, paths, writeLine }, channel);
    }
    return;
  }

  if (subcommand === "restart") {
    await printDaemonUpdateNotice(options, paths, writeLine);
    for (const channel of channels) {
      await restartDaemon({ ...options, paths, writeLine }, channel);
    }
    return;
  }

  if (subcommand === "status") {
    for (const channel of channels) {
      await showDaemonStatus({ ...options, paths, writeLine }, channel);
    }
    return;
  }

  throw new UserFacingError("Usage: bestie daemon start|stop|restart|status [--channel telegram|zalo|all]", "DaemonUsageError");
}

async function printDaemonUpdateNotice(options: DaemonCommandOptions, paths: RuntimePaths, writeLine: (message: string) => void): Promise<void> {
  if (options.printUpdateNotice) {
    await options.printUpdateNotice(paths, writeLine);
    return;
  }

  await maybePrintUpdateNotice({ paths, writeLine });
}

async function startDaemon(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions, channel: DaemonChannel): Promise<void> {
  const state = await readDaemonState(options.paths, channel);
  const isRunning = options.isProcessRunning ?? defaultIsProcessRunning;
  if (state && isRunning(state.pid)) {
    options.writeLine(`${formatDaemonChannel(channel)} daemon already running with pid ${state.pid}.`);
    return;
  }
  if (state) {
    await removeDaemonState(options.paths, channel);
  }

  const command = process.execPath;
  const cliEntry = process.argv[1] ? resolve(process.argv[1]) : resolve(options.paths.rootDir, "dist/cli/index.js");
  const args = [cliEntry, "channels", channel];
  const logPath = resolve(options.paths.logsDir, `daemon-${channel}.log`);

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
  await writeDaemonState(options.paths, channel, { channel, pid: child.pid, command, args, startedAt: new Date().toISOString(), logPath });
  options.writeLine(`${formatDaemonChannel(channel)} daemon started with pid ${child.pid}.`);
  options.writeLine(`Logs: ${logPath}`);
}

async function stopDaemon(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions, channel: DaemonChannel): Promise<void> {
  const state = await readDaemonState(options.paths, channel);
  if (!state) {
    options.writeLine(`${formatDaemonChannel(channel)} daemon is not running.`);
    return;
  }

  const isRunning = options.isProcessRunning ?? defaultIsProcessRunning;
  if (isRunning(state.pid)) {
    const getProcessCommandLine = options.getProcessCommandLine ?? (options.isProcessRunning ? undefined : defaultGetProcessCommandLine);
    if (getProcessCommandLine) {
      const commandLine = getProcessCommandLine(state.pid);
      if (!commandLine || !isRecordedDaemonProcess(state, commandLine)) {
        await removeDaemonState(options.paths, channel);
        options.writeLine(`${formatDaemonChannel(channel)} daemon state was stale; pid ${state.pid} belongs to a different process.`);
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

  await removeDaemonState(options.paths, channel);
  options.writeLine(`${formatDaemonChannel(channel)} daemon stopped: ${state.pid}.`);
}

async function restartDaemon(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions, channel: DaemonChannel): Promise<void> {
  await stopDaemon(options, channel);
  await startDaemon(options, channel);
}

async function showDaemonStatus(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions, channel: DaemonChannel): Promise<void> {
  const status = await getDaemonChannelStatus(options.paths, channel, options.isProcessRunning ?? defaultIsProcessRunning);
  if (status.state === "stopped") {
    options.writeLine(`${formatDaemonChannel(channel)} daemon is stopped.`);
    return;
  }

  options.writeLine(status.state === "running" ? `${formatDaemonChannel(channel)} daemon is running with pid ${status.pid}.` : `${formatDaemonChannel(channel)} daemon pid ${status.pid} is stale.`);
  options.writeLine(`Logs: ${status.logPath}`);
}

export async function getDaemonChannelStatus(paths: RuntimePaths, channel: DaemonChannel, isProcessRunning: (pid: number) => boolean = defaultIsProcessRunning): Promise<DaemonChannelStatus> {
  const state = await readDaemonState(paths, channel);
  if (!state) {
    return { channel, state: "stopped" };
  }

  return { channel, state: isProcessRunning(state.pid) ? "running" : "stale", pid: state.pid, logPath: state.logPath };
}

async function readDaemonState(paths: RuntimePaths, channel: DaemonChannel): Promise<DaemonState | undefined> {
  try {
    const parsed = JSON.parse(await readFile(getDaemonStatePath(paths, channel), "utf8")) as unknown;
    if (!isDaemonState(parsed)) {
      return undefined;
    }
    return parsed;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      if (channel === "telegram") {
        return readLegacyDaemonState(paths);
      }
      return undefined;
    }
    throw error;
  }
}

async function readLegacyDaemonState(paths: RuntimePaths): Promise<DaemonState | undefined> {
  try {
    const parsed = JSON.parse(await readFile(resolve(paths.appDir, "daemon.json"), "utf8")) as unknown;
    return isDaemonState(parsed) ? { ...parsed, channel: "telegram" } : undefined;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeDaemonState(paths: RuntimePaths, channel: DaemonChannel, state: DaemonState): Promise<void> {
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(getDaemonStatePath(paths, channel), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function getDaemonStatePath(paths: RuntimePaths, channel: DaemonChannel): string {
  return resolve(paths.appDir, `daemon-${channel}.json`);
}

async function removeDaemonState(paths: RuntimePaths, channel: DaemonChannel): Promise<void> {
  await rm(getDaemonStatePath(paths, channel), { force: true });
  if (channel === "telegram") {
    await rm(resolve(paths.appDir, "daemon.json"), { force: true });
  }
}

function getSelectedDaemonChannels(argv: string[]): DaemonChannel[] {
  const selection = getDaemonChannelSelection(argv);
  return selection === "all" ? [...DAEMON_CHANNELS] : [selection];
}

function getDaemonChannelSelection(argv: string[]): DaemonChannelSelection {
  const channelIndex = argv.indexOf("--channel");
  const value = channelIndex === -1 ? "telegram" : argv[channelIndex + 1];

  if (value === "all" || isDaemonChannel(value)) {
    return value;
  }

  throw new UserFacingError("Usage: bestie daemon start|stop|restart|status [--channel telegram|zalo|all]", "DaemonUsageError");
}

function isDaemonChannel(value: string | undefined): value is DaemonChannel {
  return DAEMON_CHANNELS.some((channel) => channel === value);
}

function formatDaemonChannel(channel: DaemonChannel): string {
  return channel[0].toUpperCase() + channel.slice(1);
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
  return (state.channel === undefined || isDaemonChannel(String(state.channel))) && typeof state.pid === "number" && typeof state.command === "string" && Array.isArray(state.args) && state.args.every((arg) => typeof arg === "string") && typeof state.startedAt === "string" && typeof state.logPath === "string";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
