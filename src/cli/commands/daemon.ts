import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { UserFacingError } from "../../runtime/errors.js";
import { loadConfig, type AppConfig } from "../../runtime/config.js";
import { loadEnvFile } from "../../runtime/env.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { maybePrintUpdateNotice } from "../update-notice.js";
import { badge } from "../ui.js";
import { runCronCommand } from "./cron.js";
import { runTelegramCommand } from "./telegram.js";
import { runZaloCommand } from "./zalo.js";

const DAEMON_STOP_TIMEOUT_MS = 30_000;
const DAEMON_STOP_POLL_INTERVAL_MS = 1000;
export const DAEMON_CHANNELS = ["telegram", "zalo", "cron"] as const;
const execFileAsync = promisify(execFile);

export type DaemonChannel = (typeof DAEMON_CHANNELS)[number];
type DaemonChannelSelection = DaemonChannel | "all";
type DaemonProcessKind = "channel" | "cron";

interface DaemonCommandOptions {
  argv?: string[];
  paths?: RuntimePaths;
  writeLine?: (message: string) => void;
  printUpdateNotice?: (paths: RuntimePaths, writeLine: (message: string) => void) => Promise<void>;
  spawnProcess?: typeof spawn;
  isProcessRunning?: (pid: number) => boolean;
  killProcess?: (pid: number) => void;
  getProcessCommandLine?: (pid: number) => string[] | undefined;
  execFile?: (file: string, args: string[]) => Promise<void>;
  serviceRunner?: (channel: DaemonChannel, options: { paths: RuntimePaths; writeLine: (message: string) => void }) => Promise<void>;
  stopTimeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export type ServiceCommandOptions = DaemonCommandOptions;

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

  throw new UserFacingError("Cách dùng: bestie daemon start|stop|restart|status [--channel telegram|zalo|cron|all]", "DaemonUsageError");
}

export async function runServiceCommand(optionsOrArgv: string[] | ServiceCommandOptions = process.argv): Promise<void> {
  const options = Array.isArray(optionsOrArgv) ? { argv: optionsOrArgv } : optionsOrArgv;
  const argv = options.argv ?? process.argv;
  const subcommand = argv[3] ?? "status";
  const paths = options.paths ?? getRuntimePaths();
  const writeLine = options.writeLine ?? console.log;

  if (subcommand === "install") {
    await installSystemdUserService({ ...options, paths, writeLine });
    return;
  }

  if (subcommand === "uninstall") {
    await uninstallSystemdUserService({ ...options, paths, writeLine });
    return;
  }

  if (subcommand === "status") {
    writeLine(`Trạng thái: systemctl --user status ${getSystemdServiceName()}`);
    return;
  }

  if (subcommand === "restart") {
    assertLinuxSystemdUserServiceSupported();
    const run = options.execFile ?? runExecFile;
    await run("systemctl", ["--user", "restart", getSystemdServiceName()]);
    writeLine(`${badge("RUN", "green")} Đã restart systemd user service của Bestie.`);
    return;
  }

  if (subcommand === "run") {
    await runServiceRuntime({ ...options, paths, writeLine });
    return;
  }

  throw new UserFacingError("Cách dùng: bestie service install|uninstall|status|restart", "ServiceUsageError");
}

async function installSystemdUserService(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions): Promise<void> {
  assertLinuxSystemdUserServiceSupported();
  const cliEntry = process.argv[1] ? resolve(process.argv[1]) : resolve(options.paths.rootDir, "dist/cli/index.js");
  const run = options.execFile ?? runExecFile;
  const channels = await getInstallableServiceChannels(options.paths);
  const serviceName = getSystemdServiceName();
  const servicePath = getSystemdUserServicePath(serviceName);

  await mkdir(dirname(servicePath), { recursive: true });
  await writeFile(servicePath, buildSystemdUserService({ nodePath: process.execPath, cliEntry, rootDir: options.paths.rootDir }), { mode: 0o600 });
  await removeLegacySystemdUserServices();

  await run("systemctl", ["--user", "daemon-reload"]);
  await run("systemctl", ["--user", "enable", "--now", serviceName]);

  options.writeLine(`${badge("RUN", "green")} Đã cài và khởi động systemd user service của Bestie.`);
  options.writeLine(`Service: ${serviceName}`);
  options.writeLine(`Targets: ${channels.map(formatDaemonChannel).join(", ")}`);
  options.writeLine(`Trạng thái: systemctl --user status ${serviceName}`);
}

async function uninstallSystemdUserService(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions): Promise<void> {
  assertLinuxSystemdUserServiceSupported();
  const run = options.execFile ?? runExecFile;
  const serviceNames = [getSystemdServiceName(), ...DAEMON_CHANNELS.map(getLegacySystemdServiceName)];

  for (const serviceName of serviceNames) {
    try {
      await run("systemctl", ["--user", "disable", "--now", serviceName]);
    } catch (error) {
      if (!isMissingSystemdUnitError(error)) {
        throw error;
      }
    }
  }
  for (const serviceName of serviceNames) {
    await rm(getSystemdUserServicePath(serviceName), { force: true });
  }
  await run("systemctl", ["--user", "daemon-reload"]);

  options.writeLine(`${badge("STOP", "gray")} Đã gỡ systemd user service của Bestie.`);
}

function isMissingSystemdUnitError(error: unknown): boolean {
  return error instanceof Error && /Unit file .* does not exist|not loaded|not found/i.test(error.message);
}

async function getInstallableServiceChannels(paths: RuntimePaths): Promise<DaemonChannel[]> {
  const config = await loadConfig(paths);
  const envValues = await loadEnvFile(paths);
  return DAEMON_CHANNELS.filter((channel) => channel === "cron" || isChannelServiceConfigured(channel, config, envValues));
}

async function runServiceRuntime(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions): Promise<void> {
  const channels = await getInstallableServiceChannels(options.paths);
  options.writeLine(`${badge("RUN", "green")} Bestie service runtime đang chạy: ${channels.map(formatDaemonChannel).join(", ")}.`);
  await Promise.all(channels.map((channel) => (options.serviceRunner ?? runServiceChannel)(channel, options)));
}

async function runServiceChannel(channel: DaemonChannel, options: { paths: RuntimePaths; writeLine: (message: string) => void }): Promise<void> {
  if (channel === "cron") {
    await runCronCommand({ argv: ["node", "bestie", "cron", "run"], paths: options.paths, writeLine: options.writeLine });
    return;
  }

  if (channel === "telegram") {
    await runTelegramCommand({ argv: ["node", "bestie", "channels", "telegram"], paths: options.paths, writeLine: options.writeLine });
    return;
  }

  await runZaloCommand({ argv: ["node", "bestie", "channels", "zalo"], paths: options.paths, writeLine: options.writeLine });
}

function isChannelServiceConfigured(channel: DaemonChannel, config: AppConfig, envValues: Record<string, string>): boolean {
  if (channel === "cron") {
    return true;
  }

  const channelConfig = config.channels?.[channel];
  if (!channelConfig?.enabled) {
    return false;
  }

  return Boolean(process.env[channelConfig.botTokenEnv] ?? envValues[channelConfig.botTokenEnv]);
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
    options.writeLine(`${badge("RUN", "green")} Daemon ${formatDaemonChannel(channel)} đang chạy sẵn với pid ${state.pid}.`);
    return;
  }
  if (state) {
    await removeDaemonState(options.paths, channel);
  }

  const command = process.execPath;
  const cliEntry = process.argv[1] ? resolve(process.argv[1]) : resolve(options.paths.rootDir, "dist/cli/index.js");
  const args = getDaemonArgs(cliEntry, channel);
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
    throw new UserFacingError("Tiến trình daemon không khởi động được.", "DaemonStartError");
  }

  child.unref();
  await writeDaemonState(options.paths, channel, { channel, pid: child.pid, command, args, startedAt: new Date().toISOString(), logPath });
  options.writeLine(`${badge("RUN", "green")} Daemon ${formatDaemonChannel(channel)} đã khởi động với pid ${child.pid}.`);
  options.writeLine(`Log: ${logPath}`);
}

async function stopDaemon(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions, channel: DaemonChannel): Promise<void> {
  const state = await readDaemonState(options.paths, channel);
  if (!state) {
    options.writeLine(`${badge("STOP", "gray")} Daemon ${formatDaemonChannel(channel)} hiện không chạy.`);
    return;
  }

  const isRunning = options.isProcessRunning ?? defaultIsProcessRunning;
  if (isRunning(state.pid)) {
    const getProcessCommandLine = options.getProcessCommandLine ?? (options.isProcessRunning ? undefined : defaultGetProcessCommandLine);
    if (getProcessCommandLine) {
      const commandLine = getProcessCommandLine(state.pid);
      if (!commandLine || !isRecordedDaemonProcess(state, commandLine)) {
        await removeDaemonState(options.paths, channel);
        options.writeLine(`${badge("STALE", "yellow")} Trạng thái daemon ${formatDaemonChannel(channel)} đã cũ; pid ${state.pid} thuộc tiến trình khác.`);
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
  options.writeLine(`${badge("STOP", "gray")} Daemon ${formatDaemonChannel(channel)} đã dừng: ${state.pid}.`);
}

async function restartDaemon(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions, channel: DaemonChannel): Promise<void> {
  await stopDaemon(options, channel);
  await startDaemon(options, channel);
}

async function showDaemonStatus(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions, channel: DaemonChannel): Promise<void> {
  const status = await getDaemonChannelStatus(options.paths, channel, options.isProcessRunning ?? defaultIsProcessRunning);
  if (status.state === "stopped") {
    options.writeLine(`${badge("STOP", "gray")} Daemon ${formatDaemonChannel(channel)} đang dừng.`);
    return;
  }

  options.writeLine(status.state === "running" ? `${badge("RUN", "green")} Daemon ${formatDaemonChannel(channel)} đang chạy với pid ${status.pid}.` : `${badge("STALE", "yellow")} Pid daemon ${formatDaemonChannel(channel)} ${status.pid} đã cũ.`);
  options.writeLine(`Log: ${status.logPath}`);
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

  throw new UserFacingError("Cách dùng: bestie daemon start|stop|restart|status [--channel telegram|zalo|cron|all]", "DaemonUsageError");
}

function isDaemonChannel(value: string | undefined): value is DaemonChannel {
  return DAEMON_CHANNELS.some((channel) => channel === value);
}

function formatDaemonChannel(channel: DaemonChannel): string {
  return channel[0].toUpperCase() + channel.slice(1);
}

function getDaemonArgs(cliEntry: string, channel: DaemonChannel): string[] {
  const kind: DaemonProcessKind = channel === "cron" ? "cron" : "channel";
  return kind === "cron" ? [cliEntry, "cron", "run"] : [cliEntry, "channels", channel];
}

function getSystemdUserServicePath(serviceName: string): string {
  return resolve(process.env.XDG_CONFIG_HOME ?? resolve(homedir(), ".config"), "systemd/user", serviceName);
}

function buildSystemdUserService(options: { nodePath: string; cliEntry: string; rootDir: string }): string {
  const args = [options.cliEntry, "service", "run"];
  return `[Unit]
Description=Bestie service runtime
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemdEscape(options.rootDir)}
ExecStart=${systemdEscape(options.nodePath)} ${args.map(systemdEscape).join(" ")}
Restart=on-failure
RestartSec=5
TimeoutStopSec=45

[Install]
WantedBy=default.target
`;
}

function getSystemdServiceName(): string {
  return "bestie.service";
}

function getLegacySystemdServiceName(channel: DaemonChannel): string {
  return `bestie-${channel}.service`;
}

async function removeLegacySystemdUserServices(): Promise<void> {
  await Promise.all(DAEMON_CHANNELS.map((channel) => rm(getSystemdUserServicePath(getLegacySystemdServiceName(channel)), { force: true })));
}

function systemdEscape(value: string): string {
  return value.includes(" ") || value.includes("\t") ? `"${value.replace(/(["\\$`])/g, "\\$1")}"` : value;
}

function assertLinuxSystemdUserServiceSupported(): void {
  if (process.platform !== "linux") {
    throw new UserFacingError("systemd user service chỉ được hỗ trợ trên Linux. Trên nền tảng này, hãy dùng `bestie daemon start --channel all`.", "DaemonSystemdUnsupportedError");
  }
}

async function runExecFile(file: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(file, args, { windowsHide: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UserFacingError(`Không chạy được ${file} ${args.join(" ")}: ${message}`, "DaemonSystemdCommandError");
  }
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
      throw new UserFacingError(`Daemon pid ${pid} không dừng trong ${timeoutMs}ms.`, "DaemonStopTimeoutError");
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
