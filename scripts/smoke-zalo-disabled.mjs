import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { runZaloCommand } from "../dist/cli/commands/zalo.js";
import { writeConfig } from "../dist/runtime/config.js";
import { writeEnvFile } from "../dist/runtime/env.js";

const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-zalo-disabled-smoke-"));
const paths = createRuntimePaths(rootDir);

try {
  await mkdir(paths.appDir, { recursive: true });
  await writeConfig(
    {
      version: 1,
      agent: { name: "Bestie", ownerName: "Boss", language: "vi", toneIntensity: 7 },
      llm: { provider: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", model: "test-model", apiKeyEnv: "OPENAI_API_KEY" },
    },
    paths,
  );
  await writeEnvFile({ OPENAI_API_KEY: "test-key" }, paths);

  await assertRejectsWithMessage(
    () => runZaloCommand({ argv: ["node", "bestie", "zalo"], paths, writeLine: () => undefined }),
    "Zalo is not enabled",
  );
  console.log("Zalo disabled smoke passed.");
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

async function assertRejectsWithMessage(run, expected) {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expected)) {
      throw new Error(`Expected error message to include ${expected}, got ${message}`);
    }
    return;
  }

  throw new Error(`Expected command to fail with ${expected}`);
}