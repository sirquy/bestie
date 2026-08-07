import type { PendingActionApproval } from "../memory/sqlite-store.js";
import type { SqliteMemoryStore } from "../memory/sqlite-store.js";
import { isInternalToolName, runAgentToolRequest } from "../chat/mcp-tool-use.js";
import type { AgentToolRequest } from "../chat/mcp-tool-use.js";
import type { AgentOutboundFileSender } from "../tools/channel-send-tools.js";
import type { McpToolCallResult } from "../mcp/connection.js";
import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";

export type ApprovalDecision = "approve" | "deny";
export type ApprovalExecutionStatus = "executed" | "denied" | "unsupported" | "invalid";

export interface ApprovalExecutionResult {
  status: ApprovalExecutionStatus;
  shortText: string;
  message: string;
  request?: AgentToolRequest;
  toolResult?: McpToolCallResult;
}

export async function executeApprovedAction(store: SqliteMemoryStore, approval: PendingActionApproval, decision: ApprovalDecision, options?: { config?: AppConfig; paths?: RuntimePaths; outboundFileSender?: AgentOutboundFileSender; toolRunner?: typeof runAgentToolRequest }): Promise<ApprovalExecutionResult> {
  const currentApproval = store.getPendingActionApprovalById(approval.id);
  if (!currentApproval || (decision === "approve" && currentApproval.status !== "approved") || (decision === "deny" && currentApproval.status !== "denied")) {
    return { status: "invalid", shortText: "Approval is not executable.", message: `Approval ${approval.id} is not in an executable state.` };
  }

  if (approval.target?.startsWith("pending-memory:")) {
    return executePendingMemoryApproval(store, approval, decision);
  }

  if (approval.target?.startsWith("pending-knowledge:")) {
    return executePendingKnowledgeApproval(store, approval, decision);
  }

  if (approval.payloadJson && options?.config && options.paths) {
    return executeInternalToolApproval(store, approval, decision, { config: options.config, paths: options.paths, outboundFileSender: options.outboundFileSender, toolRunner: options.toolRunner });
  }

  return {
    status: decision === "approve" ? "unsupported" : "denied",
    shortText: decision === "approve" ? `Approval ${approval.status}.` : "Action denied.",
    message:
      decision === "approve"
        ? `Approval ${approval.status}: ${approval.id}. This records the owner decision; execution for ${approval.action} is not implemented yet.`
        : `Approval ${approval.status}: ${approval.id}.`,
  };
}

async function executeInternalToolApproval(store: SqliteMemoryStore, approval: PendingActionApproval, decision: ApprovalDecision, options: { config: AppConfig; paths: RuntimePaths; outboundFileSender?: AgentOutboundFileSender; toolRunner?: typeof runAgentToolRequest }): Promise<ApprovalExecutionResult> {
  if (decision === "deny") {
    return { status: "denied", shortText: "Action denied.", message: `Approval ${approval.status}: ${approval.id}.` };
  }

  const request = parseApprovedToolRequest(approval.payloadJson);
  if (!request) {
    return { status: "invalid", shortText: "Invalid approval payload.", message: `Approval ${approval.status}: ${approval.id}. Stored action payload is invalid.` };
  }

  if (!store.markActionApprovalExecuted(approval.id)) {
    return { status: "invalid", shortText: "Approval already executed.", message: `Approval ${approval.id} was already executed or is no longer approved.` };
  }

  const isMcpRequest = request.tool === "mcp.read" || request.tool === "mcp.call";
  const toolConfig = isMcpRequest
    ? options.config
    : { ...options.config, internalTools: { ...options.config.internalTools, policies: { ...(options.config.internalTools?.policies ?? {}), [request.tool]: "allow" as const } } };
  const toolRunner = options.toolRunner ?? runAgentToolRequest;
  const result = await toolRunner({ config: toolConfig, paths: options.paths, request, outboundFileSender: options.outboundFileSender, skipPermissionReview: isMcpRequest });

  return {
    status: result.ok ? "executed" : "invalid",
    shortText: result.ok ? "Action executed." : "Action failed.",
    message: `Approval ${approval.status}: ${approval.id}. ${result.ok ? "Executed" : "Failed"} ${request.tool}: ${result.message}`,
    request,
    toolResult: result,
  };
}

function parseApprovedToolRequest(payloadJson: string | undefined): AgentToolRequest | undefined {
  if (!payloadJson) return undefined;

  try {
    const parsed = JSON.parse(payloadJson) as Partial<AgentToolRequest>;
    if (typeof parsed.tool !== "string" || typeof parsed.arguments !== "object" || parsed.arguments === null) {
      return undefined;
    }
    if ((parsed.tool === "mcp.read" || parsed.tool === "mcp.call") && typeof (parsed as { server?: unknown }).server === "string" && typeof (parsed as { name?: unknown }).name === "string") {
      return { tool: parsed.tool, server: (parsed as { server: string }).server, name: (parsed as { name: string }).name, arguments: parsed.arguments as Record<string, unknown> };
    }
    return isInternalToolName(parsed.tool) ? { tool: parsed.tool, arguments: parsed.arguments as Record<string, unknown> } : undefined;
  } catch {
    return undefined;
  }
}

function executePendingMemoryApproval(store: SqliteMemoryStore, approval: PendingActionApproval, decision: ApprovalDecision): ApprovalExecutionResult {
  const pendingMemoryId = Number(approval.target?.slice("pending-memory:".length));

  if (!Number.isInteger(pendingMemoryId)) {
    return { status: "invalid", shortText: "Invalid pending memory target.", message: `Approval ${approval.status}: ${approval.id}. Invalid pending memory target.` };
  }

  if (decision === "approve") {
    if (!store.markActionApprovalExecuted(approval.id)) {
      return { status: "invalid", shortText: "Approval already executed.", message: `Approval ${approval.id} was already executed or is no longer approved.` };
    }

    const memory = store.approvePendingMemory(pendingMemoryId);
    return memory
      ? { status: "executed", shortText: "Memory saved.", message: `Memory approved and saved: ${memory.id}.` }
      : { status: "invalid", shortText: "Pending memory not found.", message: `Approval ${approval.status}: ${approval.id}, but pending memory ${pendingMemoryId} was not found.` };
  }

  const rejected = store.rejectPendingMemory(pendingMemoryId);
  return rejected
    ? { status: "denied", shortText: "Memory denied.", message: `Memory request denied: ${pendingMemoryId}.` }
    : { status: "invalid", shortText: "Pending memory not found.", message: `Approval ${approval.status}: ${approval.id}, but pending memory ${pendingMemoryId} was not found.` };
}

function executePendingKnowledgeApproval(store: SqliteMemoryStore, approval: PendingActionApproval, decision: ApprovalDecision): ApprovalExecutionResult {
  const pendingKnowledgeId = Number(approval.target?.slice("pending-knowledge:".length));

  if (!Number.isInteger(pendingKnowledgeId)) {
    return { status: "invalid", shortText: "Invalid pending knowledge target.", message: `Approval ${approval.status}: ${approval.id}. Invalid pending knowledge target.` };
  }

  if (decision === "approve") {
    if (!store.markActionApprovalExecuted(approval.id)) {
      return { status: "invalid", shortText: "Approval already executed.", message: `Approval ${approval.id} was already executed or is no longer approved.` };
    }

    const approved = store.approvePendingKnowledgeItem(pendingKnowledgeId);
    if (!approved) {
      return { status: "invalid", shortText: "Pending knowledge graph item not found.", message: `Approval ${approval.status}: ${approval.id}, but pending knowledge graph item ${pendingKnowledgeId} was not found.` };
    }
    if (approved.status === "blocked") {
      return { status: "invalid", shortText: "Knowledge graph blocked.", message: `Knowledge graph approval blocked: ${approved.explanation ?? approved.reason} No graph fact was stored. Reject or recreate the pending item with sanitized evidence.` };
    }
    return { status: "executed", shortText: "Knowledge graph saved.", message: `Knowledge graph approved and saved: ${approved.entities.length} entities, ${approved.relations.length} relations.` };
  }

  const rejected = store.rejectPendingKnowledgeItem(pendingKnowledgeId);
  return rejected
    ? { status: "denied", shortText: "Knowledge graph denied.", message: `Knowledge graph request denied: ${pendingKnowledgeId}.` }
    : { status: "invalid", shortText: "Pending knowledge graph item not found.", message: `Approval ${approval.status}: ${approval.id}, but pending knowledge graph item ${pendingKnowledgeId} was not found.` };
}
