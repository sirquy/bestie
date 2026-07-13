import { listActiveMemoriesTool, readGitDiffTool, readGitLogTool, readGitStatusTool, readRecentAppLogsTool } from "../../tools/local-read-tools.js";
import { cleanupTelegramAttachments, parseCleanupAttachmentKinds, parseDurationMs, type CleanupAttachmentKind } from "../../tools/attachment-cleanup.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { UserFacingError } from "../../runtime/errors.js";

interface ToolsCommandOptions {
  argv?: string[];
  paths?: RuntimePaths;
  writeLine?: (message: string) => void;
}

export async function runToolsCommand(optionsOrArgv: string[] | ToolsCommandOptions = process.argv): Promise<void> {
  const options = Array.isArray(optionsOrArgv) ? { argv: optionsOrArgv } : optionsOrArgv;
  const argv = options.argv ?? process.argv;
  const subcommand = argv[3];
  const writeLine = options.writeLine ?? console.log;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    writeLine("Usage: bestie tools logs [--lines N] | memories [--limit N] | git status | git diff [--staged] | git log [--limit N] | attachments cleanup [--older-than 7d] [--kinds voice,audio] [--confirm]");
    return;
  }

  if (subcommand !== "logs" && subcommand !== "memories" && subcommand !== "git" && subcommand !== "attachments") {
    throw new UserFacingError(`Unknown tools command: ${subcommand}. Try \`bestie tools logs\`, \`bestie tools memories\`, \`bestie tools git status\`, or \`bestie tools attachments cleanup\`.`, "UnknownToolsCommandError");
  }

  const paths = options.paths ?? getRuntimePaths();

  if (subcommand === "memories") {
    const result = await listActiveMemoriesTool({ paths, limit: parseLimit(argv) });

    if (!result.allowed) {
      throw new UserFacingError(`Tool denied: ${result.reason}`, "ToolDeniedError");
    }

    if (result.memories.length === 0) {
      writeLine("No active memories found.");
      return;
    }

    for (const memory of result.memories) {
      writeLine(`${memory.id}. [${memory.type}/${memory.sensitivity}/importance ${memory.importance}] ${memory.content}`);
    }

    return;
  }

  if (subcommand === "git") {
    await runGitToolsCommand({ argv, paths, writeLine });
    return;
  }

  if (subcommand === "attachments") {
    await runAttachmentToolsCommand({ argv, paths, writeLine });
    return;
  }

  const lineCount = parseLineCount(argv);
  const result = await readRecentAppLogsTool({ paths, lineCount });

  if (!result.allowed) {
    throw new UserFacingError(`Tool denied: ${result.reason}`, "ToolDeniedError");
  }

  if (result.lines.length === 0) {
    writeLine(`No logs found yet. Logs will be written to ${paths.appLogPath}.`);
    return;
  }

  for (const line of result.lines) {
    writeLine(line);
  }
}

async function runAttachmentToolsCommand(options: { argv: string[]; paths: RuntimePaths; writeLine: (message: string) => void }): Promise<void> {
  const attachmentCommand = options.argv[4];
  if (!attachmentCommand || attachmentCommand === "--help" || attachmentCommand === "-h") {
    options.writeLine("Usage: bestie tools attachments cleanup [--older-than 7d] [--kinds voice,audio] [--confirm]");
    return;
  }

  if (attachmentCommand !== "cleanup") {
    throw new UserFacingError(`Unknown attachments tools command: ${attachmentCommand}. Try \`bestie tools attachments cleanup\`.`, "UnknownAttachmentToolsCommandError");
  }

  const olderThanMs = parseOlderThan(options.argv);
  const kinds = parseKinds(options.argv);
  const confirm = options.argv.includes("--confirm");
  const result = await cleanupTelegramAttachments({ paths: options.paths, olderThanMs, kinds, confirm });

  options.writeLine(`${result.dryRun ? "Would delete" : "Deleted"} ${result.dryRun ? result.matchedFiles : result.deletedFiles} Telegram attachment file(s), ${formatBytes(result.dryRun ? result.bytesMatched : result.bytesDeleted)}.`);
  options.writeLine(`Scanned ${result.scannedFiles} file(s) under ${result.root}.`);
  if (result.dryRun && result.matchedFiles > 0) {
    options.writeLine("Dry run only. Re-run with --confirm to delete.");
  }

  for (const file of result.files.slice(0, 20)) {
    options.writeLine(`${file.deleted ? "deleted" : "match"} ${file.kind} ${formatBytes(file.bytes)} ${file.path}`);
  }
  if (result.files.length > 20) {
    options.writeLine(`...and ${result.files.length - 20} more file(s).`);
  }
}

async function runGitToolsCommand(options: { argv: string[]; paths: RuntimePaths; writeLine: (message: string) => void }): Promise<void> {
  const gitCommand = options.argv[4];

  if (!gitCommand || gitCommand === "--help" || gitCommand === "-h") {
    options.writeLine("Usage: bestie tools git status | diff [--staged] | log [--limit N]");
    return;
  }

  if (gitCommand === "status") {
    const result = await readGitStatusTool({ paths: options.paths });
    writeToolOutput(result, options.writeLine, "No git status output.");
    return;
  }

  if (gitCommand === "diff") {
    const result = await readGitDiffTool({ paths: options.paths, staged: options.argv.includes("--staged") });
    writeToolOutput(result, options.writeLine, result.truncated ? "Git diff output was truncated." : "No git diff output.");
    return;
  }

  if (gitCommand === "log") {
    const result = await readGitLogTool({ paths: options.paths, limit: parseLimit(options.argv) });
    writeToolOutput(result, options.writeLine, "No git log output.");
    return;
  }

  throw new UserFacingError(`Unknown git tools command: ${gitCommand}. Try \`bestie tools git status\`, \`bestie tools git diff\`, or \`bestie tools git log\`.`, "UnknownGitToolsCommandError");
}

function writeToolOutput(result: { allowed: boolean; reason: string; output: string }, writeLine: (message: string) => void, emptyMessage: string): void {
  if (!result.allowed) {
    throw new UserFacingError(`Tool denied: ${result.reason}`, "ToolDeniedError");
  }

  if (!result.output.trim()) {
    writeLine(emptyMessage);
    return;
  }

  writeLine(result.output);
}

function parseLineCount(argv: string[]): number {
  const index = argv.indexOf("--lines");

  if (index === -1) {
    return 20;
  }

  const rawValue = argv[index + 1];
  const value = Number(rawValue);

  if (!rawValue || !Number.isInteger(value) || value <= 0 || value > 200) {
    throw new UserFacingError("--lines must be an integer from 1 to 200.", "InvalidToolsLinesError");
  }

  return value;
}

function parseLimit(argv: string[]): number {
  const index = argv.indexOf("--limit");

  if (index === -1) {
    return 10;
  }

  const rawValue = argv[index + 1];
  const value = Number(rawValue);

  if (!rawValue || !Number.isInteger(value) || value <= 0 || value > 50) {
    throw new UserFacingError("--limit must be an integer from 1 to 50.", "InvalidToolsLimitError");
  }

  return value;
}

function parseOlderThan(argv: string[]): number {
  const index = argv.indexOf("--older-than");
  if (index === -1) {
    return parseDurationMs("7d");
  }

  const rawValue = argv[index + 1];
  if (!rawValue || rawValue.startsWith("--")) {
    throw new UserFacingError("--older-than must use a duration like 30m, 12h, or 7d.", "InvalidAttachmentCleanupOlderThanError");
  }

  try {
    return parseDurationMs(rawValue);
  } catch (error) {
    throw new UserFacingError(error instanceof Error ? error.message : "Invalid --older-than value.", "InvalidAttachmentCleanupOlderThanError");
  }
}

function parseKinds(argv: string[]): CleanupAttachmentKind[] | undefined {
  const index = argv.indexOf("--kinds");
  if (index === -1) {
    return undefined;
  }

  const rawValue = argv[index + 1];
  if (!rawValue || rawValue.startsWith("--")) {
    throw new UserFacingError("--kinds must be a comma-separated list like voice,audio.", "InvalidAttachmentCleanupKindsError");
  }

  try {
    return parseCleanupAttachmentKinds(rawValue);
  } catch (error) {
    throw new UserFacingError(error instanceof Error ? error.message : "Invalid --kinds value.", "InvalidAttachmentCleanupKindsError");
  }
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}
