import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { assignWorkforceTask, listWorkforceTasks, updateWorkforceTaskStatus, type WorkforceTask, type WorkforceTaskStatus } from "../../agents/inbox.js";
import { runQueuedWorkforceTasks, watchQueuedWorkforceTasks } from "../../agents/executor.js";
import { getWorkforceAgent, hireWorkforceAgent, listWorkforceAgents, removeWorkforceAgent, setWorkforceAgentEnabled, type WorkforceAgentRecord } from "../../agents/registry.js";
import { loadConfig } from "../../runtime/config.js";
import { badge, dim, keyValue, rule, table, title } from "../ui.js";

export interface AgentsCommandOptions {
  argv?: string[];
  paths?: RuntimePaths;
  writeLine?: (message: string) => void;
}

export async function runAgentsCommand(options: AgentsCommandOptions | string[] = {}): Promise<void> {
  const argv = Array.isArray(options) ? options : options.argv ?? process.argv;
  const paths = Array.isArray(options) ? getRuntimePaths() : options.paths ?? getRuntimePaths();
  const writeLine = Array.isArray(options) ? console.log : options.writeLine ?? console.log;
  const subcommand = argv[3] ?? "list";

  try {
    if (subcommand === "--help" || subcommand === "-h" || subcommand === "help") return printAgentsHelp(writeLine);
    if (subcommand === "list") return await listAgents(paths, writeLine);
    if (subcommand === "show") return await showAgent(paths, requireArg(argv[4], "agent id"), writeLine);
    if (subcommand === "hire") return await hireAgent(paths, argv, writeLine);
    if (subcommand === "assign") return await assignTask(paths, argv, writeLine);
    if (subcommand === "tasks") return await listTasks(paths, argv, writeLine);
    if (subcommand === "task") return await showTask(paths, requireArg(argv[4], "task id"), writeLine);
    if (subcommand === "task-status") return await setTaskStatus(paths, argv, writeLine);
    if (subcommand === "run") return await runTasks(paths, argv, writeLine);
    if (subcommand === "pause") return await setAgentState(paths, requireArg(argv[4], "agent id"), false, writeLine);
    if (subcommand === "resume") return await setAgentState(paths, requireArg(argv[4], "agent id"), true, writeLine);
    if (subcommand === "remove") return await removeAgent(paths, requireArg(argv[4], "agent id"), writeLine);

    writeLine(`${badge("ERROR", "red")} Unknown agents command: ${subcommand}`);
    printAgentsHelp(writeLine);
    process.exitCode = 1;
  } catch (error) {
    writeLine(`${badge("ERROR", "red")} ${error instanceof Error ? error.message : "Could not manage agents."}`);
    process.exitCode = 1;
  }
}

async function listAgents(paths: RuntimePaths, writeLine: (message: string) => void): Promise<void> {
  const agents = await listWorkforceAgents(paths);
  if (agents.length === 0) {
    writeLine(`${badge("INFO", "blue")} No workforce agents yet. Use 'bestie agents hire' to create one.`);
    return;
  }

  writeLine(title("Agent Workforce"));
  writeLine(rule());
  for (const line of table(["ID", "Status", "Name", "Role", "Model"], agents.map((agent) => [agent.id, agent.enabled ? "active" : "paused", agent.displayName, agent.role, agent.model ?? "default"]))) {
    writeLine(line);
  }
}

async function showAgent(paths: RuntimePaths, id: string, writeLine: (message: string) => void): Promise<void> {
  const agent = await getWorkforceAgent(paths, id);
  if (!agent) {
    throw new Error(`Agent '${id}' does not exist.`);
  }

  writeLine(title(agent.displayName));
  writeLine(rule());
  for (const line of describeAgent(agent)) writeLine(line);
}

async function hireAgent(paths: RuntimePaths, argv: string[], writeLine: (message: string) => void): Promise<void> {
  const agent = await hireWorkforceAgent(paths, {
    id: requireFlag(argv, "--id"),
    displayName: requireFlag(argv, "--name"),
    role: requireFlag(argv, "--role"),
    description: requireFlag(argv, "--description"),
    model: optionalFlag(argv, "--model"),
    tools: optionalFlag(argv, "--tools")?.split(",").map((tool) => tool.trim()).filter(Boolean),
  });

  writeLine(`${badge("OK", "green")} Hired ${agent.displayName} as ${agent.role}.`);
  writeLine(dim(`Prompt: ${agent.promptPath}`));
}

async function assignTask(paths: RuntimePaths, argv: string[], writeLine: (message: string) => void): Promise<void> {
  const task = await assignWorkforceTask(paths, {
    agentId: requireFlag(argv, "--agent"),
    title: optionalFlag(argv, "--title"),
    brief: requireFlag(argv, "--brief"),
    createdBy: "user",
  });

  writeLine(`${badge("OK", "green")} Assigned task ${task.id} to ${task.agentId}.`);
  writeLine(dim(task.title));
}

async function listTasks(paths: RuntimePaths, argv: string[], writeLine: (message: string) => void): Promise<void> {
  const status = optionalTaskStatus(optionalFlag(argv, "--status"));
  const tasks = await listWorkforceTasks(paths, { agentId: optionalFlag(argv, "--agent"), status });
  if (tasks.length === 0) {
    writeLine(`${badge("INFO", "blue")} No Agent Workforce tasks found.`);
    return;
  }

  writeLine(title("Agent Tasks"));
  writeLine(rule());
  for (const line of table(["ID", "Agent", "Status", "Title"], tasks.map((task) => [task.id, task.agentId, task.status, task.title]))) {
    writeLine(line);
  }
}

async function showTask(paths: RuntimePaths, id: string, writeLine: (message: string) => void): Promise<void> {
  const task = (await listWorkforceTasks(paths)).find((item) => item.id === id);
  if (!task) {
    throw new Error(`Task '${id}' does not exist.`);
  }

  writeLine(title(task.title));
  writeLine(rule());
  for (const line of describeTask(task)) writeLine(line);
}

async function setTaskStatus(paths: RuntimePaths, argv: string[], writeLine: (message: string) => void): Promise<void> {
  const task = await updateWorkforceTaskStatus(paths, requireArg(argv[4], "task id"), requireTaskStatus(requireFlag(argv, "--status")), optionalFlag(argv, "--result"));
  writeLine(`${badge("OK", "green")} Task ${task.id} is now ${task.status}.`);
}

async function runTasks(paths: RuntimePaths, argv: string[], writeLine: (message: string) => void): Promise<void> {
  const config = await loadConfig(paths);
  const options = { config, paths, agentId: optionalFlag(argv, "--agent"), limit: optionalPositiveIntegerFlag(argv, "--limit") };
  if (argv.includes("--watch")) {
    writeLine(`${badge("INFO", "blue")} Watching Agent Workforce queue. Press Ctrl+C to stop.`);
    await watchQueuedWorkforceTasks({ ...options, intervalMs: optionalPositiveIntegerFlag(argv, "--interval-ms"), onBatch: (results) => printRunResults(results, writeLine, false) });
    return;
  }

  const results = await runQueuedWorkforceTasks(options);
  printRunResults(results, writeLine, true);
}

function printRunResults(results: Awaited<ReturnType<typeof runQueuedWorkforceTasks>>, writeLine: (message: string) => void, showEmpty: boolean): void {
  if (results.length === 0) {
    if (showEmpty) writeLine(`${badge("INFO", "blue")} No queued Agent Workforce tasks found.`);
    return;
  }

  for (const result of results) {
    writeLine(`${badge(result.status === "done" ? "OK" : "WARN", result.status === "done" ? "green" : "yellow")} ${result.task.id} ${result.status}.`);
    writeLine(dim(result.answer ?? result.error ?? result.task.title));
  }
}

async function setAgentState(paths: RuntimePaths, id: string, enabled: boolean, writeLine: (message: string) => void): Promise<void> {
  const agent = await setWorkforceAgentEnabled(paths, id, enabled);
  writeLine(`${badge("OK", "green")} ${agent.displayName} is now ${enabled ? "active" : "paused"}.`);
}

async function removeAgent(paths: RuntimePaths, id: string, writeLine: (message: string) => void): Promise<void> {
  const agent = await removeWorkforceAgent(paths, id);
  writeLine(`${badge("OK", "green")} Removed ${agent.displayName} from Agent Workforce.`);
  writeLine(dim("Prompt files were kept on disk for audit/history."));
}

function describeAgent(agent: WorkforceAgentRecord): string[] {
  return [
    keyValue("ID", agent.id),
    keyValue("Status", agent.enabled ? "active" : "paused"),
    keyValue("Role", agent.role),
    keyValue("Description", agent.description),
    keyValue("Model", agent.model ?? "default"),
    keyValue("Tools", agent.tools?.join(", ") ?? "none"),
    keyValue("Memory", agent.memoryScope),
    keyValue("Approvals", agent.approvalPolicy),
    keyValue("Prompt", agent.promptPath),
  ];
}

function describeTask(task: WorkforceTask): string[] {
  return [
    keyValue("Task", task.id),
    keyValue("Agent", task.agentId),
    keyValue("Status", task.status),
    keyValue("Title", task.title),
    keyValue("Brief", task.brief),
    keyValue("Created", task.createdAt),
    keyValue("Updated", task.updatedAt),
    ...(task.result === undefined ? [] : [keyValue("Result", task.result)]),
  ];
}

function requireArg(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function requireFlag(argv: string[], flag: string): string {
  return requireArg(optionalFlag(argv, flag), flag);
}

function optionalFlag(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
  return value;
}

function optionalPositiveIntegerFlag(argv: string[], flag: string): number | undefined {
  const value = optionalFlag(argv, flag);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

function optionalTaskStatus(value: string | undefined): WorkforceTaskStatus | undefined {
  return value === undefined ? undefined : requireTaskStatus(value);
}

function requireTaskStatus(value: string): WorkforceTaskStatus {
  if (value === "queued" || value === "in_progress" || value === "done" || value === "blocked" || value === "canceled") {
    return value;
  }
  throw new Error("Task status must be queued, in_progress, done, blocked, or canceled.");
}

function printAgentsHelp(writeLine: (message: string) => void): void {
  writeLine(`Bestie Agent Workforce

Usage:
  bestie agents list
  bestie agents show <id>
  bestie agents hire --id researcher --name Mika --role "Research Assistant" --description "Research and summarize information"
  bestie agents assign --agent researcher --title "Market brief" --brief "Summarize the weekly market signals"
  bestie agents tasks [--agent researcher] [--status queued]
  bestie agents task <task-id>
  bestie agents task-status <task-id> --status done --result "Summary delivered"
  bestie agents run [--agent researcher] [--limit 1]
  bestie agents run --watch [--agent researcher] [--interval-ms 30000]
  bestie agents pause <id>
  bestie agents resume <id>
  bestie agents remove <id>

This MVP creates fixed role agents with their own profile, prompt file, memory scope, approval policy, and task inbox.`);
}
