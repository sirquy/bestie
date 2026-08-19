import { readFile } from "node:fs/promises";

import { prepareSystemPrompt } from "../character/prompt-loader.js";
import type { AgentToolRequest, AgentToolRunner, RunAgentToolRequestOptions } from "../chat/mcp-tool-use.js";
import type { AgentChannelBinding, AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import type { PermissionPolicy } from "../safety/permission-policy.js";
import type { WorkforceAgentRecord } from "./registry.js";

export interface ChannelAgentRuntime {
  agent: WorkforceAgentRecord;
  config: AppConfig;
  conversationUserId: string;
  systemPrompt: string;
  policy: PermissionPolicy;
}

export async function resolveChannelAgentRuntime(config: AppConfig, paths: RuntimePaths, channel: AgentChannelBinding, senderId: string): Promise<ChannelAgentRuntime | undefined> {
  const found = Object.entries(config.agents ?? {}).find(([, agent]) => agent.channels?.includes(channel));
  if (!found) return undefined;
  return resolveWorkforceAgentRuntime(config, paths, found[0], `the ${channel} channel`, `agent:${found[0]}:user:${senderId}`);
}

export async function resolveWorkforceAgentRuntime(config: AppConfig, paths: RuntimePaths, agentId: string | undefined, context: string, conversationUserId?: string): Promise<ChannelAgentRuntime | undefined> {
  if (!agentId) return undefined;
  const agentConfig = config.agents?.[agentId];
  if (!agentConfig) throw new Error(`Agent '${agentId}' no longer exists.`);
  const agent: WorkforceAgentRecord = { id: agentId, ...agentConfig };
  if (!agent.enabled) throw new Error(`Agent '${agent.displayName}' assigned to ${context} is paused.`);
  const prompt = await readFile(agent.promptPath, "utf8");
  const systemPrompt = await prepareSystemPrompt([
    prompt,
    `You are ${agent.displayName}, a Bestie workforce agent speaking directly with the user in ${context}.`,
    `Stay within your role: ${agent.role}.`,
    `Agent id: ${agent.id}. Memory scope: ${agent.memoryScope}. Approval policy: ${agent.approvalPolicy}.`,
    agent.tools?.length ? `Permitted tools: ${agent.tools.join(", ")}.` : "No additional tool allowlist is configured.",
  ].join("\n\n"), paths);
  return {
    agent,
    config: agent.model ? { ...config, llm: { ...config.llm, primary: agent.model } } : config,
    conversationUserId: conversationUserId ?? `agent:${agent.id}`,
    systemPrompt,
    policy: channelAgentPermissionPolicy(agent.approvalPolicy),
  };
}

export function buildChannelAgentToolRunner(agent: WorkforceAgentRecord, fallbackRunner: AgentToolRunner): AgentToolRunner {
  if (!agent.tools?.length) return fallbackRunner;
  const allowedTools = new Set(agent.tools);
  return async (options: RunAgentToolRequestOptions) => {
    const toolName = formatAgentToolName(options.request);
    if (!allowedTools.has(toolName)) return { ok: false, status: "fail", message: `${toolName} is not enabled for workforce agent ${agent.id}.` };
    return fallbackRunner(options);
  };
}

function channelAgentPermissionPolicy(policy: WorkforceAgentRecord["approvalPolicy"]): PermissionPolicy {
  if (policy === "ask-for-all-actions") return { allowTrustedRead: false, allowLocalWrite: false };
  if (policy === "deny-external-actions") return { allowTrustedRead: true, allowLocalWrite: false, denyExternalActions: true };
  return { allowTrustedRead: true, allowLocalWrite: false };
}

function formatAgentToolName(request: AgentToolRequest): string {
  return request.tool === "mcp.read" || request.tool === "mcp.call" ? `mcp.${request.server}.${request.name}` : request.tool;
}
