import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { readUrlTool } from "./web-read-tools.js";

test("readUrlTool obeys deny ask and allow policies", async () => {
  const paths = await createTempPaths();
  const server = await createTestServer("MCP setup docs");

  try {
    const denied = await readUrlTool({ config: createConfig({ "internal.read_url": "deny" }), paths, url: server.url });
    assert.equal(denied.allowed, false);
    assert.match(denied.reason, /denied by config/);

    const needsApproval = await readUrlTool({ config: createConfig(), paths, url: server.url });
    assert.equal(needsApproval.allowed, false);
    assert.match(needsApproval.reason, /Approval required/);

    const allowed = await readUrlTool({ config: createConfig({ "internal.read_url": "allow" }), paths, url: server.url });
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.statusCode, 200);
    assert.match(allowed.content ?? "", /MCP setup docs/);
  } finally {
    await server.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("readUrlTool rejects non-http urls and truncates content", async () => {
  const paths = await createTempPaths();
  const server = await createTestServer("abcdef");

  try {
    const rejected = await readUrlTool({ config: createConfig({ "internal.read_url": "allow" }), paths, url: "file:///tmp/nope" });
    assert.equal(rejected.allowed, false);
    assert.match(rejected.reason, /http or https/);

    const truncated = await readUrlTool({ config: createConfig({ "internal.read_url": "allow" }), paths, url: server.url, maxBytes: 3 });
    assert.equal(truncated.allowed, true);
    assert.equal(truncated.content, "abc");
    assert.equal(truncated.truncated, true);
  } finally {
    await server.close();
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

function createConfig(policies: Record<string, "allow" | "ask" | "deny"> = {}): AppConfig {
  return {
    version: 2,
    agent: { name: "Bea", ownerName: "Andy", language: "vi", toneIntensity: 7 },
    llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key" as const,
          baseUrl: "http://127.0.0.1:9/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
    internalTools: { policies },
  };
}

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-web-read-tools-test-"));
  const appDir = resolve(rootDir, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");

  return {
    rootDir,
    appDir,
    configPath: resolve(appDir, "config.json"),
    envPath: resolve(appDir, ".env"),
    characterPath: resolve(appDir, "character.json"),
    systemPromptPath: resolve(appDir, "system-prompt.md"),
    logsDir,
    appLogPath: resolve(logsDir, "app.log"),
    dataDir,
    memoryDbPath: resolve(dataDir, "memory.sqlite"),
    workspaceDir: resolve(appDir, "workspace"),
  };
}

function createTestServer(body: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end(body);
  });

  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected TCP test server address."));
        return;
      }
      resolvePromise({
        url: `http://127.0.0.1:${address.port}/docs`,
        close: () => new Promise((resolveClose, rejectClose) => server.close((error) => (error ? rejectClose(error) : resolveClose()))),
      });
    });
  });
}
