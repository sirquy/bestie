import { CHANNELS, type ChannelDescriptor } from "../../channels/registry.js";
import { hasConfiguredOwner, type OwnerUserIdConfig } from "../../channels/owner-policy.js";
import { loadConfig, type AppConfig } from "../../runtime/config.js";
import { runDoctor, type DoctorCheck, type DoctorReport } from "../../runtime/doctor.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { getDaemonChannelStatus, type DaemonChannel } from "./daemon.js";
import { runTelegramCommand } from "./telegram.js";
import { runZaloCommand } from "./zalo.js";
import { runZaloPersonalCommand } from "./zalo-personal.js";
import { badge, keyValue, rule, statusBadge, table, title } from "../ui.js";

type ChannelHandler = (argv?: string[]) => Promise<void> | void;

interface ChannelsCommandOptions {
  argv?: string[];
  paths?: RuntimePaths;
  writeLine?: (message: string) => void;
  isProcessRunning?: (pid: number) => boolean;
}

interface ChannelsDoctorChannelReport {
  id: DaemonChannel;
  checks: DoctorCheck[];
  issueCount: number;
}

interface ChannelsDoctorReport {
  channels: ChannelsDoctorChannelReport[];
  issueCount: number;
}

const channelHandlers: Record<string, ChannelHandler> = {
  telegram: runTelegramCommand,
  zalo: runZaloCommand,
  "zalo-personal": runZaloPersonalCommand,
};

export async function runChannelsCommand(optionsOrArgv: string[] | ChannelsCommandOptions = process.argv): Promise<void> {
  const options = Array.isArray(optionsOrArgv) ? { argv: optionsOrArgv } : optionsOrArgv;
  const argv = options.argv ?? process.argv;
  const paths = options.paths ?? getRuntimePaths();
  const writeLine = options.writeLine ?? console.log;
  const channelName = argv[3];

  if (!channelName || channelName === "list" || channelName === "status") {
    await showChannelsStatus({ paths, writeLine, isProcessRunning: options.isProcessRunning });
    return;
  }

  if (channelName === "doctor") {
    await runChannelsDoctor({ argv, paths, writeLine });
    return;
  }

  const handler = channelHandlers[channelName];

  if (!handler) {
    console.error(`Kênh không xác định: ${channelName}`);
    console.error("Các kênh hiện có: telegram, zalo, zalo-personal");
    console.error("Chạy `bestie channels --help` để xem danh sách kênh.");
    process.exitCode = 1;
    return;
  }

  await handler(argv);
}

async function runChannelsDoctor(options: Required<Pick<ChannelsCommandOptions, "argv" | "paths" | "writeLine">>): Promise<void> {
  const selectedChannels = getSelectedChannels(options.argv);
  const connect = options.argv.includes("--connect");
  const report = await runDoctor(options.paths, { connectTelegram: connect && selectedChannels.includes("telegram"), connectZalo: connect && selectedChannels.includes("zalo"), connectZaloPersonal: connect && selectedChannels.includes("zalo-personal") });
  const channelsReport = buildChannelsDoctorReport(report, selectedChannels);

  if (options.argv.includes("--json")) {
    options.writeLine(JSON.stringify(channelsReport, null, 2));
    setExitCodeForIssues(channelsReport.issueCount);
    return;
  }

  const checks = channelsReport.channels.flatMap((channel) => channel.checks);

  options.writeLine(title("Doctor kênh Bestie"));
  options.writeLine(rule());
  for (const check of checks) {
    options.writeLine(`${statusBadge(check.status)} ${check.name}: ${check.message}`);
    if (check.fix) {
      options.writeLine(`  Cách sửa: ${check.fix}`);
    }
  }

  if (checks.length === 0) {
    options.writeLine("Không có chẩn đoán kênh nào khớp với lựa chọn hiện tại.");
  }

  options.writeLine("");
  options.writeLine(keyValue("Tóm tắt", `tìm thấy ${channelsReport.issueCount} vấn đề`));
  setExitCodeForIssues(channelsReport.issueCount);
}

function buildChannelsDoctorReport(report: DoctorReport, selectedChannels: DaemonChannel[]): ChannelsDoctorReport {
  const channels = selectedChannels.map((channel) => {
    const checks = report.checks.filter((check) => isChannelDoctorCheck(check, [channel]));
    return { id: channel, checks, issueCount: checks.filter((check) => check.status === "fail").length };
  });
  return { channels, issueCount: channels.reduce((total, channel) => total + channel.issueCount, 0) };
}

function setExitCodeForIssues(issueCount: number): void {
  if (issueCount > 0) {
    process.exitCode = 1;
  }
}

function getSelectedChannels(argv: string[]): DaemonChannel[] {
  const channelIndex = argv.indexOf("--channel");
  const value = channelIndex === -1 ? "all" : argv[channelIndex + 1];

  if (value === "all") return ["telegram", "zalo", "zalo-personal"];
  if (value === "telegram" || value === "zalo" || value === "zalo-personal") return [value];

  throw new Error("Cách dùng: bestie channels doctor [--channel telegram|zalo|zalo-personal|all] [--connect] [--json]");
}

function isChannelDoctorCheck(check: DoctorCheck, selectedChannels: DaemonChannel[]): boolean {
  const name = check.name.toLowerCase();
  const message = check.message.toLowerCase();
  return selectedChannels.some((channel) => name.includes(channel) || message.includes(channel));
}

async function showChannelsStatus(options: Required<Pick<ChannelsCommandOptions, "paths" | "writeLine">> & Pick<ChannelsCommandOptions, "isProcessRunning">): Promise<void> {
  const config = await loadConfig(options.paths);
  options.writeLine(title("Kênh Bestie"));
  options.writeLine(rule());
  const rows: string[][] = [];

  for (const channel of CHANNELS) {
    const channelConfig = getChannelConfig(config, channel);
    const daemon = await getDaemonChannelStatus(options.paths, channel.id as DaemonChannel, options.isProcessRunning);
    rows.push(formatChannelStatusRow(channel, channelConfig, daemon));
  }

  for (const line of table(["Kênh", "Bật", "Owner", "Token env", "Daemon"], rows)) {
    options.writeLine(line);
  }
}

function getChannelConfig(config: AppConfig, channel: ChannelDescriptor): { enabled?: boolean; ownerUserId?: OwnerUserIdConfig; botTokenEnv?: string; sessionEnv?: string } | undefined {
  return config.channels?.[channel.configKey as keyof NonNullable<AppConfig["channels"]>];
}

function formatChannelStatusRow(channel: ChannelDescriptor, channelConfig: ReturnType<typeof getChannelConfig>, daemon: Awaited<ReturnType<typeof getDaemonChannelStatus>>): string[] {
  const enabled = channelConfig?.enabled ? badge("ON", "green") : badge("OFF", "gray");
  const owner = hasConfiguredOwner(channelConfig?.ownerUserId) ? badge("OWNER", "green") : badge("OWNER?", "yellow");
  const tokenEnv = channelConfig?.botTokenEnv ?? channelConfig?.sessionEnv ?? "missing";
  const daemonText = daemon.state === "running" ? `${badge("RUN", "green")} pid ${daemon.pid}` : daemon.state === "stale" ? `${badge("STALE", "yellow")} pid ${daemon.pid}` : badge("STOP", "gray");

  return [channel.displayName, enabled, owner, tokenEnv, daemonText];
}
