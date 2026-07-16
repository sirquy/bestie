import { access } from "node:fs/promises";

import { DEFAULT_LLM_TIMEOUT_MS, configExists, loadConfig } from "../../runtime/config.js";
import { loadEnvFile } from "../../runtime/env.js";
import { InvalidConfigError, MissingConfigError } from "../../runtime/errors.js";
import { getRuntimePaths } from "../../runtime/paths.js";
import { checkForPackageUpdate, loadPackageVersionInfo } from "../../runtime/version.js";
import { badge, bold, keyValue, rule, title } from "../ui.js";

export async function runStatusCommand(): Promise<void> {
  const paths = getRuntimePaths();
  const hasConfig = await configExists(paths);

  console.log(title("Trạng thái Bestie"));
  console.log(rule());

  await printVersionStatus();
  console.log(keyValue("Cấu hình", `${hasConfig ? badge("FOUND", "green") : badge("MISS", "red")} ${paths.configPath}`));

  if (!hasConfig) {
    console.log(new MissingConfigError(paths.configPath).message);
    return;
  }

  try {
    const config = await loadConfig(paths);
    const envValues = await loadEnvFile(paths);
    const hasSecret = Boolean(process.env[config.llm.apiKeyEnv] ?? envValues[config.llm.apiKeyEnv]);

    console.log(keyValue("Nhà cung cấp", config.llm.provider));
    console.log(keyValue("Base URL", config.llm.baseUrl));
    console.log(keyValue("Model", bold(config.llm.model)));
    console.log(keyValue("API key env", `${config.llm.apiKeyEnv} ${hasSecret ? badge("PRESENT", "green") : badge("MISSING", "red")}`));
    console.log(keyValue("Timeout", `${config.llm.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS}ms`));
    const hasCharacter = await fileExists(paths.characterPath);
    const hasPrompt = await fileExists(paths.systemPromptPath);
    console.log(keyValue("Tính cách", hasCharacter ? badge("FOUND", "green") : badge("MISSING", "red")));
    console.log(keyValue("Prompt", hasPrompt ? badge("FOUND", "green") : badge("MISSING", "red")));
  } catch (error) {
    if (error instanceof InvalidConfigError) {
      console.log(keyValue("Đọc cấu hình", error.message));
      return;
    }

    throw error;
  }
}

async function printVersionStatus(): Promise<void> {
  try {
    const update = await checkForPackageUpdate();
    console.log(keyValue("Phiên bản", update.currentVersion));

    if (update.updateAvailable) {
      console.log(keyValue("Cập nhật", `${badge("NEW", "yellow")} có bản ${update.latestVersion} (chạy \`bestie update\`)`));
    } else {
      console.log(keyValue("Cập nhật", `${badge("OK", "green")} đang là bản mới nhất`));
    }
  } catch {
    const packageInfo = await loadPackageVersionInfo();
    console.log(keyValue("Phiên bản", packageInfo.version));
    console.log(keyValue("Cập nhật", `${badge("WARN", "yellow")} hiện chưa kiểm tra được npm`));
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