import { readFile } from "node:fs/promises";

import { completeWithAgentTools, runAgentToolRequest, type AgentToolChatCompletionRunner, type AgentToolRequest, type RunAgentToolRequestOptions } from "../chat/mcp-tool-use.js";
import { sendChatCompletionWithFallbacks } from "../llm/chat-completion.js";
import { loadLlmCandidateSecret, resolvePrimaryLlmCandidate } from "../llm/resolve-config.js";
import type { ChatCompletionOptions, ChatMessage } from "../llm/types.js";
import type { AppConfig } from "../runtime/config.js";
import { appendLog } from "../runtime/logger.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { getWorkforceAgent, type WorkforceAgentRecord } from "./registry.js";
import { listWorkforceTasks, updateWorkforceTaskStatus, type WorkforceTask } from "./inbox.js";

export interface RunWorkforceTasksOptions {
  config: AppConfig;
  paths: RuntimePaths;
  agentId?: string;
  limit?: number;
  apiKey?: string;
  chatCompletion?: AgentToolChatCompletionRunner;
  toolRunner?: (requestOptions: RunAgentToolRequestOptions) => ReturnType<typeof runAgentToolRequest>;
  maxToolCalls?: number;
}

export interface WatchWorkforceTasksOptions extends RunWorkforceTasksOptions {
  intervalMs?: number;
  shouldStop?: () => boolean;
  onBatch?: (results: WorkforceTaskRunResult[]) => void | Promise<void>;
}

export interface WorkforceTaskRunResult {
  task: WorkforceTask;
  status: "done" | "blocked";
  answer?: string;
  error?: string;
}

const DEFAULT_WORKFORCE_MAX_TOOL_CALLS = 25;
const DEFAULT_WORKFORCE_WATCH_INTERVAL_MS = 30_000;

const workforceChatCompletion: AgentToolChatCompletionRunner = (config: AppConfig, _apiKey: string, options: ChatCompletionOptions) =>
  sendChatCompletionWithFallbacks(config, options);

export async function runQueuedWorkforceTasks(options: RunWorkforceTasksOptions): Promise<WorkforceTaskRunResult[]> {
  const queuedTasks = await listWorkforceTasks(options.paths, { agentId: options.agentId, status: "queued" });
  const tasks = queuedTasks.slice(0, Math.max(options.limit ?? 1, 1));
  const results: WorkforceTaskRunResult[] = [];

  for (const task of tasks) {
    results.push(await runWorkforceTask(options, task));
  }

  return results;
}

export async function watchQueuedWorkforceTasks(options: WatchWorkforceTasksOptions): Promise<void> {
  const intervalMs = Math.max(options.intervalMs ?? DEFAULT_WORKFORCE_WATCH_INTERVAL_MS, 1_000);

  while (!options.shouldStop?.()) {
    const results = await runQueuedWorkforceTasks(options);
    await options.onBatch?.(results);
    if (options.shouldStop?.()) {
      return;
    }
    await sleep(intervalMs);
  }
}

export async function runWorkforceTask(options: RunWorkforceTasksOptions, task: WorkforceTask): Promise<WorkforceTaskRunResult> {
  const agent = await getWorkforceAgent(options.paths, task.agentId);
  if (!agent) {
    const blocked = await updateWorkforceTaskStatus(options.paths, task.id, "blocked", `Agent '${task.agentId}' does not exist.`);
    return { task: blocked, status: "blocked", error: `Agent '${task.agentId}' does not exist.` };
  }
  if (!agent.enabled) {
    const blocked = await updateWorkforceTaskStatus(options.paths, task.id, "blocked", `Agent '${task.agentId}' is paused.`);
    return { task: blocked, status: "blocked", error: `Agent '${task.agentId}' is paused.` };
  }

  await updateWorkforceTaskStatus(options.paths, task.id, "in_progress");
  await appendLog({ event: "workforce_task_start", detail: { taskId: task.id, agentId: task.agentId, title: task.title } }, { paths: options.paths });

  try {
    const effectiveConfig = agent.model ? { ...options.config, llm: { ...options.config.llm, primary: agent.model } } : options.config;
    const apiKey = options.apiKey ?? (await loadLlmCandidateSecret(resolvePrimaryLlmCandidate(effectiveConfig), options.paths));
    const answer = await completeWithAgentTools({
      config: effectiveConfig,
      paths: options.paths,
      apiKey,
      messages: await buildWorkforceMessages(agent, task),
      chatCompletion: options.chatCompletion ?? workforceChatCompletion,
      toolRunner: buildWorkforceToolRunner(agent, options),
      maxToolCalls: options.maxToolCalls ?? DEFAULT_WORKFORCE_MAX_TOOL_CALLS,
      streamFinalResponse: false,
      runtimeContext: `Agent Workforce task ${task.id} assigned to ${agent.id}.`,
    });
    const done = await updateWorkforceTaskStatus(options.paths, task.id, "done", answer);
    await appendLog({ event: "workforce_task_done", detail: { taskId: task.id, agentId: task.agentId } }, { paths: options.paths, knownSecrets: [apiKey] });
    return { task: done, status: "done", answer };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown workforce task error.";
    const blocked = await updateWorkforceTaskStatus(options.paths, task.id, "blocked", message);
    await appendLog({ event: "workforce_task_blocked", detail: { taskId: task.id, agentId: task.agentId, message } }, { paths: options.paths });
    return { task: blocked, status: "blocked", error: message };
  }
}

function buildWorkforceToolRunner(agent: WorkforceAgentRecord, options: RunWorkforceTasksOptions): (requestOptions: RunAgentToolRequestOptions) => ReturnType<typeof runAgentToolRequest> {
  if (!agent.tools?.length) return options.toolRunner ?? runAgentToolRequest;
  const allowedTools = new Set(agent.tools);
  const fallbackRunner = options.toolRunner ?? runAgentToolRequest;
  return async (requestOptions) => {
    const toolName = formatAgentToolName(requestOptions.request);
    if (!allowedTools.has(toolName)) {
      return { ok: false, status: "fail", message: `${toolName} is not enabled for workforce agent ${agent.id}.` };
    }
    return fallbackRunner(requestOptions);
  };
}

function formatAgentToolName(request: AgentToolRequest): string {
  return request.tool === "mcp.read" ? `mcp.${request.server}.${request.name}` : request.tool;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function buildWorkforceMessages(agent: WorkforceAgentRecord, task: WorkforceTask): Promise<ChatMessage[]> {
  const prompt = await readFile(agent.promptPath, "utf8");
  const system = [
    prompt.trim(),
    "You are executing one assigned Agent Workforce task. Stay inside your role and task brief.",
    "Return a concise result with evidence, assumptions, blockers, and recommended next action when relevant.",
    `Agent id: ${agent.id}. Memory scope: ${agent.memoryScope}. Approval policy: ${agent.approvalPolicy}.`,
    agent.tools?.length ? `Intended tool scope: ${agent.tools.join(", ")}.` : undefined,
  ].filter(Boolean).join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: [`Task title: ${task.title}`, `Task brief:\n${task.brief}`].join("\n\n") },
  ];
}
