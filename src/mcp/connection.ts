import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { McpServerSummary } from "./servers.js";

export interface McpConnectionCheck {
  ok: boolean;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface McpToolSummary {
  name: string;
  description?: string;
}

export interface McpToolListResult extends McpConnectionCheck {
  tools: McpToolSummary[];
}

export interface McpToolCallResult extends McpConnectionCheck {
  result?: unknown;
}

export interface McpConnectionOptions {
  timeoutMs?: number;
  env?: Record<string, string>;
}

const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 30_000;

export async function testMcpServerConnection(server: McpServerSummary, options: McpConnectionOptions = {}): Promise<McpConnectionCheck> {
  if (!server.enabled) {
    return { ok: true, status: "warn", message: `MCP server ${server.name} is configured but disabled.` };
  }

  return withMcpClient(server, options, async () => ({ ok: true, status: "pass", message: `MCP server ${server.name} responded to initialize.` }));
}

export async function listMcpServerTools(server: McpServerSummary, options: McpConnectionOptions = {}): Promise<McpToolListResult> {
  if (!server.enabled) {
    return { ok: true, status: "warn", message: `MCP server ${server.name} is configured but disabled.`, tools: [] };
  }

  return withMcpClient(server, options, async (client) => {
    const response = await client.listTools(undefined, { timeout: options.timeoutMs ?? DEFAULT_MCP_CONNECT_TIMEOUT_MS });
    const tools = parseToolList(response);
    return { ok: true, status: "pass", message: `MCP server ${server.name} returned ${tools.length} tool(s).`, tools };
  });
}

export async function callMcpServerTool(server: McpServerSummary, toolName: string, args: Record<string, unknown>, options: McpConnectionOptions = {}): Promise<McpToolCallResult> {
  if (!server.enabled) {
    return { ok: true, status: "warn", message: `MCP server ${server.name} is configured but disabled.` };
  }

  return withMcpClient(server, options, async (client) => {
    const result = await client.callTool({ name: toolName, arguments: args }, undefined, { timeout: options.timeoutMs ?? DEFAULT_MCP_CONNECT_TIMEOUT_MS });
    return { ok: true, status: "pass", message: `MCP tool ${server.name}/${toolName} returned a result.`, result };
  });
}

async function withMcpClient<T extends McpConnectionCheck>(server: McpServerSummary, options: McpConnectionOptions, run: (client: Client) => Promise<T>): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_MCP_CONNECT_TIMEOUT_MS;
  const transportResult = createMcpTransport(server, options.env ?? {});
  if (!transportResult.ok) {
    return transportResult as T;
  }
  const transport = transportResult.transport;

  const client = new Client({ name: "bestie", version: "0.1.0" }, { capabilities: {} });
  const timeout = setTimeout(() => {
    void client.close().catch(() => undefined);
  }, timeoutMs);

  try {
    await client.connect(transport, { timeout: timeoutMs });
    return await run(client);
  } catch (error) {
    return { ok: false, status: "fail", message: formatMcpSdkError(server, error) } as T;
  } finally {
    clearTimeout(timeout);
    await client.close().catch(() => undefined);
  }
}

type McpTransportResult = { ok: false; status: "fail"; message: string; transport?: undefined } | { ok: true; transport: Transport };

function createMcpTransport(server: McpServerSummary, env: Record<string, string>): McpTransportResult {
  if (server.transport === "http" || server.transport === "streamable-http") {
    if (!server.url) {
      return { ok: false, status: "fail", message: `MCP server ${server.name} has no URL configured.` };
    }

    const resolvedHeaders = resolveHttpHeaders(server, env);
    if (!resolvedHeaders.ok) {
      return resolvedHeaders;
    }

    return {
      ok: true,
      transport: new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: resolvedHeaders.headers },
      }),
    };
  }

  if (!server.command) {
    return { ok: false, status: "fail", message: `MCP server ${server.name} has no command configured.` };
  }

  return {
    ok: true,
    transport: new StdioClientTransport({ command: server.command, args: server.args, env: { ...definedProcessEnv(), ...server.env }, stderr: "pipe" }),
  };
}

function definedProcessEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

type ResolvedHttpHeaders = { ok: false; status: "fail"; message: string; headers?: undefined } | { ok: true; headers: Record<string, string> };

function resolveHttpHeaders(server: McpServerSummary, env: Record<string, string>): ResolvedHttpHeaders {
  const headers: Record<string, string> = { ...server.headers };
  for (const [headerName, envName] of Object.entries(server.headersEnv)) {
    const value = process.env[envName] ?? env[envName];
    if (!value) {
      return { ok: false, status: "fail", message: `MCP server ${server.name} header ${headerName} requires missing env var ${envName}.` };
    }
    headers[headerName] = value;
  }
  return { ok: true, headers };
}

function formatMcpSdkError(server: McpServerSummary, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout/i.test(message)) {
    return `MCP server ${server.name} did not respond within the configured timeout.`;
  }
  if (/ENOENT|spawn/i.test(message)) {
    return `MCP server ${server.name} could not start: ${message}`;
  }
  return `MCP server ${server.name} failed: ${message}`;
}

function parseToolList(result: unknown): McpToolSummary[] {
  if (!isRecord(result) || !Array.isArray(result.tools)) {
    return [];
  }

  return result.tools.flatMap((tool) => {
    if (!isRecord(tool) || typeof tool.name !== "string" || tool.name.trim().length === 0) {
      return [];
    }

    return [{ name: tool.name, ...(typeof tool.description === "string" && tool.description.trim().length > 0 ? { description: tool.description } : {}) }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}