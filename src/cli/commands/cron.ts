import { stdout as output } from "node:process";

import { loadConfig } from "../../runtime/config.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { SqliteMemoryStore, type CronSchedule } from "../../memory/sqlite-store.js";
import { CronExecutor } from "../../cron/executor.js";
import { isCronReportDestination } from "../../cron/channel-commands.js";
import { computeNextRun, validateSchedule } from "../../cron/scheduler.js";
import { badge, bold, color, dim, title } from "../ui.js";
import { createCliQuestioner } from "../prompt.js";

const VALID_SCHEDULE_TYPES = ["interval", "cron_expr", "once"];

export interface CronCommandOptions {
  argv?: string[];
  paths?: RuntimePaths;
  writeLine?: (message: string) => void;
}

export async function runCronCommand(optionsOrArgv: string[] | CronCommandOptions = process.argv): Promise<void> {
  const options = Array.isArray(optionsOrArgv) ? { argv: optionsOrArgv } : optionsOrArgv;
  const paths = options.paths ?? getRuntimePaths();
  const writeLine = options.writeLine ?? console.log;
  const argv = options.argv ?? process.argv;
  const subcommand = argv[3] ?? "list";

  if (subcommand === "--help" || subcommand === "-h") {
    printCronHelp(writeLine);
    return;
  }

  if (subcommand === "list") {
    await runCronList(paths, writeLine);
    return;
  }

  if (subcommand === "add") {
    await runCronAdd(argv, paths, writeLine);
    return;
  }

  if (subcommand === "remove" || subcommand === "rm") {
    await runCronRemove(argv, paths, writeLine);
    return;
  }

  if (subcommand === "update" || subcommand === "edit") {
    await runCronUpdate(argv, paths, writeLine);
    return;
  }

  if (subcommand === "toggle") {
    await runCronToggle(argv, paths, writeLine);
    return;
  }

  if (subcommand === "trigger" || subcommand === "run-now") {
    await runCronTrigger(argv, paths, writeLine);
    return;
  }

  if (subcommand === "logs") {
    await runCronLogs(argv, paths, writeLine);
    return;
  }

  if (subcommand === "run") {
    await runCronDaemon(paths, writeLine);
    return;
  }

  writeLine(`Lệnh cron không xác định: ${subcommand}`);
  printCronHelp(writeLine);
  process.exitCode = 1;
}

function printCronHelp(writeLine: (message: string) => void): void {
  writeLine(`Bestie Cron

Usage:
  bestie cron list           Liệt kê toàn bộ lịch cron
  bestie cron add            Tạo lịch cron mới (interactive)
  bestie cron update <id>    Cập nhật lịch cron theo ID
  bestie cron trigger <id>   Chạy ngay một lịch cron theo ID
  bestie cron remove <id>    Xóa lịch cron theo ID
  bestie cron toggle <id>    Bật/tắt một lịch cron
  bestie cron logs [id]      Xem log chạy cron gần đây
  bestie cron run            Chạy scheduler cron cho tới khi bị dừng

Kiểu lịch:
  interval    Lặp theo khoảng thời gian, ví dụ "30m", "1h", "2d"
  cron_expr   Biểu thức cron 5 trường, ví dụ "0 8 * * *"
  once        Chạy một lần tại timestamp ISO, ví dụ "2026-12-25T08:00:00Z"`);
}

async function runCronDaemon(paths: RuntimePaths, writeLine: (message: string) => void): Promise<void> {
  const config = await loadConfig(paths);
  const executor = new CronExecutor({ config, paths });
  let stop: (() => void) | undefined;

  const stopped = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const onSignal = () => stop?.();

  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  executor.start();
  writeLine("Scheduler cron đã bắt đầu. Nhấn Ctrl+C để dừng.");

  try {
    await stopped;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    executor.stop();
  }
}

async function runCronList(paths: RuntimePaths, writeLine: (message: string) => void): Promise<void> {
  const config = await loadConfig(paths);
  const store = await SqliteMemoryStore.open(paths);

  try {
    const schedules = store.listCronSchedules();

    writeLine(title("Lịch cron Bestie"));

    if (schedules.length === 0) {
      writeLine(dim("Chưa có lịch cron nào. Dùng `bestie cron add` để tạo lịch mới."));
      return;
    }

    writeLine("");
    writeLine(`${bold("ID")}  ${bold("Tên")}             ${bold("Lịch")}           ${bold("Kênh")}      ${bold("Lần chạy tới")}           ${bold("Trạng thái")}`);
    writeLine(dim("─".repeat(90)));

    for (const s of schedules) {
      const id = String(s.id).padStart(2);
      const name = s.name.length > 14 ? s.name.slice(0, 11) + "..." : s.name.padEnd(14);
      const schedule = `${s.scheduleType}:${s.scheduleValue}`.slice(0, 14).padEnd(14);
      const channel = (s.channel ?? "—").padEnd(8);
      const nextRun = s.nextRunAt ? formatLocalTime(s.nextRunAt, config.agent.timeZone) : "(đã chạy một lần)";
      const status = s.enabled
        ? badge(s.lastResult === "error" ? "ERR" : s.runCount > 0 ? "OK" : "NEW", s.lastResult === "error" ? "yellow" : "green")
        : badge("OFF", "red");

      writeLine(`${id}  ${name}  ${schedule}  ${channel}  ${nextRun.padEnd(22)}  ${status}`);
    }

    writeLine(dim(`\n${schedules.length} lịch. Dùng \`bestie cron logs <id>\` để xem lịch sử chạy.`));
  } finally {
    store.close();
  }
}

async function runCronAdd(argv: string[], paths: RuntimePaths, writeLine: (message: string) => void): Promise<void> {
  const config = await loadConfig(paths);
  const args = parseArgs(argv.slice(4));

  const name = args["--name"] ?? (await askCli("Tên cron job?", "Cron job của tôi"));
  const scheduleType = args["--type"] ?? (await askCli("Kiểu lịch (interval, cron_expr, once)?", "interval"));
  const scheduleValue = args["--schedule"] ?? (await askCli("Giá trị lịch (ví dụ 30m, 0 8 * * *)?", "30m"));
  const prompt = args["--prompt"] ?? (await askCli("Agent cần làm gì?", ""));
  const channel = args["--channel"];

  if (!VALID_SCHEDULE_TYPES.includes(scheduleType)) {
    writeLine(`${badge("FAIL", "red")} Kiểu lịch không hợp lệ: ${scheduleType}. Dùng interval, cron_expr, hoặc once.`);
    process.exitCode = 1;
    return;
  }

  if (!prompt) {
    writeLine(`${badge("FAIL", "red")} Bắt buộc phải có prompt. Dùng --prompt "hướng dẫn của bạn".`);
    process.exitCode = 1;
    return;
  }

  if (channel !== undefined && !isCronReportDestination(channel)) {
    writeLine(`${badge("FAIL", "red")} Đích gửi báo cáo không hợp lệ. Dùng telegram:<userId> hoặc zalo:<userId>.`);
    process.exitCode = 1;
    return;
  }

  const validationError = validateSchedule(scheduleType, scheduleValue, config.agent.timeZone);
  if (validationError) {
    writeLine(`${badge("FAIL", "red")} Lịch không hợp lệ: ${validationError}`);
    process.exitCode = 1;
    return;
  }

  const nextRunAt = computeNextRun(scheduleType, scheduleValue, undefined, config.agent.timeZone);
  const store = await SqliteMemoryStore.open(paths);

  try {
    const schedule = store.addCronSchedule({
      name,
      scheduleType: scheduleType as "interval" | "cron_expr" | "once",
      scheduleValue,
      prompt,
      channel,
      nextRunAt,
    });

    writeLine(`${badge("OK", "green")} Đã tạo lịch cron: ${name} (ID: ${schedule.id})`);
    writeLine(`  Lịch: ${scheduleType} ${scheduleValue}`);
    if (channel) {
      writeLine(`  Kênh: ${channel}`);
    }
    writeLine(`  Lần chạy tới: ${formatLocalTime(nextRunAt, config.agent.timeZone)}`);
    writeLine(`  Prompt: ${prompt}`);
  } finally {
    store.close();
  }
}

async function runCronRemove(argv: string[], paths: RuntimePaths, writeLine: (message: string) => void): Promise<void> {
  const id = Number(argv[4]);

  if (!Number.isFinite(id) || id <= 0) {
    writeLine(`${badge("FAIL", "red")} Cách dùng: bestie cron remove <id>`);
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open(paths);

  try {
    const removed = store.removeCronSchedule(id);

    if (removed) {
      writeLine(`${badge("OK", "green")} Đã xóa lịch cron ${id}.`);
    } else {
      writeLine(`${badge("FAIL", "red")} Không tìm thấy lịch cron ${id}.`);
      process.exitCode = 1;
    }
  } finally {
    store.close();
  }
}

async function runCronUpdate(argv: string[], paths: RuntimePaths, writeLine: (message: string) => void): Promise<void> {
  const id = Number(argv[4]);

  if (!Number.isFinite(id) || id <= 0) {
    writeLine(`${badge("FAIL", "red")} Cách dùng: bestie cron update <id> [--name ...] [--type interval|cron_expr|once] [--schedule ...] [--prompt ...] [--channel telegram:<userId>|zalo:<userId>|none] [--enable|--disable]`);
    process.exitCode = 1;
    return;
  }

  const config = await loadConfig(paths);
  const args = parseArgs(argv.slice(5));
  const store = await SqliteMemoryStore.open(paths);

  try {
    const existing = store.getCronSchedule(id);
    const update = buildCronUpdate(existing, args, config.agent.timeZone);
    if (update.kind === "invalid") {
      writeLine(`${badge("FAIL", "red")} ${update.message}`);
      process.exitCode = 1;
      return;
    }

    const schedule = store.updateCronSchedule(id, update.schedule);
    writeLine(`${badge("OK", "green")} Đã cập nhật lịch cron ${id}.`);
    writeLine(`  Tên: ${schedule.name}`);
    writeLine(`  Lịch: ${schedule.scheduleType} ${schedule.scheduleValue}`);
    writeLine(`  Kênh: ${schedule.channel ?? "—"}`);
    writeLine(`  Trạng thái: ${schedule.enabled ? "bật" : "tắt"}`);
    writeLine(`  Lần chạy tới: ${schedule.nextRunAt ? formatLocalTime(schedule.nextRunAt, config.agent.timeZone) : "(không có)"}${update.scheduleChanged ? " (đã tính lại)" : ""}`);
  } catch {
    writeLine(`${badge("FAIL", "red")} Không tìm thấy lịch cron ${id}.`);
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

async function runCronTrigger(argv: string[], paths: RuntimePaths, writeLine: (message: string) => void): Promise<void> {
  const id = Number(argv[4]);

  if (!Number.isFinite(id) || id <= 0) {
    writeLine(`${badge("FAIL", "red")} Cách dùng: bestie cron trigger <id>`);
    process.exitCode = 1;
    return;
  }

  const config = await loadConfig(paths);
  const executor = new CronExecutor({ config, paths });
  writeLine(`Đang trigger lịch cron ${id}...`);
  try {
    await executor.runScheduleNow(id);
    writeLine(`${badge("OK", "green")} Đã trigger lịch cron ${id}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    writeLine(`${badge("FAIL", "red")} Không trigger được lịch cron ${id}: ${message}`);
    process.exitCode = 1;
  }
}

async function runCronToggle(argv: string[], paths: RuntimePaths, writeLine: (message: string) => void): Promise<void> {
  const id = Number(argv[4]);

  if (!Number.isFinite(id) || id <= 0) {
    writeLine(`${badge("FAIL", "red")} Cách dùng: bestie cron toggle <id>`);
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open(paths);

  try {
    const schedule = store.getCronSchedule(id);
    const updated = store.toggleCronSchedule(id, !schedule.enabled);
    writeLine(`${badge("OK", "green")} Lịch cron ${id} đã ${updated.enabled ? "bật" : "tắt"}.`);
  } catch {
    writeLine(`${badge("FAIL", "red")} Không tìm thấy lịch cron ${id}.`);
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

async function runCronLogs(argv: string[], paths: RuntimePaths, writeLine: (message: string) => void): Promise<void> {
  const scheduleId = argv[4] ? Number(argv[4]) : undefined;
  const store = await SqliteMemoryStore.open(paths);

  try {
    const logs = store.listCronLogs(scheduleId);

    writeLine(title("Log cron Bestie"));

    if (logs.length === 0) {
      writeLine(dim(scheduleId ? `Chưa có log cho lịch ${scheduleId}.` : "Chưa có log cron."));
      return;
    }

    writeLine("");
    for (const log of logs) {
      const result = log.result === "ok" ? badge("OK", "green") : badge("ERR", "yellow");
      const output = log.output ? ` ${dim(log.output.slice(0, 80))}` : "";
      const error = log.error ? ` ${color("red", log.error.slice(0, 80))}` : "";
      writeLine(`  ${result} #${log.scheduleId} ${log.startedAt}${output}${error}`);
    }
  } finally {
    store.close();
  }
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--enable") {
      result[arg] = "true";
      continue;
    }
    if (arg === "--disable") {
      result[arg] = "true";
      continue;
    }
    if (arg.startsWith("--") && arg.includes("=")) {
      const separator = arg.indexOf("=");
      result[arg.slice(0, separator)] = arg.slice(separator + 1);
      continue;
    }
    if (arg.startsWith("--") && i + 1 < args.length && !args[i + 1].startsWith("--")) {
      result[arg] = args[i + 1];
      i++;
    }
  }

  return result;
}

type CronUpdateResult =
  | { kind: "valid"; schedule: Parameters<SqliteMemoryStore["updateCronSchedule"]>[1]; scheduleChanged: boolean }
  | { kind: "invalid"; message: string };

function buildCronUpdate(existing: CronSchedule, args: Record<string, string>, timeZone?: string): CronUpdateResult {
  const name = args["--name"] === undefined ? existing.name : args["--name"].trim();
  const scheduleType = args["--type"] === undefined ? existing.scheduleType : args["--type"].trim();
  const scheduleValue = args["--schedule"] === undefined ? existing.scheduleValue : args["--schedule"].trim();
  const prompt = args["--prompt"] === undefined ? existing.prompt : args["--prompt"].trim();
  const channel = args["--channel"] === undefined ? existing.channel : normalizeCliChannel(args["--channel"]);
  const enabled = args["--enable"] ? true : args["--disable"] ? false : existing.enabled;

  if (!name) return { kind: "invalid", message: "--name không được rỗng." };
  if (!scheduleType || !VALID_SCHEDULE_TYPES.includes(scheduleType)) return { kind: "invalid", message: "--type phải là interval, cron_expr, hoặc once." };
  if (!scheduleValue) return { kind: "invalid", message: "--schedule không được rỗng." };
  if (!prompt) return { kind: "invalid", message: "--prompt không được rỗng." };
  if (channel !== undefined && !isCronReportDestination(channel)) return { kind: "invalid", message: "--channel phải là telegram:<userId>, zalo:<userId>, none, hoặc clear." };

  const scheduleChanged = scheduleType !== existing.scheduleType || scheduleValue !== existing.scheduleValue;
  const validationError = scheduleChanged ? validateSchedule(scheduleType, scheduleValue, timeZone) : undefined;
  if (validationError) return { kind: "invalid", message: `Lịch không hợp lệ: ${validationError}` };

  return {
    kind: "valid",
    scheduleChanged,
    schedule: {
      name,
      scheduleType: scheduleType as "interval" | "cron_expr" | "once",
      scheduleValue,
      prompt,
      channel,
      enabled,
      nextRunAt: scheduleChanged ? computeNextRun(scheduleType, scheduleValue, undefined, timeZone) : existing.nextRunAt,
    },
  };
}

function normalizeCliChannel(value: string): string | undefined {
  const normalized = value.trim();
  return !normalized || normalized === "none" || normalized === "clear" ? undefined : normalized;
}

async function askCli(question: string, defaultValue: string): Promise<string> {
  const questioner = createCliQuestioner({ echoAnswer: true, returnUndefinedOnInputEnd: true });

  try {
    const answer = await questioner.ask(`${question} [${defaultValue}] `);
    return answer?.trim() || defaultValue;
  } finally {
    questioner.close();
  }
}

function formatLocalTime(isoTimestamp: string, timeZone?: string): string {
  try {
    const date = new Date(isoTimestamp);
    return date.toLocaleString("en-GB", {
      timeZone: timeZone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return isoTimestamp;
  }
}
