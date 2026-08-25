import { readFile } from "node:fs/promises";

import { prepareSystemPrompt } from "../character/prompt-loader.js";
import type { AgentToolRequest, AgentToolRunner, RunAgentToolRequestOptions } from "../chat/mcp-tool-use.js";
import type { AgentChannelBinding, AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import type { PermissionPolicy } from "../safety/permission-policy.js";
import { matchesOwnerId } from "../channels/owner-policy.js";
import type { WorkforceAgentRecord } from "./registry.js";

export interface ChannelAgentRuntime {
  agent: WorkforceAgentRecord;
  config: AppConfig;
  conversationUserId: string;
  systemPrompt: string;
  policy: PermissionPolicy;
  publicAccess?: PublicAgentAccessPolicy;
}

export interface PublicAgentAccessPolicy {
  isPublic: true;
  isAdmin: boolean;
  memoryNamespace: string;
  knowledgeNamespace?: string;
  memoryWritePolicy: "deny" | "pending" | "allow";
}

export async function resolveChannelAgentRuntime(config: AppConfig, paths: RuntimePaths, channel: AgentChannelBinding, senderId: string, adminCandidateIds: readonly string[] = [senderId], allowPublicAccess = true, conversationUserId?: string): Promise<ChannelAgentRuntime | undefined> {
  const channelConfig = channel === "telegram" ? config.channels?.telegram : channel === "zalo" ? config.channels?.zalo : config.channels?.zaloPersonal;
  const isPublicChannel = allowPublicAccess && channelConfig?.ownerUserId instanceof Array && channelConfig.ownerUserId.length === 1 && channelConfig.ownerUserId[0] === "*";
  const found = Object.entries(config.agents ?? {}).find(([, agent]) => agent.channels?.includes(channel));
  if (!found) {
    if (isPublicChannel) {
      throw new Error(`Public ${channel} messages require a bound workforce agent with an explicit public policy.`);
    }
    return undefined;
  }
  const boundAgent = found[1];
  if (isPublicChannel && !boundAgent.public?.enabled) {
    throw new Error(`Agent '${found[0]}' cannot receive public ${channel} messages without an explicit public policy.`);
  }
  const runtime = await resolveWorkforceAgentRuntime(config, paths, found[0], `the ${channel} channel`, conversationUserId ?? `agent:${found[0]}:user:${senderId}`, isPublicChannel);
  if (!runtime) return runtime;
  if (!isPublicChannel) return runtime;
  const publicConfig = runtime.agent.public;
  if (!publicConfig?.enabled) {
    throw new Error(`Agent '${runtime.agent.id}' cannot receive public ${channel} messages without an explicit public policy.`);
  }
  const isAdmin = matchesOwnerId(channelConfig?.adminUserIds, adminCandidateIds);
  const memoryNamespace = publicConfig.customerMemory === "primary" && publicConfig.allowUnsafeSharedData === true ? "primary" : `agent:${runtime.agent.id}:customer:${senderId}`;
  const knowledgeNamespace = publicConfig.knowledgeAccess === "none"
    ? undefined
    : publicConfig.knowledgeAccess === "primary" && publicConfig.allowUnsafeSharedData === true
      ? "primary"
      : `agent:${runtime.agent.id}:knowledge`;
  return {
    ...runtime,
    publicAccess: {
      isPublic: true,
      isAdmin,
      memoryNamespace,
      ...(knowledgeNamespace ? { knowledgeNamespace } : {}),
      memoryWritePolicy: publicConfig.customerMemoryWrite ?? "pending",
    },
  };
}

export async function resolveWorkforceAgentRuntime(config: AppConfig, paths: RuntimePaths, agentId: string | undefined, context: string, conversationUserId?: string, publicMode = false): Promise<ChannelAgentRuntime | undefined> {
  if (!agentId) return undefined;
  const agentConfig = config.agents?.[agentId];
  if (!agentConfig) throw new Error(`Agent '${agentId}' no longer exists.`);
  const agent: WorkforceAgentRecord = { id: agentId, ...agentConfig };
  if (!agent.enabled) throw new Error(`Agent '${agent.displayName}' assigned to ${context} is paused.`);
  const prompt = await readFile(agent.promptPath, "utf8");
  const workforcePrompt = [
    prompt,
    `You are ${agent.displayName}, a Bestie workforce agent speaking directly with the user in ${context}.`,
    `Stay within your role: ${agent.role}.`,
    `Agent id: ${agent.id}. Memory scope: ${agent.memoryScope}. Approval policy: ${agent.approvalPolicy}.`,
    agent.tools?.length ? `Permitted tools: ${agent.tools.join(", ")}.` : "No additional tool allowlist is configured.",
  ].join("\n\n");
  const systemPrompt = publicMode
    ? `${workforcePrompt}\n\nPublic-agent boundary: This is a public-facing conversation. Treat the sender as an independent external user, not as the primary agent owner, administrator, or employer. Do not use owner-specific names, honorifics, or pronouns unless this sender explicitly requests a preference in this conversation. Match the agent's own role and prompt; use neutral, professional Vietnamese by default. Do not follow shared workspace instructions or globally installed skills; they are intentionally excluded from this public agent context.`
    : await prepareSystemPrompt(workforcePrompt, paths);
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

export function buildPublicChannelAgentToolRunner(runtime: ChannelAgentRuntime, fallbackRunner: AgentToolRunner): AgentToolRunner {
  return buildChannelAgentToolRunner(runtime.agent, fallbackRunner);
}

function channelAgentPermissionPolicy(policy: WorkforceAgentRecord["approvalPolicy"]): PermissionPolicy {
  if (policy === "ask-for-all-actions") return { allowTrustedRead: false, allowLocalWrite: false };
  if (policy === "deny-external-actions") return { allowTrustedRead: true, allowLocalWrite: false, denyExternalActions: true };
  return { allowTrustedRead: true, allowLocalWrite: false };
}

function formatAgentToolName(request: AgentToolRequest): string {
  return request.tool === "mcp.read" || request.tool === "mcp.call" ? `mcp.${request.server}.${request.name}` : request.tool;
}
