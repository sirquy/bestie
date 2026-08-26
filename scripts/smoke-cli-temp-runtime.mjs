import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { writeConfig } from "../dist/runtime/config.js";
import { writeEnvFile } from "../dist/runtime/env.js";

const command = process.argv[2];
if (!command) {
  throw new Error("Usage: node scripts/smoke-cli-temp-runtime.mjs <status|doctor|doctor-json|chat>");
}

const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-cli-smoke-"));
const projectRoot = process.env.INIT_CWD ?? process.cwd();
const cliPath = resolve(projectRoot, "dist/cli/index.js");
const paths = createRuntimePaths(rootDir);

try {
  await seedRuntime(paths);

  const result = runCli(command, cliPath, rootDir);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Smoke command ${command} failed with exit ${result.status}`);
  }

  if (command === "doctor-json") {
    const { validateDoctorReportJsonContract } = await import(pathToFileURL(resolve(projectRoot, "dist/runtime/doctor-report-contract.js")).href);
    const contract = validateDoctorReportJsonContract(result.stdout);
    if (!contract.valid) {
      throw new Error(contract.errors.join("\n"));
    }
  }

  process.stdout.write(result.stdout);
} finally {
  await rm(rootDir, { recursive: true, force: true });
}

function runCli(command, cliPath, rootDir) {
  const env = { ...process.env, HOME: rootDir, USERPROFILE: rootDir, HOMEDRIVE: "", HOMEPATH: rootDir };
  if (command === "status") {
    return spawnSync(process.execPath, [cliPath, "status"], { cwd: rootDir, env, encoding: "utf8" });
  }
  if (command === "doctor") {
    return spawnSync(process.execPath, [cliPath, "doctor"], { cwd: rootDir, env, encoding: "utf8" });
  }
  if (command === "doctor-json") {
    return spawnSync(process.execPath, [cliPath, "doctor", "--json"], { cwd: rootDir, env, encoding: "utf8" });
  }
  if (command === "chat") {
    return spawnSync(process.execPath, [cliPath, "chat"], { cwd: rootDir, env, input: "/exit\n", encoding: "utf8" });
  }

  throw new Error(`Unknown smoke command: ${command}`);
}

async function seedRuntime(paths) {
  await mkdir(paths.appDir, { recursive: true });
  await writeConfig(
    {
      version: 2,
      agent: { name: "Bestie", ownerName: "Boss", language: "vi", toneIntensity: 7 },
      llm: {
        primary: "openai/test-model",
        authProfile: "openai:api-key",
        profiles: {
          "openai:api-key": { provider: "openai-compatible", mode: "api-key", baseUrl: "http://127.0.0.1:9/v1", apiKeyEnv: "OPENAI_API_KEY" },
        },
        modelCatalog: {
          "openai/test-model": { profile: "openai:api-key" },
        },
      },
      memory: { writePolicy: "ask" },
    },
    paths,
  );
  await writeEnvFile({ OPENAI_API_KEY: "test-key" }, paths);
  await writeFile(
    paths.characterPath,
    `${JSON.stringify({
      name: "Bestie",
      role: "AI best friend companion",
      language: "vi",
      personality: ["warm", "direct"],
      tone: { roastLevel: 2, warmthLevel: 8, bluntnessLevel: 4, chaosLevel: 2 },
      boundaries: { neverJokeAbout: ["harm"], dropJokesWhen: ["crisis"] },
      ownerName: "Boss",
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await writeFile(paths.systemPromptPath, "You are Bestie. Keep replies concise.\n", { mode: 0o600 });
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
