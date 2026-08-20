import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { ZaloPersonalClient, type ZaloPersonalApi } from "../channels/zalo-personal/client.js";
import { encodeZaloPersonalSession } from "../channels/zalo-personal/session.js";
import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { runZaloPersonalOperationTool } from "./zalo-personal-tools.js";

test("Zalo Personal tool restores its session, executes allowed reads, and redacts context", async () => {
  const paths = await createTempPaths();
  const calls: unknown[][] = [];
  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.envPath, `BESTIE_ZALO_PERSONAL_SESSION=${JSON.stringify(encodeZaloPersonalSession({ cookie: [{ name: "session" }], imei: "imei", userAgent: "agent" }))}\n`);
    const result = await runZaloPersonalOperationTool({
      config: createConfig({ "internal.zalo_personal": "allow" }), paths, operation: "getContext", args: ["ignored"],
      clientFactory: async () => ZaloPersonalClient.fromApi(createApi({ getContext: (...args: unknown[]) => { calls.push(args); return { cookie: "secret" }; } })),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, [["ignored"]]);
    assert.deepEqual(result.result, { available: true, message: "Zalo Personal getContext result was retrieved but is intentionally redacted." });
  } finally { await rm(paths.rootDir, { recursive: true, force: true }); }
});

test("Zalo Personal tool always redacts cookie results", async () => {
  const paths = await createTempPaths();
  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.envPath, `BESTIE_ZALO_PERSONAL_SESSION=${JSON.stringify(encodeZaloPersonalSession({ cookie: [{ name: "session" }], imei: "imei", userAgent: "agent" }))}\n`);
    const result = await runZaloPersonalOperationTool({
      config: createConfig({ "internal.zalo_personal": "allow" }), paths, operation: "getCookie", args: [],
      clientFactory: async () => ZaloPersonalClient.fromApi(createApi({ getCookie: () => "raw-cookie-value" })),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.result, { available: true, message: "Zalo Personal getCookie result was retrieved but is intentionally redacted." });
  } finally { await rm(paths.rootDir, { recursive: true, force: true }); }
});

test("Zalo Personal tool requires approval for external and money operations", async () => {
  const paths = await createTempPaths();
  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(paths.envPath, `BESTIE_ZALO_PERSONAL_SESSION=${JSON.stringify(encodeZaloPersonalSession({ cookie: [{ name: "session" }], imei: "imei", userAgent: "agent" }))}\n`);
    const factory = async () => ZaloPersonalClient.fromApi(createApi({ sendBankCard: () => "", sendFriendRequest: () => "" }));
    const externalWrite = await runZaloPersonalOperationTool({ config: createConfig({ "internal.zalo_personal": "allow" }), paths, operation: "sendFriendRequest", args: ["hello", "user"], clientFactory: factory });
    assert.equal(externalWrite.ok, false);
    assert.match(externalWrite.message, /Approval required/);
    const noApprover = await runZaloPersonalOperationTool({ config: createConfig({ "internal.zalo_personal": "allow" }), paths, operation: "sendBankCard", args: [{}, "user"], clientFactory: factory });
    assert.equal(noApprover.ok, false);
    assert.match(noApprover.message, /Approval required/);
    const approved = await runZaloPersonalOperationTool({ config: createConfig(), paths, operation: "sendBankCard", args: [{}, "user"], clientFactory: factory, approver: async () => ({ approved: true }) });
    assert.equal(approved.ok, true);
  } finally { await rm(paths.rootDir, { recursive: true, force: true }); }
});

function createApi(methods: Record<string, (...args: unknown[]) => unknown>): ZaloPersonalApi {
  return {
    listener: { on: () => undefined, off: () => undefined, start: () => undefined, stop: () => undefined },
    getUserInfo: async () => ({ changed_profiles: {} }),
    sendMessage: async () => ({ message: null, attachment: [] }),
    sendTypingEvent: async () => undefined,
    ...methods,
  };
}

function createConfig(policies: Record<string, "allow" | "ask" | "deny"> = {}): AppConfig {
  return {
    version: 2, agent: { name: "Bea", ownerName: "Andy", language: "vi", toneIntensity: 7 },
    llm: { primary: "openai/test", authProfile: "openai", profiles: { openai: { provider: "openai-compatible", mode: "api-key", baseUrl: "http://127.0.0.1:9/v1", apiKeyEnv: "OPENAI_API_KEY" } }, modelCatalog: { "openai/test": { profile: "openai" } } },
    channels: { zaloPersonal: { enabled: true, sessionEnv: "BESTIE_ZALO_PERSONAL_SESSION", ownerUserId: "controller" } }, internalTools: { policies },
  };
}

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-zalo-personal-tools-test-"));
  const appDir = resolve(rootDir, ".bestie");
  return { rootDir, appDir, configPath: resolve(appDir, "config.json"), envPath: resolve(appDir, ".env"), characterPath: resolve(appDir, "character.json"), systemPromptPath: resolve(appDir, "system-prompt.md"), logsDir: resolve(appDir, "logs"), appLogPath: resolve(appDir, "logs/app.log"), dataDir: resolve(appDir, "data"), memoryDbPath: resolve(appDir, "data/memory.sqlite"), workspaceDir: resolve(appDir, "workspace") };
}
