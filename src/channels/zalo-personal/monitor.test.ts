import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { AppConfig } from "../../runtime/config.js";
import type { RuntimePaths } from "../../runtime/paths.js";
import { runZaloPersonalMonitor } from "./monitor.js";

test("Zalo Personal monitor reconnects after close and detaches each listener", async () => {
  const paths = createPaths(await mkdtemp(resolve(tmpdir(), "bestie-zalo-personal-monitor-test-")));
  let stopped = false;
  let clients = 0;
  let detached = 0;
  const delays: number[] = [];

  try {
    await runZaloPersonalMonitor({
      config: config(),
      paths,
      shouldStop: () => stopped,
      sleep: async (milliseconds) => { delays.push(milliseconds); },
      createClient: async () => {
        clients += 1;
        return {
          startListening: ({ onClosed }: { onClosed: () => void }) => {
            queueMicrotask(() => {
              if (clients === 2) stopped = true;
              onClosed();
            });
            return () => { detached += 1; };
          },
        } as never;
      },
    });

    assert.equal(clients, 2);
    assert.equal(detached, 2);
    assert.deepEqual(delays.filter((milliseconds) => milliseconds >= 1_000), [1_000]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("Zalo Personal monitor applies the initial backoff once after client creation fails", async () => {
  const paths = createPaths(await mkdtemp(resolve(tmpdir(), "bestie-zalo-personal-monitor-failure-test-")));
  const delays: number[] = [];
  let attempts = 0;
  let stopped = false;

  try {
    await runZaloPersonalMonitor({
      config: config(),
      paths,
      shouldStop: () => stopped,
      sleep: async (milliseconds) => { delays.push(milliseconds); },
      createClient: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("listener unavailable");
        return {
          startListening: ({ onClosed }: { onClosed: () => void }) => {
            queueMicrotask(() => {
              stopped = true;
              onClosed();
            });
            return () => undefined;
          },
        } as never;
      },
    });

    assert.equal(attempts, 2);
    assert.deepEqual(delays.filter((milliseconds) => milliseconds >= 1_000), [1_000]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

function config(): AppConfig {
  return {
    version: 2,
    agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
    llm: { primary: "openai/test-model", authProfile: "openai:api-key", profiles: { "openai:api-key": { provider: "openai-compatible", mode: "api-key", baseUrl: "https://example.com/v1", apiKeyEnv: "OPENAI_API_KEY" } }, modelCatalog: { "openai/test-model": { profile: "openai:api-key" } } },
    channels: { zaloPersonal: { enabled: true, sessionEnv: "BESTIE_ZALO_PERSONAL_SESSION", ownerUserId: "controller-1" } },
  };
}

function createPaths(rootDir: string): RuntimePaths {
  const appDir = resolve(rootDir, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");
  return { rootDir, appDir, configPath: resolve(appDir, "config.json"), envPath: resolve(appDir, ".env"), characterPath: resolve(appDir, "character.json"), systemPromptPath: resolve(appDir, "system-prompt.md"), logsDir, appLogPath: resolve(logsDir, "app.log"), dataDir, memoryDbPath: resolve(dataDir, "memory.sqlite"), workspaceDir: resolve(appDir, "workspace") };
}
