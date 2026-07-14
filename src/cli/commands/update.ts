import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

import { checkForPackageUpdate, loadPackageVersionInfo, writeUpdateCheckCache, type VersionCheckOptions, type VersionCheckResult } from "../../runtime/version.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

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
    writeError(`Unknown update option: ${args.find((arg) => arg !== "--apply")}`);
    printUpdateHelp(writeLine);
    process.exitCode = 1;
    return;
  }

  let result: VersionCheckResult;
  try {
    result = await checkForPackageUpdate(Array.isArray(options) ? {} : options.versionCheckOptions);
    await mkdir(paths.dataDir, { recursive: true });
    await writeUpdateCheckCache(paths, result);
  } catch (error) {
    const packageInfo = await loadPackageVersionInfo();
    const message = error instanceof Error ? error.message : "unknown error";
    writeLine(`Bestie ${packageInfo.version}`);
    writeLine(`Could not check npm for updates: ${message}`);
    writeLine(`Manual update command: npm install -g ${packageInfo.name}@latest`);
    process.exitCode = 1;
    return;
  }

  writeLine(`Bestie ${result.currentVersion}`);
  writeLine(`Latest npm version: ${result.latestVersion}`);

  if (!result.updateAvailable) {
    writeLine("Bestie is already up to date.");
    return;
  }

  writeLine(`Update available: ${result.currentVersion} -> ${result.latestVersion}`);

  if (!apply) {
    writeLine(`Run: npm install -g ${result.packageName}@latest`);
    writeLine("Or run: bestie update --apply");
    return;
  }

  const installer = Array.isArray(options) ? runNpmGlobalInstall : options.runInstaller ?? runNpmGlobalInstall;
  const exitCode = await installer(result.packageName);
  if (exitCode === 0) {
    writeLine("Bestie update command finished. Open a new terminal if your shell keeps an old binary cached.");
    return;
  }

  writeError(`npm install exited with code ${exitCode}.`);
  process.exitCode = exitCode;
}

function printUpdateHelp(writeLine: (message: string) => void): void {
  writeLine(`Bestie update

Usage:
  bestie update
  bestie update --apply

Checks npm for the newest bestie-agent version. Use --apply to run npm install -g bestie-agent@latest.`);
}

function runNpmGlobalInstall(packageName: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["install", "-g", `${packageName}@latest`], { stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}