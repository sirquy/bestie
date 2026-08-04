import { runQueuedWorkforceTasks, type WorkforceTaskRunResult } from "../../agents/executor.js";
import { assignWorkforceTask, listWorkforceTasks, updateWorkforceTaskStatus, type WorkforceTask, type WorkforceTaskStatus } from "../../agents/inbox.js";
import { hireWorkforceAgent, listWorkforceAgents, removeWorkforceAgent, setWorkforceAgentEnabled, updateWorkforceAgent, type WorkforceAgentApprovalPolicy, type WorkforceAgentRecord } from "../../agents/registry.js";
import { INTERNAL_TOOL_NAMES } from "../../chat/mcp-tool-use.js";
import { getDaemonChannelStatus, runDaemonCommand } from "../../cli/commands/daemon.js";
import { loadConfig } from "../../runtime/config.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

export interface UiAgentsSummary {
  ok: true;
  agents: WorkforceAgentRecord[];
  tasks: WorkforceTask[];
  daemon: {
    state: "running" | "stale" | "stopped";
    pid?: number;
    logPath?: string;
  };
  availableTools: UiAgentAvailableTool[];
  counts: {
    activeAgents: number;
    pausedAgents: number;
    queuedTasks: number;
    runningTasks: number;
    doneTasks: number;
    blockedTasks: number;
  };
}

export interface UiAgentAvailableTool {
  name: string;
  label: string;
  category: "Tệp & dữ liệu" | "Web" | "Git" | "MCP" | "Ghi file & lệnh" | "Agent Workforce" | "Media" | "Bộ nhớ" | "Tri thức" | "Lịch hẹn";
  description: string;
  risk: "low" | "medium" | "high";
}

export type UiAgentsActionOptions =
  | UiAgentsHireOptions
  | UiAgentsUpdateOptions
  | UiAgentsStateOptions
  | UiAgentsRemoveOptions
  | UiAgentsAssignOptions
  | UiAgentsTaskStatusOptions
  | UiAgentsRunOptions
  | UiAgentsDaemonOptions;

interface UiAgentsHireOptions {
  action: "hire";
  id: string;
  displayName: string;
  role: string;
  description: string;
  model?: string;
  tools?: string[];
  approvalPolicy?: WorkforceAgentApprovalPolicy;
  confirm: boolean;
  paths?: RuntimePaths;
}

interface UiAgentsStateOptions {
  action: "pause" | "resume";
  id: string;
  confirm: boolean;
  paths?: RuntimePaths;
}

interface UiAgentsRemoveOptions {
  action: "remove";
  id: string;
  confirm: boolean;
  paths?: RuntimePaths;
}

interface UiAgentsAssignOptions {
  action: "assign";
  agentId: string;
  title?: string;
  brief: string;
  confirm: boolean;
  paths?: RuntimePaths;
}

interface UiAgentsTaskStatusOptions {
  action: "task_status";
  id: string;
  status: WorkforceTaskStatus;
  result?: string;
  confirm: boolean;
  paths?: RuntimePaths;
}

interface UiAgentsRunOptions {
  action: "run";
  agentId?: string;
  limit?: number;
  confirm: boolean;
  paths?: RuntimePaths;
}

interface UiAgentsDaemonOptions {
  action: "daemon_start" | "daemon_stop" | "daemon_restart";
  confirm: boolean;
  paths?: RuntimePaths;
}

export interface UiAgentsActionResult extends UiAgentsSummary {
  action: UiAgentsActionOptions["action"];
  messages: string[];
  runResults?: WorkforceTaskRunResult[];
}

export async function getUiAgentsSummary(paths: RuntimePaths = getRuntimePaths()): Promise<UiAgentsSummary> {
  const [agents, tasks, daemon] = await Promise.all([
    listWorkforceAgents(paths),
    listWorkforceTasks(paths),
    getDaemonChannelStatus(paths, "workforce"),
  ]);

  return {
    ok: true,
    agents,
    tasks: tasks.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    daemon: {
      state: daemon.state,
      ...(daemon.pid !== undefined ? { pid: daemon.pid } : {}),
      ...(daemon.logPath ? { logPath: daemon.logPath } : {}),
    },
    availableTools: buildAvailableToolCatalog(),
    counts: {
      activeAgents: agents.filter((agent) => agent.enabled).length,
      pausedAgents: agents.filter((agent) => !agent.enabled).length,
      queuedTasks: tasks.filter((task) => task.status === "queued").length,
      runningTasks: tasks.filter((task) => task.status === "in_progress").length,
      doneTasks: tasks.filter((task) => task.status === "done").length,
      blockedTasks: tasks.filter((task) => task.status === "blocked").length,
    },
  };
}

interface UiAgentsUpdateOptions {
  action: "update";
  id: string;
  displayName: string;
  role: string;
  description: string;
  model?: string;
  tools?: string[];
  approvalPolicy?: WorkforceAgentApprovalPolicy;
  confirm: boolean;
  paths?: RuntimePaths;
}

function buildAvailableToolCatalog(): UiAgentAvailableTool[] {
  return INTERNAL_TOOL_NAMES.map((name) => ({
    name,
    label: toToolLabel(name),
    category: toToolCategory(name),
    description: toToolDescription(name),
    risk: toToolRisk(name),
  }));
}

function toToolLabel(name: string): string {
  return name.replace(/^internal\./, "").replace(/_/g, " ");
}

function toToolCategory(name: string): UiAgentAvailableTool["category"] {
  if (name.includes("workforce")) return "Agent Workforce";
  if (name.includes("knowledge") || name.includes("entity") || name.includes("relation")) return "Tri thức";
  if (name.includes("memor")) return "Bộ nhớ";
  if (name.includes("cron") || name.includes("schedule")) return "Lịch hẹn";
  if (name.includes("mcp")) return "MCP";
  if (name.includes("browser") || name === "internal.read_url") return "Web";
  if (name.includes("git")) return "Git";
  if (name.includes("image") || name.includes("video") || name.includes("send_photo") || name.includes("send_file")) return "Media";
  if (name === "internal.write_file" || name === "internal.edit_file" || name === "internal.apply_patch" || name === "internal.exec" || name === "internal.list_processes" || name === "internal.spawn_subagent") return "Ghi file & lệnh";
  return "Tệp & dữ liệu";
}

function toToolRisk(name: string): UiAgentAvailableTool["risk"] {
  if (name === "internal.write_file" || name === "internal.edit_file" || name === "internal.apply_patch" || name === "internal.exec" || name === "internal.spawn_subagent" || name.includes("delete") || name.includes("forget") || name.includes("remove") || name.includes("merge") || name.includes("update") || name.includes("hire") || name.includes("assign")) return "high";
  if (name === "internal.read_url" || name.includes("browser") || name.includes("send_") || name.includes("generate") || name.includes("remember") || name.includes("cron") || name.includes("mcp_")) return "medium";
  return "low";
}

function toToolDescription(name: string): string {
  if (name.includes("read_file")) return "Đọc nội dung file trong workspace hoặc path được cho phép.";
  if (name.includes("list_files") || name.includes("search_files")) return "Dò tìm file và thư mục trong workspace.";
  if (name.includes("read_logs")) return "Đọc log runtime gần đây để điều tra lỗi.";
  if (name.includes("browser") || name === "internal.read_url") return "Đọc hoặc thao tác trang web HTTP(S).";
  if (name.includes("git")) return "Xem trạng thái, diff hoặc lịch sử Git.";
  if (name.includes("mcp")) return "Quản lý hoặc đọc công cụ MCP đã cấu hình.";
  if (name === "internal.write_file" || name === "internal.edit_file" || name === "internal.apply_patch") return "Tạo hoặc chỉnh sửa file cục bộ.";
  if (name === "internal.exec" || name === "internal.list_processes") return "Chạy lệnh hoặc kiểm tra process cục bộ.";
  if (name === "internal.spawn_subagent") return "Tạo subagent tạm thời để xử lý một việc nhỏ.";
  if (name.includes("workforce")) return "Quản lý agent cố định và hàng đợi công việc.";
  if (name.includes("image") || name.includes("video")) return "Tạo media bằng provider đã cấu hình.";
  if (name.includes("send_")) return "Gửi file hoặc ảnh qua kênh đang hoạt động.";
  if (name.includes("knowledge") || name.includes("entity") || name.includes("relation")) return "Đọc hoặc cập nhật bản đồ tri thức.";
  if (name.includes("memor")) return "Đọc hoặc cập nhật bộ nhớ dài hạn.";
  if (name.includes("cron") || name.includes("schedule")) return "Quản lý tin nhắn hoặc việc hẹn giờ.";
  return "Công cụ nội bộ của Bestie.";
}

export async function runUiAgentsAction(options: UiAgentsActionOptions): Promise<UiAgentsActionResult> {
  if (!options.confirm) {
    throw new Error("Agent Workforce actions require confirm=true.");
  }

  const paths = options.paths ?? getRuntimePaths();
  const messages: string[] = [];
  let runResults: WorkforceTaskRunResult[] | undefined;

  if (options.action === "hire") {
    const agent = await hireWorkforceAgent(paths, options);
    messages.push(`Đã thuê ${agent.displayName} cho vai trò ${agent.role}.`);
  } else if (options.action === "update") {
    const agent = await updateWorkforceAgent(paths, options.id, options);
    messages.push(`Đã cập nhật ${agent.displayName}.`);
  } else if (options.action === "pause" || options.action === "resume") {
    const agent = await setWorkforceAgentEnabled(paths, options.id, options.action === "resume");
    messages.push(`${agent.displayName} hiện ${agent.enabled ? "đang hoạt động" : "đã tạm dừng"}.`);
  } else if (options.action === "remove") {
    const agent = await removeWorkforceAgent(paths, options.id);
    messages.push(`Đã gỡ ${agent.displayName} khỏi đội agent.`);
  } else if (options.action === "assign") {
    const task = await assignWorkforceTask(paths, { agentId: options.agentId, title: options.title, brief: options.brief, createdBy: "user" });
    messages.push(`Đã giao việc ${task.title} cho ${task.agentId}.`);
  } else if (options.action === "task_status") {
    const task = await updateWorkforceTaskStatus(paths, options.id, options.status, options.result);
    messages.push(`Đã cập nhật việc ${task.id} thành ${task.status}.`);
  } else if (options.action === "run") {
    runResults = await runQueuedWorkforceTasks({ config: await loadConfig(paths), paths, agentId: options.agentId, limit: options.limit });
    messages.push(runResults.length ? `Đã chạy ${runResults.length} việc trong hàng đợi.` : "Không có việc nào đang chờ.");
  } else {
    await runDaemonCommand({
      argv: ["node", "bestie", "daemon", toDaemonSubcommand(options.action), "--channel", "workforce"],
      paths,
      manageUi: false,
      writeLine: (message) => messages.push(message),
    });
  }

  return {
    ...(await getUiAgentsSummary(paths)),
    action: options.action,
    messages,
    ...(runResults ? { runResults } : {}),
  };
}

function toDaemonSubcommand(action: "daemon_start" | "daemon_stop" | "daemon_restart"): "start" | "stop" | "restart" {
  if (action === "daemon_start") return "start";
  if (action === "daemon_stop") return "stop";
  return "restart";
}
