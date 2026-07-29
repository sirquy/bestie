import { loadConfig, writeConfig, type AppConfig, type InternalToolPolicy, type WorkspaceExternalPathConfig } from "../../runtime/config.js";
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
      externalPaths: (config.workspace?.externalPaths ?? []).map(formatExternalPathSummary),
    },
    exec: {
      ...(config.internalTools?.exec?.timeoutMs !== undefined ? { timeoutMs: config.internalTools.exec.timeoutMs } : {}),
    },
  };
}

function formatExternalPathSummary(value: WorkspaceExternalPathConfig): string {
  if (typeof value === "string") return value;
  return value.access ? `${value.path} (${value.access})` : value.path;
}

export async function updateUiToolPolicy(options: { tool: string; policy: InternalToolPolicy; paths?: RuntimePaths }): Promise<UiToolsSummary> {
  const paths = options.paths ?? getRuntimePaths();
  const tool = options.tool.trim();
  if (!tool) throw new Error("Tool name is required.");
  if (!isInternalToolPolicy(options.policy)) throw new Error("Tool policy must be allow, ask, or deny.");

  const config = await loadConfig(paths);
  await writeConfig({
    ...config,
    internalTools: {
      ...(config.internalTools ?? {}),
      policies: { ...(config.internalTools?.policies ?? {}), [tool]: options.policy },
    },
  }, paths);
  return getUiToolsSummary(paths);
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

function isInternalToolPolicy(value: string): value is InternalToolPolicy {
  return value === "allow" || value === "ask" || value === "deny";
}
