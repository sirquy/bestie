import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { callMcpServerTool, listMcpServerTools, testMcpServerConnection } from "./connection.js";
import type { McpServerSummary } from "./servers.js";

const STDIO_TEST_TIMEOUT_MS = 5_000;

test("testMcpServerConnection initializes a stdio MCP server", async () => {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-mcp-connection-test-"));

  try {
    const serverPath = resolve(rootDir, "server.mjs");
    await writeFile(
      serverPath,
      `process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.trim().split(/\\r?\\n/)) {
    if (!line) continue;
    const request = JSON.parse(line);
    if (request.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "0.0.0" } } }) + "\\n");
    }
  }
});
`,
    );

    const result = await testMcpServerConnection(server("fake", process.execPath, [serverPath]), { timeoutMs: STDIO_TEST_TIMEOUT_MS });

    assert.deepEqual(result, { ok: true, status: "pass", message: "MCP server fake responded to initialize." });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("listMcpServerTools initializes and lists tool metadata", async () => {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-mcp-tools-test-"));

  try {
    const serverPath = resolve(rootDir, "server.mjs");
    await writeFile(
      serverPath,
      `process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.trim().split(/\\r?\\n/)) {
    if (!line) continue;
    const request = JSON.parse(line);
    if (request.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "0.0.0" } } }) + "\\n");
    }
    if (request.method === "tools/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "read_file", description: "Read a local file", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }, { name: "no_description", inputSchema: { type: "object" } }] } }) + "\\n");
    }
  }
});
`,
    );

    const result = await listMcpServerTools(server("fake", process.execPath, [serverPath]), { timeoutMs: STDIO_TEST_TIMEOUT_MS });

    assert.deepEqual(result, {
      ok: true,
      status: "pass",
      message: "MCP server fake returned 2 tool(s).",
      tools: [{ name: "read_file", description: "Read a local file", annotations: { readOnlyHint: true } }, { name: "no_description" }],
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("callMcpServerTool initializes and calls one tool", async () => {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-mcp-call-test-"));

  try {
    const serverPath = resolve(rootDir, "server.mjs");
    await writeFile(
      serverPath,
      `process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.trim().split(/\\r?\\n/)) {
    if (!line) continue;
    const request = JSON.parse(line);
    if (request.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "0.0.0" } } }) + "\\n");
    }
    if (request.method === "tools/call") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "hello " + request.params.arguments.name }] } }) + "\\n");
    }
  }
});
`,
    );

    const result = await callMcpServerTool(server("fake", process.execPath, [serverPath]), "greet", { name: "Miu" }, { timeoutMs: STDIO_TEST_TIMEOUT_MS });

    assert.deepEqual(result, {
      ok: true,
      status: "pass",
      message: "MCP tool fake/greet returned a result.",
      result: { content: [{ type: "text", text: "hello Miu" }] },
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("stdio MCP servers inherit scrubbed process env plus explicit server env", async () => {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-mcp-env-test-"));
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalVisible = process.env.BESTIE_VISIBLE_TEST_VALUE;

  try {
    process.env.OPENAI_API_KEY = "sk-process-secret";
    process.env.BESTIE_VISIBLE_TEST_VALUE = "visible";
    const serverPath = resolve(rootDir, "server.mjs");
    await writeFile(
      serverPath,
      `process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.trim().split(/\\r?\\n/)) {
    if (!line) continue;
    const request = JSON.parse(line);
    if (request.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "0.0.0" } } }) + "\\n");
    }
    if (request.method === "tools/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "env", description: JSON.stringify({ secret: process.env.OPENAI_API_KEY || null, explicit: process.env.EXPLICIT_SECRET_TOKEN || null, visible: process.env.BESTIE_VISIBLE_TEST_VALUE || null }), inputSchema: { type: "object" } }] } }) + "\\n");
    }
  }
});
`,
    );

    const result = await listMcpServerTools({ ...server("fake", process.execPath, [serverPath]), env: { EXPLICIT_SECRET_TOKEN: "configured-secret" } }, { timeoutMs: STDIO_TEST_TIMEOUT_MS });
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(result.tools[0]?.description ?? "{}"), { secret: null, explicit: "configured-secret", visible: "visible" });
  } finally {
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
    if (originalVisible === undefined) delete process.env.BESTIE_VISIBLE_TEST_VALUE;
    else process.env.BESTIE_VISIBLE_TEST_VALUE = originalVisible;
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("remote HTTP MCP servers initialize, list tools, call tools, and map secret headers from env", async () => {
  const requests: Array<{ method?: string; header?: string }> = [];
  const httpServer = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body) as { id: number; method?: string; params?: { arguments?: { name?: string } } };
    requests.push({ method: payload.method, header: request.headers["x-consumer-api-key"]?.toString() });

    response.setHeader("content-type", "application/json");
    if (payload.method === "initialize") {
      response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "remote", version: "0.0.0" } } }));
      return;
    }
    if (payload.method === "tools/list") {
      response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { tools: [{ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } }] } }));
      return;
    }
    response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { content: [{ type: "text", text: `hello ${payload.params?.arguments?.name}` }] } }));
  });

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  assert(address && typeof address === "object");
  try {
    const remoteServer = httpServerSummary(`http://127.0.0.1:${address.port}/mcp`);
    const options = { timeoutMs: 1_000, env: { COMPOSIO_CONSUMER_API_KEY: "secret-test-key" } };

    assert.deepEqual(await testMcpServerConnection(remoteServer, options), { ok: true, status: "pass", message: "MCP server composio responded to initialize." });
    assert.deepEqual(await listMcpServerTools(remoteServer, options), { ok: true, status: "pass", message: "MCP server composio returned 1 tool(s).", tools: [{ name: "lookup", description: "Lookup data" }] });
    assert.deepEqual(await callMcpServerTool(remoteServer, "lookup", { name: "Miu" }, options), { ok: true, status: "pass", message: "MCP tool composio/lookup returned a result.", result: { content: [{ type: "text", text: "hello Miu" }] } });
    assert(requests.length >= 5);
    assert.deepEqual(
      requests.map((request) => request.header),
      Array.from({ length: requests.length }, () => "secret-test-key"),
    );
  } finally {
    await new Promise<void>((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
  }
});

test("remote HTTP MCP servers fail before connecting when a header env var is missing", async () => {
  const result = await testMcpServerConnection(httpServerSummary("http://127.0.0.1:9/mcp"), { timeoutMs: 100, env: {} });

  assert.equal(result.ok, false);
  assert.equal(result.status, "fail");
  assert.match(result.message, /requires missing env var COMPOSIO_CONSUMER_API_KEY/);
});

test("testMcpServerConnection reports startup failures", async () => {
  const result = await testMcpServerConnection(server("missing", "definitely-not-an-bestie-command"), { timeoutMs: 100 });

  assert.equal(result.ok, false);
  assert.equal(result.status, "fail");
  assert.match(result.message, /could not start/);
});

test("testMcpServerConnection warns for disabled servers without starting them", async () => {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-mcp-disabled-test-"));

  try {
    const markerPath = resolve(rootDir, "started");
    const commandPath = resolve(rootDir, "server.sh");
    await writeFile(commandPath, `#!/usr/bin/env sh\ntouch ${markerPath}\n`);
    await chmod(commandPath, 0o700);

    const result = await testMcpServerConnection({ ...server("disabled", commandPath), enabled: false }, { timeoutMs: 100 });

    assert.deepEqual(result, { ok: true, status: "warn", message: "MCP server disabled is configured but disabled." });
    await assert.rejects(stat(markerPath), { code: "ENOENT" });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

function server(name: string, command: string, args: string[] = []): McpServerSummary {
  return { name, enabled: true, transport: "stdio", command, args, env: {}, envKeys: [], headers: {}, headersEnv: {}, tools: [] };
}

function httpServerSummary(url: string): McpServerSummary {
  return { name: "composio", enabled: true, transport: "http", args: [], env: {}, envKeys: [], url, headers: {}, headersEnv: { "x-consumer-api-key": "COMPOSIO_CONSUMER_API_KEY" }, tools: [] };
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}
