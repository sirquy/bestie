import type { AgentToolActivity } from "../chat/mcp-tool-use.js";

const SILENT_EXEC_COMMANDS = new Set(["date", "pwd", "whoami"]);

export function shouldShowToolProgress(activity: AgentToolActivity): boolean {
  if (activity.phase !== "start") {
    return false;
  }

  return !isSilentToolActivity(activity);
}

export function formatChannelToolProgress(activity: AgentToolActivity, agentName: string): string {
  const target = activity.label.trim();
  const suffix = target ? ` ${target}` : "";

  if (activity.toolName === "internal.list_files") return `${agentName} is listing files in${suffix}`;
  if (activity.toolName === "internal.read_file") return `${agentName} is reading file${suffix}`;
  if (activity.toolName === "internal.read_many_files") return `${agentName} is reading files${suffix}`;
  if (activity.toolName === "internal.read_markdown_bundle") return `${agentName} is collecting Markdown docs from${suffix}`;
  if (activity.toolName === "internal.search_files") return `${agentName} is searching files for${suffix}`;
  if (activity.toolName === "internal.read_logs") return `${agentName} is reading recent logs`;
  if (activity.toolName === "internal.list_memories") return `${agentName} is listing saved memories`;
  if (activity.toolName === "internal.search_memories") return `${agentName} is searching memories for${suffix}`;
  if (activity.toolName === "internal.analyze_memories") return `${agentName} is analyzing saved memories`;
  if (activity.toolName === "internal.remember_memory") return `${agentName} is preparing a memory approval`;
  if (activity.toolName === "internal.delete_memory") return `${agentName} is deleting memory${suffix}`;
  if (activity.toolName === "internal.cleanup_memories") return `${agentName} is cleaning saved memories`;
  if (activity.toolName.startsWith("mcp.") || activity.toolName.includes("/")) return `${agentName} is using read tool${suffix}`;

  return `${agentName} is working`;
}

function isSilentToolActivity(activity: AgentToolActivity): boolean {
  return activity.toolName === "internal.exec" && SILENT_EXEC_COMMANDS.has(activity.label.trim());
}
