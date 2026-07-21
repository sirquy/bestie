import { loadConfig, type AppConfig, type InternalToolPolicy } from "../../runtime/config.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

export interface UiToolsSummary {
  ok: true;
  policies: {
    count: number;
    allow: number;
    ask: number;
    deny: number;
    entries: UiToolPolicyEntry[];
  };
  workspace: {
    defaultPath?: string;
    externalPathCount: number;
    externalPaths: string[];
  };
  exec: {
    timeoutMs?: number;
  };
}

interface UiToolPolicyEntry {
  tool: string;
  policy: InternalToolPolicy;
}

export async function getUiToolsSummary(paths: RuntimePaths = getRuntimePaths()): Promise<UiToolsSummary> {
  const config = await loadConfig(paths);
  return {
    ok: true,
    policies: buildPolicySummary(config.internalTools?.policies ?? {}),
    workspace: {
      ...(config.workspace?.defaultPath ? { defaultPath: config.workspace.defaultPath } : {}),
      externalPathCount: config.workspace?.externalPaths?.length ?? 0,
      externalPaths: [...(config.workspace?.externalPaths ?? [])],
    },
    exec: {
      ...(config.internalTools?.exec?.timeoutMs !== undefined ? { timeoutMs: config.internalTools.exec.timeoutMs } : {}),
    },
  };
}

function buildPolicySummary(policies: Record<string, InternalToolPolicy>): UiToolsSummary["policies"] {
  const entries = Object.entries(policies)
    .map(([tool, policy]) => ({ tool, policy }))
    .sort((left, right) => left.tool.localeCompare(right.tool));
  return {
    count: entries.length,
    allow: entries.filter((entry) => entry.policy === "allow").length,
    ask: entries.filter((entry) => entry.policy === "ask").length,
    deny: entries.filter((entry) => entry.policy === "deny").length,
    entries,
  };
}