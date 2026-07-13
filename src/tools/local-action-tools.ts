import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { DEFAULT_INTERNAL_EXEC_TIMEOUT_MS, type AppConfig, type InternalToolPolicy } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { getAgentWorkspacePath, resolveWorkspacePath } from "../runtime/workspace.js";
import { reviewActionPermission, type ActionCategory, type PermissionApprover } from "../safety/permission-policy.js";

export interface LocalActionToolOptions {
  config: AppConfig;
  paths: RuntimePaths;
  approver?: PermissionApprover;
}

export interface LocalActionResult {
  allowed: boolean;
  reason: string;
}

export interface LocalFileWriteResult extends LocalActionResult {
  path?: string;
  bytes?: number;
}

export interface LocalFileEditResult extends LocalFileWriteResult {
  replacements?: number;
}

export interface LocalPatchResult extends LocalActionResult {
  output: string;
}

export interface LocalExecResult extends LocalActionResult {
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface LocalProcessListResult extends LocalActionResult {
  processes: Array<{ pid: number; ppid: number; command: string; args: string }>;
}

const MAX_WRITE_BYTES = 256 * 1024;
const MAX_EDIT_BYTES = 256 * 1024;
const MAX_PATCH_BYTES = 256 * 1024;
const MAX_EXEC_OUTPUT_BYTES = 48 * 1024;
const MAX_EXEC_TIMEOUT_MS = 10 * 60_000;
const execFileAsync = promisify(execFile);

export async function writeLocalFileTool(options: LocalActionToolOptions & { path: string; content: string; overwrite?: boolean }): Promise<LocalFileWriteResult> {
  const permission = await reviewInternalToolPermission(options, "internal.write_file", "local_write", options.path, "Write a local project file requested by the agent.");
  if (!permission.allowed) return { ...permission };

  const contentBuffer = Buffer.from(options.content, "utf8");
  if (contentBuffer.length > MAX_WRITE_BYTES) {
    return { allowed: false, reason: `Content exceeds ${MAX_WRITE_BYTES} bytes.` };
  }

  const resolvedPath = resolveLocalActionPath(options, options.path);
  if (isIgnoredProjectPath(relative(options.paths.rootDir, resolvedPath))) {
    return { allowed: false, reason: "Path is in an ignored directory.", path: resolvedPath };
  }

  if (!options.overwrite && (await pathExists(resolvedPath))) {
    return { allowed: false, reason: "Path already exists; set overwrite true to replace it.", path: resolvedPath };
  }

  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, options.content, "utf8");
  return { allowed: true, reason: permission.reason, path: resolvedPath, bytes: contentBuffer.length };
}

export async function editLocalFileTool(options: LocalActionToolOptions & { path: string; oldText: string; newText: string; replaceAll?: boolean }): Promise<LocalFileEditResult> {
  const permission = await reviewInternalToolPermission(options, "internal.edit_file", "local_write", options.path, "Edit a local project file requested by the agent.");
  if (!permission.allowed) return { ...permission };

  if (!options.oldText) {
    return { allowed: false, reason: "internal.edit_file requires non-empty oldText." };
  }

  const resolvedPath = resolveLocalActionPath(options, options.path);
  if (isIgnoredProjectPath(relative(options.paths.rootDir, resolvedPath))) {
    return { allowed: false, reason: "Path is in an ignored directory.", path: resolvedPath };
  }

  const fileStat = await stat(resolvedPath).catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? undefined : Promise.reject(error)));
  if (!fileStat?.isFile()) {
    return { allowed: false, reason: "Path does not exist or is not a file.", path: resolvedPath };
  }
  if (fileStat.size > MAX_EDIT_BYTES) {
    return { allowed: false, reason: `File exceeds ${MAX_EDIT_BYTES} bytes.`, path: resolvedPath };
  }

  const original = await readFile(resolvedPath, "utf8");
  const occurrences = countOccurrences(original, options.oldText);
  if (occurrences === 0) {
    return { allowed: false, reason: "oldText was not found exactly once or replaceAll was not set.", path: resolvedPath };
  }
  if (!options.replaceAll && occurrences !== 1) {
    return { allowed: false, reason: `oldText appeared ${occurrences} times; set replaceAll true or provide a more specific edit.`, path: resolvedPath };
  }

  const updated = options.replaceAll ? original.split(options.oldText).join(options.newText) : original.replace(options.oldText, options.newText);
  await writeFile(resolvedPath, updated, "utf8");
  return { allowed: true, reason: permission.reason, path: resolvedPath, bytes: Buffer.byteLength(updated, "utf8"), replacements: options.replaceAll ? occurrences : 1 };
}

export async function applyPatchTool(options: LocalActionToolOptions & { patch: string }): Promise<LocalPatchResult> {
  const permission = await reviewInternalToolPermission(options, "internal.apply_patch", "local_write", "git apply patch", "Apply a local project patch requested by the agent.");
  if (!permission.allowed) return { ...permission, output: "" };

  if (Buffer.byteLength(options.patch, "utf8") > MAX_PATCH_BYTES) {
    return { allowed: false, reason: `Patch exceeds ${MAX_PATCH_BYTES} bytes.`, output: "" };
  }

  if (options.patch.includes("*** Begin Patch") || options.patch.includes("*** Update File:")) {
    return { allowed: false, reason: "internal.apply_patch requires a git apply compatible diff, not *** Begin Patch format.", output: "" };
  }

  const result = await runProcess("git", ["apply", "--whitespace=nowarn", "-"], options.paths.rootDir, options.patch, 15_000);
  return { allowed: result.exitCode === 0, reason: result.exitCode === 0 ? permission.reason : "Patch did not apply.", output: `${result.stdout}${result.stderr}`.trim() };
}

export async function execLocalTool(options: LocalActionToolOptions & { command: string; args?: string[]; cwd?: string; timeoutMs?: number }): Promise<LocalExecResult> {
  const permission = await reviewInternalToolPermission(options, "internal.exec", "destructive", options.command, "Run a bounded local command requested by the agent.");
  if (!permission.allowed) return { ...permission, stdout: "", stderr: "", timedOut: false };

  if (!options.command.trim()) {
    return { allowed: false, reason: "internal.exec requires command.", stdout: "", stderr: "", timedOut: false };
  }
  const args = Array.isArray(options.args) ? options.args.filter((arg): arg is string => typeof arg === "string") : [];
  const cwd = options.cwd ? resolveLocalActionPath(options, options.cwd) : getAgentWorkspacePath(options.config, options.paths);
  await mkdir(cwd, { recursive: true });
  const requestedTimeoutMs = options.timeoutMs ?? options.config.internalTools?.exec?.timeoutMs ?? DEFAULT_INTERNAL_EXEC_TIMEOUT_MS;
  const timeoutMs = Math.min(Math.max(requestedTimeoutMs, 1), MAX_EXEC_TIMEOUT_MS);
  const result = await runProcess(options.command, args, cwd, undefined, timeoutMs);
  return { allowed: true, reason: permission.reason, ...result };
}

export async function listProcessesTool(options: LocalActionToolOptions & { limit?: number }): Promise<LocalProcessListResult> {
  const permission = await reviewInternalToolPermission(options, "internal.list_processes", "read", "local processes", "List local processes requested by the agent.");
  if (!permission.allowed) return { ...permission, processes: [] };

  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const { stdout } = await execFileAsync("ps", ["-eo", "pid=,ppid=,comm=,args="], { encoding: "utf8", timeout: 5_000, maxBuffer: MAX_EXEC_OUTPUT_BYTES });
  const processes = stdout
    .split(/\r?\n/)
    .map(parseProcessLine)
    .filter((process): process is LocalProcessListResult["processes"][number] => process !== undefined)
    .slice(0, limit);

  return { allowed: true, reason: permission.reason, processes };
}

async function reviewInternalToolPermission(
  options: LocalActionToolOptions,
  toolName: string,
  category: ActionCategory,
  target: string,
  reason: string,
): Promise<LocalActionResult> {
  const configured = getInternalToolPolicy(options.config, toolName, category);
  if (configured === "deny") {
    return { allowed: false, reason: `${toolName} is denied by config.` };
  }

  if (configured === "allow") {
    return { allowed: true, reason: `${toolName} is allowed by config.` };
  }

  const permission = await reviewActionPermission(
    { category, action: toolName, target, reason, trusted: category === "read", payloadJson: JSON.stringify({ tool: toolName, arguments: buildInternalToolPayload(toolName, options) }) },
    {
      paths: options.paths,
      approver: options.approver,
      policy: { allowTrustedRead: false, allowLocalWrite: false },
    },
  );

  return { allowed: permission.decision === "allow", reason: permission.reason };
}

function buildInternalToolPayload(toolName: string, options: LocalActionToolOptions): Record<string, unknown> {
  const toolOptions = options as Partial<{
    path: string;
    content: string;
    overwrite: boolean;
    oldText: string;
    newText: string;
    replaceAll: boolean;
    patch: string;
    command: string;
    args: string[];
    cwd: string;
    timeoutMs: number;
    limit: number;
  }>;

  if (toolName === "internal.write_file" && toolOptions.path !== undefined && toolOptions.content !== undefined) {
    return { path: toolOptions.path, content: toolOptions.content, overwrite: toolOptions.overwrite };
  }
  if (toolName === "internal.edit_file" && toolOptions.path !== undefined && toolOptions.oldText !== undefined && toolOptions.newText !== undefined) {
    return { path: toolOptions.path, oldText: toolOptions.oldText, newText: toolOptions.newText, replaceAll: toolOptions.replaceAll };
  }
  if (toolName === "internal.apply_patch" && toolOptions.patch !== undefined) {
    return { patch: toolOptions.patch };
  }
  if (toolName === "internal.exec" && toolOptions.command !== undefined) {
    return { command: toolOptions.command, args: toolOptions.args, cwd: toolOptions.cwd, timeoutMs: toolOptions.timeoutMs };
  }
  if (toolName === "internal.list_processes" && toolOptions.limit !== undefined) {
    return { limit: toolOptions.limit };
  }
  return {};
}

function getInternalToolPolicy(config: AppConfig, toolName: string, category: ActionCategory): InternalToolPolicy {
  const configured = config.internalTools?.policies?.[toolName];
  if (configured) return configured;
  return category === "read" ? "allow" : "ask";
}

function resolveLocalActionPath(options: LocalActionToolOptions, inputPath: string): string {
  return resolveWorkspacePath({ config: options.config, paths: options.paths, inputPath, defaultBase: "workspace", access: "write" });
}

function isIgnoredProjectPath(relativePath: string): boolean {
  return relativePath.split(/[\\/]/).some((part) => [".git", "node_modules", "dist", "coverage"].includes(part));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function countOccurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}

function runProcess(command: string, args: string[], cwd: string, input: string | undefined, timeoutMs: number): Promise<Omit<LocalExecResult, "allowed" | "reason">> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: 127, stdout, stderr: appendBounded(stderr, error.message), timedOut });
    });
    child.once("exit", (exitCode) => {
      clearTimeout(timer);
      resolvePromise({ exitCode, stdout, stderr, timedOut });
    });
    child.stdin.end(input ?? "");
  });
}

function appendBounded(existing: string, chunk: string): string {
  const combined = existing + chunk;
  const buffer = Buffer.from(combined, "utf8");
  return buffer.length <= MAX_EXEC_OUTPUT_BYTES ? combined : buffer.subarray(0, MAX_EXEC_OUTPUT_BYTES).toString("utf8");
}

function parseProcessLine(line: string): LocalProcessListResult["processes"][number] | undefined {
  const trimmed = line.trim();
  const match = trimmed.match(/^(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
  if (!match) return undefined;
  return { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? "", args: match[4] ?? "" };
}