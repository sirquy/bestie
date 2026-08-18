export type ToolPolicy = "allow" | "ask" | "deny";

export interface ToolsSummary {
  ok: true;
  policies: {
    count: number;
    allow: number;
    ask: number;
    deny: number;
    entries: ToolPolicyEntry[];
  };
  workspace: {
    defaultPath?: string;
    externalPathCount: number;
    externalPaths: string[];
  };
  exec: {
    timeoutMs?: number;
  };
  browser: {
    cdpEndpoint?: string;
  };
}

export interface ToolPolicyEntry {
  tool: string;
  policy: ToolPolicy;
}
