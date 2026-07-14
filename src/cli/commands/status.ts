import { access } from "node:fs/promises";

import { DEFAULT_LLM_TIMEOUT_MS, configExists, loadConfig } from "../../runtime/config.js";
import { loadEnvFile } from "../../runtime/env.js";
import { InvalidConfigError, MissingConfigError } from "../../runtime/errors.js";
import { getRuntimePaths } from "../../runtime/paths.js";
import { checkForPackageUpdate, loadPackageVersionInfo } from "../../runtime/version.js";

export async function runStatusCommand(): Promise<void> {
  const paths = getRuntimePaths();
  const hasConfig = await configExists(paths);

  console.log("Bestie Status");
  await printVersionStatus();
  console.log(`Config: ${hasConfig ? "found" : "missing"} (${paths.configPath})`);

  if (!hasConfig) {
    console.log(new MissingConfigError(paths.configPath).message);
    return;
  }

  try {
    const config = await loadConfig(paths);
    const envValues = await loadEnvFile(paths);
    const hasSecret = Boolean(process.env[config.llm.apiKeyEnv] ?? envValues[config.llm.apiKeyEnv]);

    console.log(`Provider: ${config.llm.provider}`);
    console.log(`Base URL: ${config.llm.baseUrl}`);
    console.log(`Model: ${config.llm.model}`);
    console.log(`API key env: ${config.llm.apiKeyEnv} (${hasSecret ? "present" : "missing"})`);
    console.log(`Request timeout: ${config.llm.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS}ms`);
    console.log(`Character file: ${(await fileExists(paths.characterPath)) ? "found" : "missing"}`);
    console.log(`System prompt: ${(await fileExists(paths.systemPromptPath)) ? "found" : "missing"}`);
  } catch (error) {
    if (error instanceof InvalidConfigError) {
      console.log(error.message);
      return;
    }

    throw error;
  }
}

async function printVersionStatus(): Promise<void> {
  try {
    const update = await checkForPackageUpdate();
    console.log(`Version: ${update.currentVersion}`);

    if (update.updateAvailable) {
      console.log(`Update: ${update.latestVersion} available (run \`bestie update\`)`);
    } else {
      console.log("Update: up to date");
    }
  } catch {
    const packageInfo = await loadPackageVersionInfo();
    console.log(`Version: ${packageInfo.version}`);
    console.log("Update: unable to check npm right now");
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}