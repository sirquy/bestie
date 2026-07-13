import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

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

  if (server.transport === "http") {
    return withHttpMcpServerSession(server, options, async () => ({ ok: true, status: "pass", message: `MCP server ${server.name} responded to initialize.` }));
  }

  return withMcpServerSession(server, options, async () => ({ ok: true, status: "pass", message: `MCP server ${server.name} responded to initialize.` }));
}

export async function listMcpServerTools(server: McpServerSummary, options: McpConnectionOptions = {}): Promise<McpToolListResult> {
  if (!server.enabled) {
    return { ok: true, status: "warn", message: `MCP server ${server.name} is configured but disabled.`, tools: [] };
  }

  if (server.transport === "http") {
    return withHttpMcpServerSession(server, options, async (session) => {
      const response = await session.request(2, "tools/list", {});

      if (!response.ok) {
        return { ...response, tools: [] };
      }

      const tools = parseToolList(response.result);
      return { ok: true, status: "pass", message: `MCP server ${server.name} returned ${tools.length} tool(s).`, tools };
    });
  }

  return withMcpServerSession(server, options, async (session) => {
    const response = await session.request(2, "tools/list", {});

    if (!response.ok) {
      return { ...response, tools: [] };
    }

    const tools = parseToolList(response.result);
    return { ok: true, status: "pass", message: `MCP server ${server.name} returned ${tools.length} tool(s).`, tools };
  });
}

export async function callMcpServerTool(server: McpServerSummary, toolName: string, args: Record<string, unknown>, options: McpConnectionOptions = {}): Promise<McpToolCallResult> {
  if (!server.enabled) {
    return { ok: true, status: "warn", message: `MCP server ${server.name} is configured but disabled.` };
  }

  if (server.transport === "http") {
    return withHttpMcpServerSession(server, options, async (session) => {
      const response = await session.request(2, "tools/call", { name: toolName, arguments: args });

      if (!response.ok) {
        return response;
      }

      return { ok: true, status: "pass", message: `MCP tool ${server.name}/${toolName} returned a result.`, result: response.result };
    });
  }

  return withMcpServerSession(server, options, async (session) => {
    const response = await session.request(2, "tools/call", { name: toolName, arguments: args });

    if (!response.ok) {
      return response;
    }

    return { ok: true, status: "pass", message: `MCP tool ${server.name}/${toolName} returned a result.`, result: response.result };
  });
}

async function withMcpServerSession<T extends McpConnectionCheck>(server: McpServerSummary, options: McpConnectionOptions, run: (session: McpServerSession) => Promise<T>): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_MCP_CONNECT_TIMEOUT_MS;
  const session = new McpServerSession(server, timeoutMs);

  try {
    const initializeResponse = await session.start();
    if (!initializeResponse.ok) {
      return initializeResponse as T;
    }

    return await run(session);
  } finally {
    session.close();
  }
}

async function withHttpMcpServerSession<T extends McpConnectionCheck>(server: McpServerSummary, options: McpConnectionOptions, run: (session: HttpMcpServerSession) => Promise<T>): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_MCP_CONNECT_TIMEOUT_MS;
  const session = new HttpMcpServerSession(server, timeoutMs, options.env ?? {});
  const initializeResponse = await session.start();
  if (!initializeResponse.ok) {
    return initializeResponse as T;
  }

  return run(session);
}

class HttpMcpServerSession {
  constructor(
    private readonly server: McpServerSummary,
    private readonly timeoutMs: number,
    private readonly env: Record<string, string>,
  ) {}

  async start(): Promise<McpConnectionCheck> {
    return this.request(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "bestie", version: "0.1.0" } });
  }

  async request(id: number, method: string, params: Record<string, unknown>): Promise<McpConnectionCheck & { result?: unknown }> {
    if (!this.server.url) {
      return { ok: false, status: "fail", message: `MCP server ${this.server.name} has no URL configured.` };
    }

    const resolvedHeaders = resolveHttpHeaders(this.server, this.env);
    if (!resolvedHeaders.ok) {
      return resolvedHeaders;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.server.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...resolvedHeaders.headers,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return { ok: false, status: "fail", message: `MCP server ${this.server.name} ${method} failed with HTTP ${response.status}.` };
      }

      const message = parseHttpMcpMessage(await response.text(), id);
      if (!message) {
        return { ok: false, status: "fail", message: `MCP server ${this.server.name} returned no JSON-RPC response for ${method}.` };
      }

      if (message.error) {
        return { ok: false, status: "fail", message: `MCP server ${this.server.name} ${method} failed: ${message.error.message ?? "unknown error"}` };
      }

      return { ok: true, status: "pass", message: `MCP server ${this.server.name} responded to ${method}.`, result: message.result };
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError" ? `did not respond to ${method} within ${this.timeoutMs}ms.` : `could not be reached: ${error instanceof Error ? error.message : String(error)}`;
      return { ok: false, status: "fail", message: `MCP server ${this.server.name} ${message}` };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function resolveHttpHeaders(server: McpServerSummary, env: Record<string, string>): (McpConnectionCheck & { headers?: undefined }) | { ok: true; headers: Record<string, string> } {
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

function parseHttpMcpMessage(body: string, id: number): { id?: unknown; error?: { message?: string }; result?: unknown } | undefined {
  for (const candidate of extractJsonRpcCandidates(body)) {
    try {
      const message = JSON.parse(candidate) as { id?: unknown; error?: { message?: string }; result?: unknown };
      if (message.id === id) {
        return message;
      }
    } catch {
      // Keep scanning for a JSON-RPC message in SSE or newline-delimited output.
    }
  }
  return undefined;
}

function extractJsonRpcCandidates(body: string): string[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{")) return [trimmed];

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line.length > 0 && line !== "[DONE]");
}

class McpServerSession {
  private stdout = "";
  private stderr = "";
  private child;

  constructor(
    private readonly server: McpServerSummary,
    private readonly timeoutMs: number,
  ) {
    if (!server.command) {
      throw new Error(`MCP server ${server.name} has no command configured.`);
    }
    this.child = spawn(server.command, server.args, {
      env: { ...process.env, ...server.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      this.stdout += chunk;
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
  }

  async start(): Promise<McpConnectionCheck> {
    return this.request(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "bestie", version: "0.1.0" } });
  }

  async request(id: number, method: string, params: Record<string, unknown>): Promise<McpConnectionCheck & { result?: unknown }> {
    const exited = new Promise<McpConnectionCheck>((resolve) => {
      this.child.once("error", (error) => resolve({ ok: false, status: "fail", message: `MCP server ${this.server.name} could not start: ${error.message}` }));
      this.child.once("exit", (code) => {
        resolve({ ok: false, status: "fail", message: `MCP server ${this.server.name} exited before ${method} completed with code ${code ?? "unknown"}.` });
      });
    });

    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);

    const response = await Promise.race([this.waitForResponse(id, method), exited]);

    if (!response.ok && this.stderr.trim().length > 0) {
      return { ...response, message: `${response.message} stderr: ${this.stderr.trim().slice(0, 200)}` };
    }

    return response;
  }

  close(): void {
    if (!this.child.killed) {
      this.child.kill();
    }
  }

  private async waitForResponse(id: number, method: string): Promise<McpConnectionCheck & { result?: unknown }> {
    const deadline = Date.now() + this.timeoutMs;

    while (Date.now() < deadline) {
      for (const line of this.stdout.split(/\r?\n/)) {
        if (!line.trim()) {
          continue;
        }

        try {
          const message = JSON.parse(line) as { id?: unknown; error?: { message?: string }; result?: unknown };
          if (message.id === id && message.error) {
            return { ok: false, status: "fail", message: `MCP server ${this.server.name} ${method} failed: ${message.error.message ?? "unknown error"}` };
          }
          if (message.id === id) {
            return { ok: true, status: "pass", message: `MCP server ${this.server.name} responded to ${method}.`, result: message.result };
          }
        } catch {
          // Ignore non-JSON startup output while waiting for the JSON-RPC response.
        }
      }

      await delay(25);
    }

    return { ok: false, status: "fail", message: `MCP server ${this.server.name} did not respond to ${method} within ${this.timeoutMs}ms.` };
  }
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