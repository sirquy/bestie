import { existsSync } from "node:fs";
import { delimiter, isAbsolute, resolve } from "node:path";

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
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
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
const SECRET_ENV_NAME_PATTERN = /(?:api[_-]?key|token|secret|password|passwd|credential|authorization|auth|cookie|session)/i;

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

  try {
    await client.connect(transport, { timeout: timeoutMs });
    return await run(client);
  } catch (error) {
    return { ok: false, status: "fail", message: formatMcpSdkError(server, error) } as T;
  } finally {
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

  const processEnv = { ...definedProcessEnv(), ...server.env };
  if (!canResolveCommand(server.command, processEnv)) {
    return { ok: false, status: "fail", message: `MCP server ${server.name} could not start: command ${server.command} was not found.` };
  }

  return {
    ok: true,
    transport: new StdioClientTransport({ command: server.command, args: server.args, env: processEnv, stderr: "pipe" }),
  };
}

function definedProcessEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string" && !SECRET_ENV_NAME_PATTERN.test(entry[0])),
  );
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

function canResolveCommand(command: string, env: NodeJS.ProcessEnv): boolean {
  if (command.includes("/") || command.includes("\\") || isAbsolute(command)) {
    return existsSync(command);
  }

  const extensions = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const pathEntry of (env.PATH ?? process.env.PATH ?? "").split(delimiter)) {
    if (!pathEntry) continue;
    for (const extension of extensions) {
      if (existsSync(resolve(pathEntry, `${command}${extension}`))) {
        return true;
      }
    }
  }

  return false;
}

function formatMcpSdkError(server: McpServerSummary, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout/i.test(message)) {
    return `MCP server ${server.name} did not respond within the configured timeout.`;
  }
  if (/ENOENT|spawn|Connection closed/i.test(message)) {
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

    return [
      {
        name: tool.name,
        ...(typeof tool.description === "string" && tool.description.trim().length > 0 ? { description: tool.description } : {}),
        ...(isRecord(tool.annotations) ? { annotations: parseToolAnnotations(tool.annotations) } : {}),
      },
    ];
  });
}

function parseToolAnnotations(value: Record<string, unknown>): McpToolSummary["annotations"] {
  return {
    ...(typeof value.readOnlyHint === "boolean" ? { readOnlyHint: value.readOnlyHint } : {}),
    ...(typeof value.destructiveHint === "boolean" ? { destructiveHint: value.destructiveHint } : {}),
    ...(typeof value.openWorldHint === "boolean" ? { openWorldHint: value.openWorldHint } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
