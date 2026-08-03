import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

import { checkForPackageUpdate, loadPackageVersionInfo, writeUpdateCheckCache, type VersionCheckOptions, type VersionCheckResult } from "../../runtime/version.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { formatUpdateInstallFailure } from "../../runtime/update-message.js";
import { badge, keyValue, startSpinner, title } from "../ui.js";

export interface UpdateCommandOptions {
  argv?: string[];
  paths?: RuntimePaths;
  writeLine?: (message: string) => void;
  writeError?: (message: string) => void;
  versionCheckOptions?: VersionCheckOptions;
  runInstaller?: (packageName: string) => Promise<number>;
}

export async function runUpdateCommand(options: UpdateCommandOptions | string[] = {}): Promise<void> {
  const argv = Array.isArray(options) ? options : options.argv ?? process.argv;
  const paths = Array.isArray(options) ? getRuntimePaths() : options.paths ?? getRuntimePaths();
  const writeLine = Array.isArray(options) ? console.log : options.writeLine ?? console.log;
  const writeError = Array.isArray(options) ? console.error : options.writeError ?? console.error;
  const args = argv.slice(3);

  if (args.includes("--help") || args.includes("-h")) {
    printUpdateHelp(writeLine);
    return;
  }

  const apply = args.includes("--apply");
  if (args.some((arg) => arg !== "--apply")) {
    writeError(`Tùy chọn update không xác định: ${args.find((arg) => arg !== "--apply")}`);
    printUpdateHelp(writeLine);
    process.exitCode = 1;
    return;
  }

  let result: VersionCheckResult;
  const spinner = startSpinner("Đang kiểm tra bản cập nhật Bestie trên npm");
  try {
    result = await checkForPackageUpdate(Array.isArray(options) ? {} : options.versionCheckOptions);
    await mkdir(paths.dataDir, { recursive: true });
    await writeUpdateCheckCache(paths, result);
  } catch (error) {
    spinner.stop();
    const packageInfo = await loadPackageVersionInfo();
    const message = error instanceof Error ? error.message : "lỗi không xác định";
    writeLine(title("Cập nhật Bestie"));
    writeLine(keyValue("Phiên bản", packageInfo.version));
    writeLine(keyValue("Cập nhật", `${badge("WARN", "yellow")} chưa kiểm tra được npm: ${message}`));
    writeLine(keyValue("Thủ công", `npm install -g ${packageInfo.name}@latest`));
    process.exitCode = 1;
    return;
  }
  spinner.stop();

  writeLine(title("Cập nhật Bestie"));
  writeLine(keyValue("Hiện tại", result.currentVersion));
  writeLine(keyValue("Mới nhất", result.latestVersion));

  if (!result.updateAvailable) {
    writeLine(keyValue("Trạng thái", `${badge("OK", "green")} đang là bản mới nhất`));
    return;
  }

  writeLine(keyValue("Trạng thái", `${badge("NEW", "yellow")} ${result.currentVersion} -> ${result.latestVersion}`));

  if (!apply) {
    writeLine(`Chạy: npm install -g ${result.packageName}@latest`);
    writeLine("Hoặc chạy: bestie update --apply");
    return;
  }

  const installer = Array.isArray(options) ? runNpmGlobalInstall : options.runInstaller ?? runNpmGlobalInstall;
  const exitCode = await installer(result.packageName);
  if (exitCode === 0) {
    writeLine("Lệnh cập nhật Bestie đã chạy xong. Mở terminal mới nếu shell vẫn cache binary cũ.");
    return;
  }

  writeError(formatUpdateInstallFailure(result.packageName, exitCode));
  process.exitCode = exitCode;
}

function printUpdateHelp(writeLine: (message: string) => void): void {
  writeLine(`Bestie update

Usage:
  bestie update
  bestie update --apply

Kiểm tra phiên bản bestie-agent mới nhất trên npm. Dùng --apply để chạy npm install -g bestie-agent@latest.`);
}

function runNpmGlobalInstall(packageName: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["install", "-g", `${packageName}@latest`], { stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}
