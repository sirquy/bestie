import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { writeConfig } from "../dist/runtime/config.js";
import { writeEnvFile } from "../dist/runtime/env.js";
import { runZaloCommand } from "../dist/cli/commands/zalo.js";

const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-zalo-setup-smoke-"));
const paths = createRuntimePaths(rootDir);
const output = [];

try {
  await mkdir(paths.appDir, { recursive: true });
  await writeConfig(
    {
      version: 2,
      agent: { name: "Bestie", ownerName: "Boss", language: "vi", toneIntensity: 7 },
      llm: {
        primary: "openai/test-model",
        authProfile: "openai:api-key",
        profiles: {
          "openai:api-key": {
            provider: "openai-compatible",
            mode: "api-key",
            baseUrl: "http://127.0.0.1:9/v1",
            apiKeyEnv: "OPENAI_API_KEY",
          },
        },
        modelCatalog: {
          "openai/test-model": { profile: "openai:api-key" },
        },
      },
    },
    paths,
  );
  await writeEnvFile({ OPENAI_API_KEY: "test-key" }, paths);

  await runZaloCommand({
    argv: ["node", "bestie", "channels", "zalo", "setup"],
    paths,
    questioner: {
      ask: async () => "zalo-owner-1",
      askHidden: async () => "test-zalo-token",
      close: () => undefined,
    },
    writeLine: (message) => output.push(message),
    useColor: false,
  });

  const configText = await readFile(paths.configPath, "utf8");
  const envText = await readFile(paths.envPath, "utf8");

  assertIncludes(configText, '"zalo"');
  assertIncludes(configText, '"ownerUserId": "zalo-owner-1"');
  assertIncludes(envText, 'BESTIE_ZALO_BOT_TOKEN="test-zalo-token"');
  const outputText = output.join("\n");
  assertIncludes(outputText, "Tài khoản");
  assertIncludes(outputText, "Bot token");
  assertIncludes(outputText, "Nội dung nhập sẽ được ẩn");
  assertIncludes(outputText, "Đã lưu cấu hình Zalo");
  assertNotIncludes(outputText, "test-zalo-token");
  console.log("Zalo setup smoke passed.");
} finally {
  await rm(rootDir, { recursive: true, force: true });
}

function createRuntimePaths(root) {
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

function assertIncludes(value, expected) {
  if (!value.includes(expected)) {
    throw new Error(`Expected output to include ${expected}`);
  }
}

function assertNotIncludes(value, unexpected) {
  if (value.includes(unexpected)) {
    throw new Error(`Expected output not to include ${unexpected}`);
  }
}