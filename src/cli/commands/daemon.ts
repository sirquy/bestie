import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
const DAEMON_START_SETTLE_MS = 750;
export const DAEMON_CHANNELS = ["telegram", "zalo", "cron"] as const;
const execFileAsync = promisify(execFile);
const BESTIE_APP_ICON_ICO_PATH = fileURLToPath(new URL("../../../assets/bestie-app-icon.ico", import.meta.url));

export type DaemonChannel = (typeof DAEMON_CHANNELS)[number];
type DaemonChannelSelection = DaemonChannel | "all";
type DaemonProcessKind = "channel" | "cron";
type ManagedDaemonTarget = DaemonChannel | "ui";

interface DaemonCommandOptions {
  argv?: string[];
  paths?: RuntimePaths;
  platform?: NodeJS.Platform;
  writeLine?: (message: string) => void;
  printUpdateNotice?: (paths: RuntimePaths, writeLine: (message: string) => void) => Promise<void>;
  spawnProcess?: typeof spawn;
  isProcessRunning?: (pid: number) => boolean;
  killProcess?: (pid: number) => void;
  getProcessCommandLine?: (pid: number) => string[] | undefined;
  listProcessCommandLines?: () => ProcessCommandLineSnapshot[];
  execFile?: (file: string, args: string[]) => Promise<void>;
  serviceRunner?: (channel: DaemonChannel, options: { paths: RuntimePaths; writeLine: (message: string) => void }) => Promise<void>;
  stopTimeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export type ServiceCommandOptions = DaemonCommandOptions;

interface DaemonState {
  channel?: ManagedDaemonTarget;
  pid: number;
  command: string;
  args: string[];
  startedAt: string;
  logPath: string;
}

interface ProcessCommandLineSnapshot {
  pid: number;
  commandLine: string;
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
    await startUiDaemon({ ...options, paths, writeLine });
    return;
  }

  if (subcommand === "stop") {
    for (const channel of channels) {
      await stopDaemon({ ...options, paths, writeLine }, channel);
    }
    await stopUiDaemon({ ...options, paths, writeLine });
    return;
  }

  if (subcommand === "restart") {
    await printDaemonUpdateNotice(options, paths, writeLine);
    for (const channel of channels) {
      await restartDaemon({ ...options, paths, writeLine }, channel);
    }
    await restartUiDaemon({ ...options, paths, writeLine });
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
    await installService({ ...options, paths, writeLine });
    return;
  }

  if (subcommand === "uninstall") {
    await uninstallService({ ...options, paths, writeLine });
    return;
  }

  if (subcommand === "status") {
    await showServiceStatus({ ...options, paths, writeLine });
    return;
  }

  if (subcommand === "restart") {
    await restartService({ ...options, paths, writeLine });
    return;
  }

  if (subcommand === "run") {
    await runServiceRuntime({ ...options, paths, writeLine });
    return;
  }

  throw new UserFacingError("Cách dùng: bestie service install|uninstall|status|restart", "ServiceUsageError");
}

async function installSystemdUserService(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions): Promise<void> {
  assertLinuxSystemdUserServiceSupported(options.platform);
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
  assertLinuxSystemdUserServiceSupported(options.platform);
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

async function installService(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions): Promise<void> {
  if ((options.platform ?? process.platform) === "win32") {
    await installWindowsStartupCommand(options);
    return;
  }

  await installSystemdUserService(options);
}

async function uninstallService(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions): Promise<void> {
  if ((options.platform ?? process.platform) === "win32") {
    await uninstallWindowsStartupCommand(options);
    return;
  }

  await uninstallSystemdUserService(options);
}

async function showServiceStatus(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions): Promise<void> {
  if ((options.platform ?? process.platform) === "win32") {
    const commandPath = getWindowsStartupCommandPath();
    try {
      await readFile(commandPath, "utf8");
      options.writeLine(`Status: Windows startup command installed at ${commandPath}`);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
      options.writeLine(`Status: Windows startup command is not installed at ${commandPath}`);
    }
    return;
  }

  assertLinuxSystemdUserServiceSupported(options.platform);
  options.writeLine(`Status: systemctl --user status ${getSystemdServiceName()}`);
}

async function restartService(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions): Promise<void> {
  if ((options.platform ?? process.platform) === "win32") {
    const commandPath = await writeWindowsStartupCommand(options);
    await runWindowsDaemonCommand(options, "restart");
    options.writeLine(`${badge("RUN", "green")} Restarted Bestie Windows startup runtime.`);
    options.writeLine(`Startup: ${commandPath}`);
    return;
  }

  assertLinuxSystemdUserServiceSupported(options.platform);
  const run = options.execFile ?? runExecFile;
  await run("systemctl", ["--user", "restart", getSystemdServiceName()]);
  options.writeLine(`${badge("RUN", "green")} Restarted Bestie systemd user service.`);
}

async function installWindowsStartupCommand(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions): Promise<void> {
  const commandPath = await writeWindowsStartupCommand(options);
  await runWindowsDaemonCommand(options, "start");

  options.writeLine(`${badge("RUN", "green")} Installed and started Bestie Windows startup command.`);
  options.writeLine(`Startup: ${commandPath}`);
  options.writeLine("Targets: Telegram, Zalo, Cron, Web UI");
}

async function writeWindowsStartupCommand(options: Required<Pick<DaemonCommandOptions, "paths">>): Promise<string> {
  const cliEntry = process.argv[1] ? resolve(process.argv[1]) : resolve(options.paths.rootDir, "dist/cli/index.js");
  const commandPath = getWindowsStartupCommandPath();
  const iconPath = getWindowsStartupIconPath();

  await mkdir(dirname(commandPath), { recursive: true });
  await copyFile(BESTIE_APP_ICON_ICO_PATH, iconPath);
  await createWindowsStartupShortcut({ shortcutPath: commandPath, nodePath: process.execPath, cliEntry, workingDirectory: options.paths.rootDir, iconPath });
  await rm(getWindowsLegacyStartupCommandPath(), { force: true });
  return commandPath;
}

async function uninstallWindowsStartupCommand(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions): Promise<void> {
  await runWindowsDaemonCommand(options, "stop");
  await rm(getWindowsStartupCommandPath(), { force: true });
  await rm(getWindowsStartupIconPath(), { force: true });
  await rm(getWindowsLegacyStartupCommandPath(), { force: true });
  options.writeLine(`${badge("STOP", "gray")} Removed Bestie Windows startup command.`);
}

async function createWindowsStartupShortcut(options: { shortcutPath: string; nodePath: string; cliEntry: string; workingDirectory: string; iconPath: string }): Promise<void> {
  const shortcutArgs = `"${options.cliEntry.replace(/"/g, "\"\"")}" daemon start --channel all`;
  const script = [
    "$shell = New-Object -ComObject WScript.Shell",
    `$link = $shell.CreateShortcut(${powerShellString(options.shortcutPath)})`,
    `$link.TargetPath = ${powerShellString(options.nodePath)}`,
    `$link.Arguments = ${powerShellString(shortcutArgs)}`,
    `$link.WorkingDirectory = ${powerShellString(options.workingDirectory)}`,
    `$link.IconLocation = ${powerShellString(options.iconPath)}`,
    "$link.Description = 'Bestie local agent runtime'",
    "$link.Save()",
  ].join("; ");
  await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true });
}

function powerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function runWindowsDaemonCommand(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions, action: "start" | "stop" | "restart"): Promise<void> {
  const cliEntry = process.argv[1] ? resolve(process.argv[1]) : resolve(options.paths.rootDir, "dist/cli/index.js");
  await (options.execFile ?? runExecFile)(process.execPath, [cliEntry, "daemon", action, "--channel", "all"]);
}

async function runServiceChannel(channel: DaemonChannel, options: { paths: RuntimePaths; writeLine: (message: string) => void }): Promise<void> {
  const paths = options.paths;
  const writeLine = options.writeLine;

  // Record a daemon state file for this channel so the UI can detect it's running
  // even when started under systemd (the service runtime runs channels in-process).
  const cliEntry = process.argv[1] ? resolve(process.argv[1]) : resolve(paths.rootDir, "dist/cli/index.js");
  const command = process.execPath;
  const args = getDaemonArgs(cliEntry, channel);
  const logPath = resolve(paths.logsDir, `daemon-${channel}.log`);

  await mkdir(paths.logsDir, { recursive: true });
  await writeDaemonState(paths, channel, { channel, pid: process.pid, command, args, startedAt: new Date().toISOString(), logPath });

  try {
    if (channel === "cron") {
      await runCronCommand({ argv: ["node", "bestie", "cron", "run"], paths, writeLine });
      return;
    }

    if (channel === "telegram") {
      await runTelegramCommand({ argv: ["node", "bestie", "channels", "telegram"], paths, writeLine });
      return;
    }

    await runZaloCommand({ argv: ["node", "bestie", "channels", "zalo"], paths, writeLine });
  } finally {
    await removeDaemonState(paths, channel);
  }
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

async function startUiDaemon(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions): Promise<void> {
  const state = await readUiDaemonState(options.paths);
  const isRunning = options.isProcessRunning ?? defaultIsProcessRunning;
  if (state && isRunning(state.pid)) {
    options.writeLine(`${badge("RUN", "green")} Web UI đang chạy sẵn với pid ${state.pid}.`);
    return;
  }
  if (state) {
    await removeUiDaemonState(options.paths);
  }
  await stopOrphanDaemonProcesses(options, "ui");

  const command = process.execPath;
  const cliEntry = process.argv[1] ? resolve(process.argv[1]) : resolve(options.paths.rootDir, "dist/cli/index.js");
  const args = [cliEntry, "ui", "--no-open"];
  const logPath = resolve(options.paths.logsDir, "daemon-ui.log");

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
    throw new UserFacingError("Tiến trình Web UI không khởi động được.", "DaemonUiStartError");
  }

  child.unref();
  await (options.sleep ?? sleep)(DAEMON_START_SETTLE_MS);
  if (!isRunning(child.pid)) {
    await removeUiDaemonState(options.paths);
    throw new UserFacingError(`Web UI exited immediately after startup. Check ${logPath}.`, "DaemonUiStartError");
  }
  await writeUiDaemonState(options.paths, { channel: "ui", pid: child.pid, command, args, startedAt: new Date().toISOString(), logPath });
  options.writeLine(`${badge("UI", "green")} Web UI đã khởi động với pid ${child.pid}.`);
  options.writeLine(`Log: ${logPath}`);
}

async function stopDaemon(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions, channel: DaemonChannel): Promise<void> {
  const state = await readDaemonState(options.paths, channel);
  if (!state) {
    const stopped = await stopOrphanDaemonProcesses(options, channel);
    if (stopped > 0) return;
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

async function stopUiDaemon(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions): Promise<void> {
  const state = await readUiDaemonState(options.paths);
  if (!state) {
    const stopped = await stopOrphanDaemonProcesses(options, "ui");
    if (stopped > 0) return;
    options.writeLine(`${badge("STOP", "gray")} Web UI hiện không chạy.`);
    return;
  }

  const isRunning = options.isProcessRunning ?? defaultIsProcessRunning;
  if (isRunning(state.pid)) {
    const getProcessCommandLine = options.getProcessCommandLine ?? (options.isProcessRunning ? undefined : defaultGetProcessCommandLine);
    if (getProcessCommandLine) {
      const commandLine = getProcessCommandLine(state.pid);
      if (!commandLine || !isRecordedDaemonProcess(state, commandLine)) {
        await removeUiDaemonState(options.paths);
        options.writeLine(`${badge("STALE", "yellow")} Trạng thái Web UI đã cũ; pid ${state.pid} thuộc tiến trình khác.`);
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

  await removeUiDaemonState(options.paths);
  options.writeLine(`${badge("STOP", "gray")} Web UI đã dừng: ${state.pid}.`);
}

async function stopOrphanDaemonProcesses(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions, target: ManagedDaemonTarget): Promise<number> {
  if (!options.listProcessCommandLines && options.isProcessRunning) return 0;

  const listProcesses = options.listProcessCommandLines ?? defaultListProcessCommandLines;
  const isRunning = options.isProcessRunning ?? defaultIsProcessRunning;
  const killProcess = options.killProcess ?? defaultKillProcess;
  const snapshots = listProcesses().filter((snapshot) => snapshot.pid !== process.pid && isBestieManagedProcessCommand(target, snapshot.commandLine));

  for (const snapshot of snapshots) {
    try {
      killProcess(snapshot.pid);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ESRCH") throw error;
    }
    await waitForProcessExit(snapshot.pid, isRunning, options.stopTimeoutMs ?? DAEMON_STOP_TIMEOUT_MS, options.sleep ?? sleep);
  }

  if (snapshots.length > 0) {
    options.writeLine(`${badge("STOP", "gray")} Stopped ${snapshots.length} orphan Bestie ${target === "ui" ? "Web UI" : formatDaemonChannel(target)} process(es).`);
  }
  return snapshots.length;
}

async function restartDaemon(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions, channel: DaemonChannel): Promise<void> {
  await stopDaemon(options, channel);
  await startDaemon(options, channel);
}

async function restartUiDaemon(options: Required<Pick<DaemonCommandOptions, "paths" | "writeLine">> & DaemonCommandOptions): Promise<void> {
  await stopUiDaemon(options);
  await startUiDaemon(options);
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

async function readUiDaemonState(paths: RuntimePaths): Promise<DaemonState | undefined> {
  try {
    const parsed = JSON.parse(await readFile(getUiDaemonStatePath(paths), "utf8")) as unknown;
    return isDaemonState(parsed) ? parsed : undefined;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeUiDaemonState(paths: RuntimePaths, state: DaemonState): Promise<void> {
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(getUiDaemonStatePath(paths), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function removeUiDaemonState(paths: RuntimePaths): Promise<void> {
  await rm(getUiDaemonStatePath(paths), { force: true });
}

function getDaemonStatePath(paths: RuntimePaths, channel: DaemonChannel): string {
  return resolve(paths.appDir, `daemon-${channel}.json`);
}

function getUiDaemonStatePath(paths: RuntimePaths): string {
  return resolve(paths.appDir, "daemon-ui.json");
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
  const serviceCmd = `${systemdEscape(options.nodePath)} ${systemdEscape(options.cliEntry)} service run`;
  const uiCmd = `${systemdEscape(options.nodePath)} ${systemdEscape(options.cliEntry)} ui`;
  // Start both the service runtime and the web UI in the same unit using a small shell wrapper.
  // This keeps the existing behaviour (service runtime) and also launches the UI alongside it.
  // The shell waits for child processes so systemd tracks the wrapper process.
  // Launch both processes and exit if either one stops so systemd can restart both.
  // Uses bash's `wait -n` to detect the first exited child, then kills the other and exits.
  const execLine = `/bin/bash -lc '${serviceCmd} & pid1=$!; ${uiCmd} & pid2=$!; wait -n "$pid1" "$pid2"; kill "$pid1" "$pid2" 2>/dev/null || true; wait'`;
  return `[Unit]
Description=Bestie service runtime (channels + web UI)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemdEscape(options.rootDir)}
ExecStart=${execLine}
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

function getWindowsStartupCommandPath(): string {
  const appData = process.env.APPDATA ?? resolve(homedir(), "AppData", "Roaming");
  return resolve(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Bestie.lnk");
}

function getWindowsStartupIconPath(): string {
  return resolve(dirname(getWindowsStartupCommandPath()), "Bestie.ico");
}

function getWindowsLegacyStartupCommandPath(): string {
  return resolve(dirname(getWindowsStartupCommandPath()), "Bestie.cmd");
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

function assertLinuxSystemdUserServiceSupported(platform: NodeJS.Platform = process.platform): void {
  if (platform !== "linux") {
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

function defaultListProcessCommandLines(): ProcessCommandLineSnapshot[] {
  if (process.platform === "win32") {
    try {
      const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"], { encoding: "utf8", windowsHide: true }).trim();
      if (!output) return [];
      const parsed = JSON.parse(output) as unknown;
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows.flatMap((row) => {
        if (typeof row !== "object" || row === null) return [];
        const record = row as Record<string, unknown>;
        return typeof record.ProcessId === "number" && typeof record.CommandLine === "string" ? [{ pid: record.ProcessId, commandLine: record.CommandLine }] : [];
      });
    } catch {
      return [];
    }
  }

  try {
    const output = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
    return output.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      return match ? [{ pid: Number(match[1]), commandLine: match[2] ?? "" }] : [];
    });
  } catch {
    return [];
  }
}

function isBestieManagedProcessCommand(target: ManagedDaemonTarget, commandLine: string): boolean {
  const normalized = commandLine.replace(/\\/g, "/").replace(/\s+/g, " ").toLowerCase();
  if (!normalized.includes("bestie-agent") && !normalized.includes("/dist/cli/index.js")) return false;

  if (target === "ui") return /\sui(?:\s|$)/.test(normalized);
  if (target === "cron") return /\scron\s+run(?:\s|$)/.test(normalized);
  return new RegExp(`\\schannels\\s+${target}(?:\\s|$)`).test(normalized);
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
  return (state.channel === undefined || isManagedDaemonTarget(String(state.channel))) && typeof state.pid === "number" && typeof state.command === "string" && Array.isArray(state.args) && state.args.every((arg) => typeof arg === "string") && typeof state.startedAt === "string" && typeof state.logPath === "string";
}

function isManagedDaemonTarget(value: string | undefined): value is ManagedDaemonTarget {
  return value === "ui" || isDaemonChannel(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
