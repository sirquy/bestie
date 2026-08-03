import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

import { checkForPackageUpdate, loadPackageVersionInfo, writeUpdateCheckCache, type VersionCheckOptions, type VersionCheckResult } from "../../runtime/version.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

export interface UiUpdateSummary extends VersionCheckResult {
  ok: true;
  installCommand: string;
}

export interface UiUpdateErrorSummary {
  ok: false;
  packageName: string;
  currentVersion: string;
  installCommand: string;
  error: string;
}

export type UiUpdateCheckSummary = UiUpdateSummary | UiUpdateErrorSummary;

export interface UiUpdateApplyResult {
  ok: boolean;
  packageName: string;
  latestVersion: string;
  exitCode: number;
  message: string;
  output: string;
}

export async function getUiUpdateSummary(paths: RuntimePaths = getRuntimePaths(), options: VersionCheckOptions = {}): Promise<UiUpdateCheckSummary> {
  try {
    const result = await checkForPackageUpdate(options);
    await mkdir(paths.dataDir, { recursive: true });
    await writeUpdateCheckCache(paths, result);
    return { ok: true, ...result, installCommand: buildInstallCommand(result.packageName) };
  } catch (error) {
    const packageInfo = await loadPackageVersionInfo();
    return {
      ok: false,
      packageName: packageInfo.name,
      currentVersion: packageInfo.version,
      installCommand: buildInstallCommand(packageInfo.name),
      error: error instanceof Error ? error.message : "Không thể kiểm tra bản cập nhật.",
    };
  }
}

export async function applyUiUpdate(paths: RuntimePaths = getRuntimePaths(), options: VersionCheckOptions = {}): Promise<UiUpdateApplyResult> {
  const summary = await getUiUpdateSummary(paths, options);
  const latestVersion = summary.ok ? summary.latestVersion : summary.currentVersion;
  const packageName = summary.packageName;

  if (!summary.ok) {
    return { ok: false, packageName, latestVersion, exitCode: 1, message: summary.error, output: "" };
  }

  if (!summary.updateAvailable) {
    return { ok: true, packageName, latestVersion, exitCode: 0, message: "Bestie Agent đang là bản mới nhất.", output: "" };
  }

  const result = await runNpmGlobalInstall(packageName);
  return {
    ok: result.exitCode === 0,
    packageName,
    latestVersion,
    exitCode: result.exitCode,
    message: result.exitCode === 0 ? "Đã chạy cập nhật Bestie Agent. Mở terminal mới nếu shell vẫn cache binary cũ." : `npm install thoát với mã ${result.exitCode}.`,
    output: result.output.slice(-6_000),
  };
}

function buildInstallCommand(packageName: string): string {
  return `npm install -g ${packageName}@latest`;
}

function runNpmGlobalInstall(packageName: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(command, ["install", "-g", `${packageName}@latest`], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const append = (chunk: Buffer): void => {
      output = `${output}${chunk.toString("utf8")}`.slice(-12_000);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (error) => resolve({ exitCode: 1, output: error.message }));
    child.on("close", (code) => resolve({ exitCode: code ?? 1, output }));
  });
}
