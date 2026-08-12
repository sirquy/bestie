import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { runServiceTool } from "./service-tools.js";

test("runServiceTool requires approval before changing the service", async () => {
  const paths = await createTempPaths();
  let invoked = false;
  try {
    const result = await runServiceTool({ action: "restart", config: createConfig(), paths, runServiceCommand: async () => { invoked = true; } });
    assert.equal(result.ok, false);
    assert.match(result.message, /Approval required/);
    assert.equal(invoked, false);
  } finally { await rm(paths.rootDir, { recursive: true, force: true }); }
});

test("runServiceTool runs an approved configured action", async () => {
  const paths = await createTempPaths();
  let subcommand = "";
  try {
    const result = await runServiceTool({ action: "stop", config: createConfig({ "internal.service_stop": "allow" }), paths, runServiceCommand: async (options) => { subcommand = options.argv?.[3] ?? ""; options.writeLine?.("Service stopped."); } });
    assert.equal(result.ok, true);
    assert.equal(subcommand, "stop");
    assert.deepEqual(result.result, { action: "stop", output: ["Service stopped."] });
  } finally { await rm(paths.rootDir, { recursive: true, force: true }); }
});

function createConfig(policies: Record<string, "allow" | "ask" | "deny"> = {}): AppConfig {
  return { version: 2, agent: { name: "Bea", ownerName: "Andy", language: "vi", toneIntensity: 7 }, llm: { primary: "openai/test-model", authProfile: "openai:api-key", profiles: { "openai:api-key": { provider: "openai-compatible", mode: "api-key", baseUrl: "http://127.0.0.1:9/v1", apiKeyEnv: "OPENAI_API_KEY" } }, modelCatalog: { "openai/test-model": { profile: "openai:api-key" } } }, internalTools: { policies } };
}

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-service-tools-test-"));
  const appDir = resolve(rootDir, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");
  return { rootDir, appDir, configPath: resolve(appDir, "config.json"), envPath: resolve(appDir, ".env"), characterPath: resolve(appDir, "character.json"), systemPromptPath: resolve(appDir, "system-prompt.md"), logsDir, appLogPath: resolve(logsDir, "app.log"), dataDir, memoryDbPath: resolve(dataDir, "memory.sqlite"), workspaceDir: resolve(appDir, "workspace") };
}
