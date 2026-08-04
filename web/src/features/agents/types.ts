export type WorkforceTaskStatus = "queued" | "in_progress" | "done" | "blocked" | "canceled";
export type WorkforceApprovalPolicy = "ask-for-external-actions" | "ask-for-all-actions" | "deny-external-actions";

export interface WorkforceAgent {
  id: string;
  enabled: boolean;
  displayName: string;
  role: string;
  description: string;
  promptPath: string;
  model?: string;
  tools?: string[];
  memoryScope: string;
  approvalPolicy: WorkforceApprovalPolicy;
}

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

export interface AgentsSummary {
  ok: true;
  agents: WorkforceAgent[];
  tasks: WorkforceTask[];
  availableTools: AgentAvailableTool[];
  daemon: {
    state: "running" | "stale" | "stopped";
    pid?: number;
    logPath?: string;
  };
  counts: {
    activeAgents: number;
    pausedAgents: number;
    queuedTasks: number;
    runningTasks: number;
    doneTasks: number;
    blockedTasks: number;
  };
}

export interface AgentAvailableTool {
  name: string;
  label: string;
  category: "Tệp & dữ liệu" | "Web" | "Git" | "MCP" | "Ghi file & lệnh" | "Agent Workforce" | "Media" | "Bộ nhớ" | "Tri thức" | "Lịch hẹn";
  description: string;
  risk: "low" | "medium" | "high";
}

export interface AgentsActionResult extends AgentsSummary {
  action: "hire" | "update" | "pause" | "resume" | "remove" | "assign" | "task_status" | "run" | "daemon_start" | "daemon_stop" | "daemon_restart";
  messages: string[];
}
