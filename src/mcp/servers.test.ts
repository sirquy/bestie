import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../runtime/config.js";
import { findMcpServer, listMcpServers, testMcpServerConfig } from "./servers.js";

const configWithServer: AppConfig = {
  version: 1,
  agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
  llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "model", apiKeyEnv: "BESTIE_LLM_API_KEY" },
  mcp: {
    servers: [{ name: "fs", enabled: true, command: "node", args: ["server.js"], env: { SECRET_TOKEN: "should-not-print", MODE: "readonly" } }],
  },
};

test("listMcpServers summarizes configured MCP servers without env values", () => {
  assert.deepEqual(listMcpServers(configWithServer), [
    { name: "fs", enabled: true, transport: "stdio", command: "node", args: ["server.js"], env: { SECRET_TOKEN: "should-not-print", MODE: "readonly" }, envKeys: ["MODE", "SECRET_TOKEN"], url: undefined, headers: {}, headersEnv: {}, tools: [] },
  ]);
});

test("listMcpServers summarizes remote MCP servers", () => {
  const config: AppConfig = {
    ...configWithServer,
    mcp: {
      servers: [{ name: "composio", enabled: true, transport: "http", url: "https://connect.composio.dev/mcp", headersEnv: { "x-consumer-api-key": "COMPOSIO_CONSUMER_API_KEY" }, tools: [{ name: "lookup", category: "read" }] }],
    },
  };

  assert.deepEqual(listMcpServers(config), [
    { name: "composio", enabled: true, transport: "http", command: undefined, args: [], env: {}, envKeys: [], url: "https://connect.composio.dev/mcp", headers: {}, headersEnv: { "x-consumer-api-key": "COMPOSIO_CONSUMER_API_KEY" }, tools: [{ name: "lookup", category: "read" }] },
  ]);
});

test("listMcpServers returns an empty list when MCP is not configured", () => {
  const config: AppConfig = {
    version: 1,
    agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
    llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "model", apiKeyEnv: "BESTIE_LLM_API_KEY" },
  };

  assert.deepEqual(listMcpServers(config), []);
});

test("findMcpServer returns a server summary by name", () => {
  assert.equal(findMcpServer(configWithServer, "fs")?.command, "node");
  assert.equal(findMcpServer(configWithServer, "missing"), undefined);
});

test("testMcpServerConfig reports config-only status", () => {
  assert.deepEqual(testMcpServerConfig(configWithServer, "fs"), {
    ok: true,
    status: "pass",
    message: "MCP server fs config is ready for a future connection test.",
  });
  assert.deepEqual(testMcpServerConfig({ ...configWithServer, mcp: { servers: [{ ...configWithServer.mcp!.servers[0], enabled: false }] } }, "fs"), {
    ok: true,
    status: "warn",
    message: "MCP server fs is configured but disabled.",
  });
  assert.deepEqual(testMcpServerConfig(configWithServer, "missing"), {
    ok: false,
    status: "fail",
    message: "MCP server not found: missing",
  });
});