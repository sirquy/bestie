import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { RuntimePaths } from "../runtime/paths.js";
import { getWorkforceAgent, normalizeAgentId } from "./registry.js";

export type WorkforceTaskStatus = "queued" | "in_progress" | "done" | "blocked" | "canceled";

export interface WorkforceTask {
  id: string;
  agentId: string;
  title: string;
  brief: string;
  status: WorkforceTaskStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: "user" | "bestie" | "system";
  result?: string;
}

export interface AssignWorkforceTaskInput {
  agentId: string;
  title?: string;
  brief: string;
  createdBy?: "user" | "bestie" | "system";
}

export function workforceTasksPath(paths: RuntimePaths): string {
  return resolve(paths.appDir, "agents", "tasks.json");
}

export async function assignWorkforceTask(paths: RuntimePaths, input: AssignWorkforceTaskInput): Promise<WorkforceTask> {
  const agentId = normalizeAgentId(input.agentId);
  const agent = await getWorkforceAgent(paths, agentId);
  if (!agent) {
    throw new Error(`Agent '${agentId}' does not exist.`);
  }
  if (!agent.enabled) {
    throw new Error(`Agent '${agentId}' is paused.`);
  }

  const now = new Date().toISOString();
  const task: WorkforceTask = {
    id: createTaskId(now),
    agentId,
    title: normalizeTitle(input.title, input.brief),
    brief: requireNonEmpty(input.brief, "brief"),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy ?? "user",
  };

  const tasks = await readTasks(paths);
  await writeTasks(paths, [...tasks, task]);
  return task;
}

export async function listWorkforceTasks(paths: RuntimePaths, options: { agentId?: string; status?: WorkforceTaskStatus } = {}): Promise<WorkforceTask[]> {
  const agentId = options.agentId === undefined ? undefined : normalizeAgentId(options.agentId);
  return (await readTasks(paths))
    .filter((task) => agentId === undefined || task.agentId === agentId)
    .filter((task) => options.status === undefined || task.status === options.status)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function updateWorkforceTaskStatus(paths: RuntimePaths, id: string, status: WorkforceTaskStatus, result?: string): Promise<WorkforceTask> {
  const tasks = await readTasks(paths);
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) {
    throw new Error(`Task '${id}' does not exist.`);
  }

  const existing = tasks[index];
  const updated: WorkforceTask = {
    ...existing,
    status,
    updatedAt: new Date().toISOString(),
    ...(result === undefined ? {} : { result: requireNonEmpty(result, "result") }),
  };
  tasks[index] = updated;
  await writeTasks(paths, tasks);
  return updated;
}

async function readTasks(paths: RuntimePaths): Promise<WorkforceTask[]> {
  try {
    const raw = await readFile(workforceTasksPath(paths), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("Agent Workforce task inbox is not a JSON array.");
    }
    return parsed.map(parseTask);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeTasks(paths: RuntimePaths, tasks: WorkforceTask[]): Promise<void> {
  await mkdir(resolve(paths.appDir, "agents"), { recursive: true });
  await writeFile(workforceTasksPath(paths), `${JSON.stringify(tasks, null, 2)}\n`, { mode: 0o600 });
}

function parseTask(value: unknown): WorkforceTask {
  if (!isRecord(value)) throw new Error("Agent Workforce task inbox contains an invalid task.");
  const status = value.status;
  if (status !== "queued" && status !== "in_progress" && status !== "done" && status !== "blocked" && status !== "canceled") {
    throw new Error("Agent Workforce task inbox contains an invalid task status.");
  }
  return {
    id: requireNonEmpty(String(value.id ?? ""), "id"),
    agentId: normalizeAgentId(String(value.agentId ?? "")),
    title: requireNonEmpty(String(value.title ?? ""), "title"),
    brief: requireNonEmpty(String(value.brief ?? ""), "brief"),
    status,
    createdAt: requireNonEmpty(String(value.createdAt ?? ""), "createdAt"),
    updatedAt: requireNonEmpty(String(value.updatedAt ?? ""), "updatedAt"),
    createdBy: value.createdBy === "bestie" || value.createdBy === "system" ? value.createdBy : "user",
    ...(typeof value.result === "string" && value.result.trim() ? { result: value.result } : {}),
  };
}

function normalizeTitle(title: string | undefined, brief: string): string {
  if (title !== undefined && title.trim()) return title.trim();
  const normalizedBrief = requireNonEmpty(brief, "brief").replace(/\s+/g, " ");
  return normalizedBrief.length <= 80 ? normalizedBrief : `${normalizedBrief.slice(0, 77)}...`;
}

function createTaskId(now: string): string {
  return `task-${now.replace(/[^0-9]/g, "")}-${Math.random().toString(36).slice(2, 8)}`;
}

function requireNonEmpty(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${fieldName} is required.`);
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
