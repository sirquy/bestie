import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { SqliteMemoryStore } from "../dist/memory/sqlite-store.js";
import { writeConfig } from "../dist/runtime/config.js";
import { writeEnvFile } from "../dist/runtime/env.js";

export async function seedUiSmokeRuntime(paths) {
  await mkdir(paths.appDir, { recursive: true });
  await writeConfig(
    {
      version: 2,
      agent: { name: "Bestie", ownerName: "Boss", language: "vi", toneIntensity: 7 },
      llm: {
        primary: "openai/test-model",
        fallbacks: ["gemini/gemini-2.5-flash"],
        authProfile: "openai:api-key",
        profiles: {
          "openai:api-key": { provider: "openai-compatible", mode: "api-key", baseUrl: "http://127.0.0.1:9/v1", apiKeyEnv: "OPENAI_API_KEY" },
          "gemini:api-key": { provider: "gemini", mode: "api-key", apiKeyEnv: "GEMINI_API_KEY" },
        },
        modelCatalog: {
          "openai/test-model": { profile: "openai:api-key" },
          "gemini/gemini-2.5-flash": { profile: "gemini:api-key" },
        },
      },
      memory: { writePolicy: "ask" },
      workspace: { defaultPath: ".bestie/workspace", externalPaths: ["../shared", "/tmp/bestie-ui-shared"] },
      internalTools: { policies: { "internal.exec": "ask", "internal.read_file": "allow", "internal.write_file": "deny" }, exec: { timeoutMs: 120_000 } },
      channels: {
        telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "111" },
        zalo: { enabled: false, botTokenEnv: "BESTIE_ZALO_BOT_TOKEN", ownerUserId: "zalo-owner" },
      },
      mcp: {
        servers: [
          { name: "fs", enabled: true, transport: "stdio", command: "node", args: ["server.js"], env: { MCP_SECRET: "super-secret-mcp" }, tools: [{ name: "read_file", category: "read" }] },
          { name: "remote-oauth", enabled: false, transport: "http", url: "https://mcp.example.invalid", headers: { "x-client-name": "bestie-smoke" }, headersEnv: { "x-api-key": "REMOTE_MCP_TOKEN" }, auth: { type: "oauth", authorizationUrl: "https://auth.example.invalid", clientId: "client-id", envVar: "REMOTE_MCP_OAUTH", scopes: ["tools.read"] }, tools: [{ name: "send", category: "public_action" }] },
        ],
      },
    },
    paths,
  );
  await writeEnvFile({ OPENAI_API_KEY: "test-key", GEMINI_API_KEY: "test-gemini-key", BESTIE_TELEGRAM_BOT_TOKEN: "telegram-test-token", REMOTE_MCP_TOKEN: "remote-token-value" }, paths);
  await writeFile(paths.characterPath, `${JSON.stringify({ name: "Bestie", role: "AI best friend companion", language: "vi-first", personality: ["funny", "sharp"], tone: { roastLevel: 2, warmthLevel: 8, bluntnessLevel: 4, chaosLevel: 3 }, boundaries: { neverJokeAbout: ["harm"], dropJokesWhen: ["crisis"] }, ownerName: "Boss" }, null, 2)}\n`, { mode: 0o600 });
  await writeFile(paths.systemPromptPath, "You are Bestie.\n", { mode: 0o600 });
  const store = await SqliteMemoryStore.open(paths);
  try {
    store.addMemory({ type: "preference", content: "User prefers concise replies.", source: "smoke", scope: "core" });
    store.addMemory({ type: "project_context", content: "Working on Bestie UI memory center.", source: "smoke", scope: "project" });
    store.addPendingMemory({ type: "sensitive_personal", content: "Review this memory before saving.", reason: "Sensitive memory requires approval.", source: "smoke" });
    store.addCronSchedule({ name: "Daily check", scheduleType: "cron_expr", scheduleValue: "0 8 * * *", prompt: "Send a short update.", channel: "telegram:111", nextRunAt: new Date(Date.now() + 60_000).toISOString() });
    store.addPendingActionApproval({ channel: "telegram", userId: "111", category: "local_write", action: "internal.write_file", target: "workspace/note.txt", reason: "Smoke approval", proposedReason: "Write a note", payloadJson: JSON.stringify({ path: "workspace/note.txt", content: "secret-ish payload" }) });
  } finally {
    store.close();
  }
}

export function createUiSmokeRuntimePaths(root) {
  const appDir = resolve(root, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");

  return {
    rootDir: root,
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