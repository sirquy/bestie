export interface McpSummary {
  ok: true;
  counts: {
    total: number;
    enabled: number;
    disabled: number;
    tools: number;
  };
  servers: McpServer[];
}

export interface McpServer {
  name: string;
  enabled: boolean;
  transport: string;
  commandConfigured: boolean;
  argCount: number;
  urlConfigured: boolean;
  envKeys: string[];
  headerNames: string[];
  headerEnvNames: string[];
  auth?: {
    type: "oauth";
    envVar: string;
    headerName?: string;
    scopes: string[];
  };
  tools: {
    count: number;
    categories: string[];
    names: string[];
  };
}
