import { listMcpServers, type McpServerSummary } from "../../mcp/servers.js";
import { loadConfig } from "../../runtime/config.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

export interface UiMcpSummary {
  ok: true;
  counts: {
    total: number;
    enabled: number;
    disabled: number;
    tools: number;
  };
  servers: UiMcpServer[];
}

interface UiMcpServer {
  name: string;
  enabled: boolean;
  transport: McpServerSummary["transport"];
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

export async function getUiMcpSummary(paths: RuntimePaths = getRuntimePaths()): Promise<UiMcpSummary> {
  const config = await loadConfig(paths);
  const servers = listMcpServers(config).map(toUiMcpServer);
  const enabled = servers.filter((server) => server.enabled).length;
  return {
    ok: true,
    counts: {
      total: servers.length,
      enabled,
      disabled: servers.length - enabled,
      tools: servers.reduce((total, server) => total + server.tools.count, 0),
    },
    servers,
  };
}

function toUiMcpServer(server: McpServerSummary): UiMcpServer {
  const categories = Array.from(new Set(server.tools.map((tool) => tool.category))).sort();
  return {
    name: server.name,
    enabled: server.enabled,
    transport: server.transport,
    commandConfigured: Boolean(server.command),
    argCount: server.args.length,
    urlConfigured: Boolean(server.url),
    envKeys: [...server.envKeys],
    headerNames: Object.keys(server.headers).sort(),
    headerEnvNames: Object.values(server.headersEnv).sort(),
    ...(server.auth ? { auth: { type: server.auth.type, envVar: server.auth.envVar, ...(server.auth.headerName ? { headerName: server.auth.headerName } : {}), scopes: server.auth.scopes ?? [] } } : {}),
    tools: {
      count: server.tools.length,
      categories,
      names: server.tools.map((tool) => tool.name).sort(),
    },
  };
}