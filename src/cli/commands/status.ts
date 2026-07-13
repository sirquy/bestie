import { access } from "node:fs/promises";

import { DEFAULT_LLM_TIMEOUT_MS, configExists, loadConfig } from "../../runtime/config.js";
import { loadEnvFile } from "../../runtime/env.js";
import { InvalidConfigError, MissingConfigError } from "../../runtime/errors.js";
import { getRuntimePaths } from "../../runtime/paths.js";

export async function runStatusCommand(): Promise<void> {
  const paths = getRuntimePaths();
  const hasConfig = await configExists(paths);

  console.log("Bestie Status");
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}