import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { ZaloPersonalClient } from "../../channels/zalo-personal/client.js";
import { decodeZaloPersonalSession } from "../../channels/zalo-personal/session.js";
import { writeConfig } from "../../runtime/config.js";
import { writeEnvFile } from "../../runtime/env.js";
import type { RuntimePaths } from "../../runtime/paths.js";
import { runZaloPersonalCommand } from "./zalo-personal.js";

test("Zalo Personal setup saves a redacted local session and controller configuration", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const credentials = { cookie: [{ name: "session", value: "secret-cookie" }], imei: "imei-1", userAgent: "test-agent" };
  let closed = false;
  let detached = false;
  const confirmationQuestions: string[] = [];

  try {
    await writeBaseConfig(paths);
    await writeEnvFile({ OPENAI_API_KEY: "sk-test" }, paths);

    await runZaloPersonalCommand({
      argv: ["node", "bestie", "channels", "zalo-personal", "setup"],
      paths,
      questioner: {
        ask: async () => { throw new Error("setup must detect the controller without asking for an ID"); },
        confirm: async (question) => {
          confirmationQuestions.push(question);
          return true;
        },
        close: () => { closed = true; },
      },
      loginWithQr: async ({ onEvent }) => {
        onEvent?.({ type: 0, data: { code: "zalo-login-qr" }, actions: null });
        const client = {
          getUserDisplayName: async () => "Nguyễn Văn A",
          startListening: ({ onMessage }: { onMessage: (message: { threadId: string; isSelf: boolean; type: number; data: { uidFrom?: string } }) => void }) => {
            queueMicrotask(() => {
              onMessage({ threadId: "self", isSelf: true, type: 0, data: { uidFrom: "automation-1" } });
              onMessage({ threadId: "group", isSelf: false, type: 1, data: { uidFrom: "group-member" } });
              onMessage({ threadId: "controller-1", isSelf: false, type: 0, data: { uidFrom: "controller-1" } });
            });
            return () => { detached = true; };
          },
        } as unknown as ZaloPersonalClient;
        return { client, credentials };
      },
      writeLine: (message) => output.push(message),
    });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as { channels?: { zaloPersonal?: { enabled: boolean; sessionEnv: string; ownerUserId: string } } };
    const envText = await readFile(paths.envPath, "utf8");
    const session = envText.match(/^BESTIE_ZALO_PERSONAL_SESSION="([^"]+)"$/m)?.[1];

    assert.equal(closed, true);
    assert.equal(detached, true);
    assert.deepEqual(config.channels?.zaloPersonal, { enabled: true, sessionEnv: "BESTIE_ZALO_PERSONAL_SESSION", ownerUserId: "controller-1" });
    assert.ok(session);
    assert.deepEqual(decodeZaloPersonalSession(session).credentials, credentials);
    assert.ok(output.some((line) => line.includes("Quét QR này")));
    assert.ok(output.some((line) => line.includes("▄▄▄▄▄") || line.includes("█████")));
    assert.ok(confirmationQuestions.some((question) => question.includes("Nguyễn Văn A") && question.includes("controller-1")));
    assert.doesNotMatch(output.join("\n"), /secret-cookie|imei-1|test-agent/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("Zalo Personal logout removes its session and disables the channel", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];

  try {
    await writeBaseConfig(paths, { enabled: true, sessionEnv: "BESTIE_ZALO_PERSONAL_SESSION", ownerUserId: "controller-1" });
    await writeEnvFile({ OPENAI_API_KEY: "sk-test", BESTIE_ZALO_PERSONAL_SESSION: "private-session" }, paths);

    await runZaloPersonalCommand({ argv: ["node", "bestie", "channels", "zalo-personal", "logout"], paths, writeLine: (message) => output.push(message) });

    const config = JSON.parse(await readFile(paths.configPath, "utf8")) as { channels?: { zaloPersonal?: { enabled: boolean } } };
    const envText = await readFile(paths.envPath, "utf8");
    assert.equal(config.channels?.zaloPersonal?.enabled, false);
    assert.doesNotMatch(envText, /BESTIE_ZALO_PERSONAL_SESSION|private-session/);
    assert.doesNotMatch(output.join("\n"), /private-session/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function writeBaseConfig(paths: RuntimePaths, zaloPersonal?: { enabled: boolean; sessionEnv: string; ownerUserId: string }): Promise<void> {
  await mkdir(paths.appDir, { recursive: true });
  await writeConfig({
    version: 2,
    agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
    llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: { "openai:api-key": { provider: "openai-compatible", mode: "api-key", baseUrl: "https://example.com/v1", apiKeyEnv: "OPENAI_API_KEY" } },
      modelCatalog: { "openai/test-model": { profile: "openai:api-key" } },
    },
    ...(zaloPersonal ? { channels: { zaloPersonal } } : {}),
  }, paths);
  await writeFile(paths.systemPromptPath, "You are Miu.\n");
}

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-zalo-personal-command-test-"));
  const appDir = resolve(rootDir, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");
  return { rootDir, appDir, configPath: resolve(appDir, "config.json"), envPath: resolve(appDir, ".env"), characterPath: resolve(appDir, "character.json"), systemPromptPath: resolve(appDir, "system-prompt.md"), logsDir, appLogPath: resolve(logsDir, "app.log"), dataDir, memoryDbPath: resolve(dataDir, "memory.sqlite"), workspaceDir: resolve(appDir, "workspace") };
}
