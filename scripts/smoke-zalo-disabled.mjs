import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { runZaloCommand } from "../dist/cli/commands/zalo.js";
import { writeConfig } from "../dist/runtime/config.js";
import { writeEnvFile } from "../dist/runtime/env.js";
import { createRuntimePaths } from "./runtime-paths.mjs";

const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-zalo-disabled-smoke-"));
const paths = createRuntimePaths(rootDir);

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

  await assertRejectsWithMessage(
    () => runZaloCommand({ argv: ["node", "bestie", "channels", "zalo"], paths, writeLine: () => undefined }),
    "Zalo chưa được bật",
  );
  console.log("Zalo disabled smoke passed.");
} finally {
  await rm(rootDir, { recursive: true, force: true });
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
