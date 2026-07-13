import type { AppConfig, McpToolCategory } from "../runtime/config.js";

export interface McpConfiguredToolSummary {
  name: string;
  category: McpToolCategory;
}

export interface McpServerSummary {
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  command?: string;
  args: string[];
  env: Record<string, string>;
  envKeys: string[];
  url?: string;
  headers: Record<string, string>;
  headersEnv: Record<string, string>;
  tools: McpConfiguredToolSummary[];
}

export interface McpServerConfigCheck {
  ok: boolean;
  status: "pass" | "warn" | "fail";
  message: string;
}

export function listMcpServers(config: AppConfig): McpServerSummary[] {
  return (config.mcp?.servers ?? []).map((server) => ({
    name: server.name,
    enabled: server.enabled,
    transport: server.transport ?? "stdio",
    command: server.command,
    args: server.args ?? [],
    env: server.env ?? {},
    envKeys: Object.keys(server.env ?? {}).sort(),
    url: server.url,
    headers: server.headers ?? {},
    headersEnv: server.headersEnv ?? {},
    tools: server.tools ?? [],
  }));
}

export function findConfiguredMcpTool(server: McpServerSummary, toolName: string): McpConfiguredToolSummary | undefined {
  return server.tools.find((tool) => tool.name === toolName);
}

export function findMcpServer(config: AppConfig, name: string): McpServerSummary | undefined {
  return listMcpServers(config).find((server) => server.name === name);
}

export function testMcpServerConfig(config: AppConfig, name: string): McpServerConfigCheck {
  const server = findMcpServer(config, name);

  if (!server) {
    return { ok: false, status: "fail", message: `MCP server not found: ${name}` };
  }

  if (!server.enabled) {
    return { ok: true, status: "warn", message: `MCP server ${name} is configured but disabled.` };
  }

  return { ok: true, status: "pass", message: `MCP server ${name} config is ready for a future connection test.` };
}