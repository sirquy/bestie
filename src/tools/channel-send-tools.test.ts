import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { sendFileTool, sendPhotoTool, type AgentOutboundFileSender, type ResolvedOutboundFilePayload } from "./channel-send-tools.js";

test("sendPhotoTool sends an allowed workspace image through the outbound sender", async () => {
  const paths = await createTempPaths();
  const sent: ResolvedOutboundFilePayload[] = [];
  const sender: AgentOutboundFileSender = {
    sendPhoto: async (payload) => {
      sent.push(payload);
      return { channel: payload.channel ?? "telegram:123", target: "123", messageId: 42 };
    },
    sendFile: async () => { throw new Error("should not send file"); },
  };

  try {
    await mkdir(paths.workspaceDir, { recursive: true });
    await writeFile(resolve(paths.workspaceDir, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const result = await sendPhotoTool({ config: createConfig({ "internal.send_photo": "allow" }), paths, outboundFileSender: sender, path: "image.png", caption: "Here", channel: "telegram:123" });

    assert.equal(result.allowed, true);
    assert.equal(result.channel, "telegram:123");
    assert.equal(result.messageId, 42);
    assert.equal(result.fileName, "image.png");
    assert.equal(result.mimeType, "image/png");
    assert.equal(sent[0]?.caption, "Here");
    assert.deepEqual([...sent[0]!.bytes], [0x89, 0x50, 0x4e, 0x47]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("sendFileTool sends documents without approval or policy gates", async () => {
  const paths = await createTempPaths();
  let calls = 0;
  const sender: AgentOutboundFileSender = {
    sendPhoto: async () => { throw new Error("should not send photo"); },
    sendFile: async (payload) => {
      calls += 1;
      return { channel: payload.channel ?? "zalo:abc", target: "abc" };
    },
  };

  try {
    await mkdir(paths.workspaceDir, { recursive: true });
    await writeFile(resolve(paths.workspaceDir, "report.txt"), "hello\n");

    const defaultPolicy = await sendFileTool({ config: createConfig(), paths, outboundFileSender: sender, path: "report.txt" });
    assert.equal(defaultPolicy.allowed, true);
    assert.equal(defaultPolicy.reason, "Outbound photo and file sends are allowed without approval.");
    assert.equal(calls, 1);

    const deniedPolicy = await sendFileTool({ config: createConfig({ "internal.send_file": "deny" }), paths, outboundFileSender: sender, path: "report.txt", fileName: "report final.txt", channel: "zalo:abc" });
    assert.equal(deniedPolicy.allowed, true);
    assert.equal(deniedPolicy.channel, "zalo:abc");
    assert.equal(deniedPolicy.fileName, "report-final.txt");
    assert.equal(deniedPolicy.mimeType, "text/plain");
    assert.equal(calls, 2);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("sendPhotoTool rejects non-image files and missing senders", async () => {
  const paths = await createTempPaths();
  try {
    await mkdir(paths.workspaceDir, { recursive: true });
    await writeFile(resolve(paths.workspaceDir, "report.txt"), "hello\n");

    const noSender = await sendPhotoTool({ config: createConfig({ "internal.send_photo": "allow" }), paths, path: "report.txt" });
    assert.equal(noSender.allowed, false);
    assert.match(noSender.reason, /requires a channel runtime/);

    const wrongMime = await sendPhotoTool({ config: createConfig({ "internal.send_photo": "allow" }), paths, outboundFileSender: fakeSender(), path: "report.txt" });
    assert.equal(wrongMime.allowed, false);
    assert.match(wrongMime.reason, /requires an image file/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

function fakeSender(): AgentOutboundFileSender {
  return {
    sendPhoto: async () => ({ channel: "telegram:1" }),
    sendFile: async () => ({ channel: "telegram:1" }),
  };
}

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
      },
    },
    internalTools: { policies },
  };
}

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-channel-send-tools-test-"));
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
