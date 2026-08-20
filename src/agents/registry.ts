import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadConfig, writeConfig, type AgentChannelBinding, type AppConfig, type PublicWorkforceAgentConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";

export type WorkforceAgentApprovalPolicy = "ask-for-external-actions" | "ask-for-all-actions" | "deny-external-actions";

export interface WorkforceAgentConfig {
  enabled: boolean;
  displayName: string;
  role: string;
  description: string;
  promptPath: string;
  model?: string;
  tools?: string[];
  channels?: AgentChannelBinding[];
  memoryScope: string;
  approvalPolicy: WorkforceAgentApprovalPolicy;
  public?: PublicWorkforceAgentConfig;
}

export interface HireWorkforceAgentInput {
  id: string;
  displayName: string;
  role: string;
  description: string;
  model?: string;
  tools?: string[];
  approvalPolicy?: WorkforceAgentApprovalPolicy;
}

export interface UpdateWorkforceAgentInput {
  displayName: string;
  role: string;
  description: string;
  model?: string;
  tools?: string[];
  approvalPolicy?: WorkforceAgentApprovalPolicy;
  public?: PublicWorkforceAgentConfig | null;
}

export interface WorkforceAgentRecord extends WorkforceAgentConfig {
  id: string;
}

export function agentsDir(paths: RuntimePaths): string {
  return resolve(paths.appDir, "agents");
}

export function agentDir(paths: RuntimePaths, agentId: string): string {
  return resolve(agentsDir(paths), agentId);
}

export function defaultAgentPromptPath(paths: RuntimePaths, agentId: string): string {
  return resolve(agentDir(paths, agentId), "system-prompt.md");
}

export async function listWorkforceAgents(paths: RuntimePaths): Promise<WorkforceAgentRecord[]> {
  const config = await loadConfig(paths);
  return Object.entries(config.agents ?? {})
    .map(([id, agent]) => ({ id, ...agent }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export async function getWorkforceAgent(paths: RuntimePaths, id: string): Promise<WorkforceAgentRecord | undefined> {
  const normalizedId = normalizeAgentId(id);
  const config = await loadConfig(paths);
  const agent = config.agents?.[normalizedId];
  return agent ? { id: normalizedId, ...agent } : undefined;
}

export async function hireWorkforceAgent(paths: RuntimePaths, input: HireWorkforceAgentInput): Promise<WorkforceAgentRecord> {
  const id = normalizeAgentId(input.id);
  const config = await loadConfig(paths);
  if (config.agents?.[id]) {
    throw new Error(`Agent '${id}' already exists.`);
  }

  const promptPath = defaultAgentPromptPath(paths, id);
  const agent: WorkforceAgentConfig = {
    enabled: true,
    displayName: requireNonEmpty(input.displayName, "displayName"),
    role: requireNonEmpty(input.role, "role"),
    description: requireNonEmpty(input.description, "description"),
    promptPath,
    ...(input.model === undefined ? {} : { model: normalizeAgentModel(input.model) }),
    ...(input.tools === undefined || input.tools.length === 0 ? {} : { tools: normalizeTools(input.tools) }),
    memoryScope: `agent:${id}`,
    approvalPolicy: input.approvalPolicy ?? "ask-for-external-actions",
  };

  await mkdir(agentDir(paths, id), { recursive: true });
  await writeFile(promptPath, defaultAgentPrompt(agent), { mode: 0o600 });
  await saveAgentsConfig(paths, config, { ...(config.agents ?? {}), [id]: agent });

  return { id, ...agent };
}

export async function setWorkforceAgentEnabled(paths: RuntimePaths, id: string, enabled: boolean): Promise<WorkforceAgentRecord> {
  const normalizedId = normalizeAgentId(id);
  const config = await loadConfig(paths);
  const existing = config.agents?.[normalizedId];
  if (!existing) {
    throw new Error(`Agent '${normalizedId}' does not exist.`);
  }

  const updated = { ...existing, enabled };
  await saveAgentsConfig(paths, config, { ...(config.agents ?? {}), [normalizedId]: updated });
  return { id: normalizedId, ...updated };
}

export async function bindWorkforceAgentChannel(paths: RuntimePaths, id: string, channel: AgentChannelBinding): Promise<WorkforceAgentRecord> {
  const normalizedId = normalizeAgentId(id);
  const config = await loadConfig(paths);
  const existing = config.agents?.[normalizedId];
  if (!existing) throw new Error(`Agent '${normalizedId}' does not exist.`);

  const agents = { ...(config.agents ?? {}) };
  for (const [otherId, agent] of Object.entries(agents)) {
    if (otherId !== normalizedId && agent.channels?.includes(channel)) {
      const otherChannels = agent.channels.filter((item) => item !== channel);
      const updatedAgent = { ...agent, ...(otherChannels.length ? { channels: otherChannels } : {}) };
      if (otherChannels.length === 0) delete updatedAgent.channels;
      agents[otherId] = updatedAgent;
    }
  }
  const channels = [...new Set([...(existing.channels ?? []), channel])];
  agents[normalizedId] = { ...existing, channels };
  await saveAgentsConfig(paths, config, agents);
  return { id: normalizedId, ...agents[normalizedId] };
}

export async function unbindWorkforceAgentChannel(paths: RuntimePaths, id: string, channel: AgentChannelBinding): Promise<WorkforceAgentRecord> {
  const normalizedId = normalizeAgentId(id);
  const config = await loadConfig(paths);
  const existing = config.agents?.[normalizedId];
  if (!existing) throw new Error(`Agent '${normalizedId}' does not exist.`);
  const channels = existing.channels?.filter((item) => item !== channel);
  const updated = { ...existing, ...(channels?.length ? { channels } : {}) };
  if (!channels?.length) delete updated.channels;
  await saveAgentsConfig(paths, config, { ...(config.agents ?? {}), [normalizedId]: updated });
  return { id: normalizedId, ...updated };
}

export async function updateWorkforceAgent(paths: RuntimePaths, id: string, input: UpdateWorkforceAgentInput): Promise<WorkforceAgentRecord> {
  const normalizedId = normalizeAgentId(id);
  const config = await loadConfig(paths);
  const existing = config.agents?.[normalizedId];
  if (!existing) {
    throw new Error(`Agent '${normalizedId}' does not exist.`);
  }

  const updated: WorkforceAgentConfig = {
    ...existing,
    displayName: requireNonEmpty(input.displayName, "displayName"),
    role: requireNonEmpty(input.role, "role"),
    description: requireNonEmpty(input.description, "description"),
    ...(input.model === undefined || !input.model.trim() ? {} : { model: normalizeAgentModel(input.model) }),
    ...(input.tools === undefined || input.tools.length === 0 ? {} : { tools: normalizeTools(input.tools) }),
    approvalPolicy: input.approvalPolicy ?? existing.approvalPolicy,
  };
  if (input.model !== undefined && !input.model.trim()) delete updated.model;
  if (input.tools !== undefined && input.tools.length === 0) delete updated.tools;
  if (input.public === null) delete updated.public;
  if (input.public !== undefined && input.public !== null) updated.public = input.public;

  await saveAgentsConfig(paths, config, { ...(config.agents ?? {}), [normalizedId]: updated });
  return { id: normalizedId, ...updated };
}

export async function removeWorkforceAgent(paths: RuntimePaths, id: string): Promise<WorkforceAgentRecord> {
  const normalizedId = normalizeAgentId(id);
  const config = await loadConfig(paths);
  const existing = config.agents?.[normalizedId];
  if (!existing) {
    throw new Error(`Agent '${normalizedId}' does not exist.`);
  }

  const agents = { ...(config.agents ?? {}) };
  delete agents[normalizedId];
  await saveAgentsConfig(paths, config, agents);
  return { id: normalizedId, ...existing };
}

export function normalizeAgentId(id: string): string {
  const normalized = id.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(normalized)) {
    throw new Error("Agent id must be 2-63 chars and use lowercase letters, numbers, or hyphens.");
  }
  return normalized;
}

function normalizeTools(tools: string[]): string[] {
  const normalized = tools.map((tool) => requireNonEmpty(tool, "tool")).filter((tool, index, values) => values.indexOf(tool) === index);
  if (normalized.length === 0) {
    throw new Error("tools must include at least one non-empty tool name.");
  }
  return normalized;
}

function normalizeAgentModel(model: string): string {
  const normalized = requireNonEmpty(model, "model");
  const slashIndex = normalized.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= normalized.length - 1) {
    throw new Error("model must use provider/model format, for example openai/gpt-4.1-mini.");
  }
  return normalized;
}

function requireNonEmpty(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  return normalized;
}

async function saveAgentsConfig(paths: RuntimePaths, config: AppConfig, agents: Record<string, WorkforceAgentConfig>): Promise<void> {
  await writeConfig({ ...config, agents: Object.keys(agents).length === 0 ? undefined : agents }, paths);
}

function defaultAgentPrompt(agent: WorkforceAgentConfig): string {
  return `# ${agent.displayName}

You are a fixed Bestie Workforce agent.

Role: ${agent.role}

Mission:
${agent.description}

Operating rules:
- Work only within your assigned role and task brief.
- Report progress, blockers, assumptions, and recommended next actions clearly.
- Do not perform external, destructive, public, or money-related actions without approval.
- Keep private user context private and avoid storing secrets in memory.
`;
}
