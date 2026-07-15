import { stdout as output } from "node:process";

import { loadConfig } from "../../runtime/config.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { SqliteMemoryStore } from "../../memory/sqlite-store.js";
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

  if (subcommand === "toggle") {
    await runCronToggle(argv, paths, writeLine);
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

  writeLine(`Unknown cron subcommand: ${subcommand}`);
  printCronHelp(writeLine);
  process.exitCode = 1;
}

function printCronHelp(writeLine: (message: string) => void): void {
  writeLine(`Bestie Cron

Usage:
  bestie cron list           List all cron schedules
  bestie cron add            Create a new cron schedule (interactive)
  bestie cron remove <id>    Remove a cron schedule by ID
  bestie cron toggle <id>    Toggle a cron schedule on/off
  bestie cron logs [id]      Show recent cron execution logs
  bestie cron run            Run the cron scheduler until stopped

Schedule types:
  interval    Repeating interval, e.g. "30m", "1h", "2d"
  cron_expr   5-field cron expression, e.g. "0 8 * * *"
  once        One-shot at ISO timestamp, e.g. "2026-12-25T08:00:00Z"`);
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
  writeLine("Cron scheduler started. Press Ctrl+C to stop.");

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

    writeLine(title("Bestie Cron Schedules"));

    if (schedules.length === 0) {
      writeLine(dim("No cron schedules configured. Use `bestie cron add` to create one."));
      return;
    }

    writeLine("");
    writeLine(`${bold("ID")}  ${bold("Name")}            ${bold("Schedule")}       ${bold("Channel")}   ${bold("Next Run")}              ${bold("Status")}`);
    writeLine(dim("─".repeat(90)));

    for (const s of schedules) {
      const id = String(s.id).padStart(2);
      const name = s.name.length > 14 ? s.name.slice(0, 11) + "..." : s.name.padEnd(14);
      const schedule = `${s.scheduleType}:${s.scheduleValue}`.slice(0, 14).padEnd(14);
      const channel = (s.channel ?? "—").padEnd(8);
      const nextRun = s.nextRunAt ? formatLocalTime(s.nextRunAt, config.agent.timeZone) : "(one-shot done)";
      const status = s.enabled
        ? badge(s.lastResult === "error" ? "ERR" : s.runCount > 0 ? "OK" : "NEW", s.lastResult === "error" ? "yellow" : "green")
        : badge("OFF", "red");

      writeLine(`${id}  ${name}  ${schedule}  ${channel}  ${nextRun.padEnd(22)}  ${status}`);
    }

    writeLine(dim(`\n${schedules.length} schedule(s). Use \`bestie cron logs <id>\` to check execution history.`));
  } finally {
    store.close();
  }
}

async function runCronAdd(argv: string[], paths: RuntimePaths, writeLine: (message: string) => void): Promise<void> {
  const config = await loadConfig(paths);
  const args = parseArgs(argv.slice(4));

  const name = args["--name"] ?? (await askCli("Cron job name?", "My cron job"));
  const scheduleType = args["--type"] ?? (await askCli("Schedule type (interval, cron_expr, once)?", "interval"));
  const scheduleValue = args["--schedule"] ?? (await askCli("Schedule value (e.g. 30m, 0 8 * * *)?", "30m"));
  const prompt = args["--prompt"] ?? (await askCli("What should the agent do?", ""));
  const channel = args["--channel"];

  if (!VALID_SCHEDULE_TYPES.includes(scheduleType)) {
    writeLine(`${badge("FAIL", "red")} Invalid schedule type: ${scheduleType}. Use interval, cron_expr, or once.`);
    process.exitCode = 1;
    return;
  }

  if (!prompt) {
    writeLine(`${badge("FAIL", "red")} Prompt is required. Use --prompt "your instruction".`);
    process.exitCode = 1;
    return;
  }

  if (channel !== undefined && !isCronReportDestination(channel)) {
    writeLine(`${badge("FAIL", "red")} Invalid channel destination. Use telegram:<userId> or zalo:<userId>.`);
    process.exitCode = 1;
    return;
  }

  const validationError = validateSchedule(scheduleType, scheduleValue);
  if (validationError) {
    writeLine(`${badge("FAIL", "red")} Invalid schedule: ${validationError}`);
    process.exitCode = 1;
    return;
  }

  const nextRunAt = computeNextRun(scheduleType, scheduleValue);
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

    writeLine(`${badge("OK", "green")} Cron schedule created: ${name} (ID: ${schedule.id})`);
    writeLine(`  Schedule: ${scheduleType} ${scheduleValue}`);
    if (channel) {
      writeLine(`  Channel: ${channel}`);
    }
    writeLine(`  Next run: ${formatLocalTime(nextRunAt, config.agent.timeZone)}`);
    writeLine(`  Prompt: ${prompt}`);
  } finally {
    store.close();
  }
}

async function runCronRemove(argv: string[], paths: RuntimePaths, writeLine: (message: string) => void): Promise<void> {
  const id = Number(argv[4]);

  if (!Number.isFinite(id) || id <= 0) {
    writeLine(`${badge("FAIL", "red")} Usage: bestie cron remove <id>`);
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open(paths);

  try {
    const removed = store.removeCronSchedule(id);

    if (removed) {
      writeLine(`${badge("OK", "green")} Cron schedule ${id} removed.`);
    } else {
      writeLine(`${badge("FAIL", "red")} Cron schedule ${id} not found.`);
      process.exitCode = 1;
    }
  } finally {
    store.close();
  }
}

async function runCronToggle(argv: string[], paths: RuntimePaths, writeLine: (message: string) => void): Promise<void> {
  const id = Number(argv[4]);

  if (!Number.isFinite(id) || id <= 0) {
    writeLine(`${badge("FAIL", "red")} Usage: bestie cron toggle <id>`);
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open(paths);

  try {
    const schedule = store.getCronSchedule(id);
    const updated = store.toggleCronSchedule(id, !schedule.enabled);
    writeLine(`${badge("OK", "green")} Cron schedule ${id} ${updated.enabled ? "enabled" : "disabled"}.`);
  } catch {
    writeLine(`${badge("FAIL", "red")} Cron schedule ${id} not found.`);
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

    writeLine(title("Bestie Cron Logs"));

    if (logs.length === 0) {
      writeLine(dim(scheduleId ? `No logs for schedule ${scheduleId}.` : "No cron logs yet."));
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
    if (arg.startsWith("--") && i + 1 < args.length && !args[i + 1].startsWith("--")) {
      result[arg] = args[i + 1];
      i++;
    }
  }

  return result;
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
