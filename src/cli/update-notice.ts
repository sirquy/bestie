import { mkdir } from "node:fs/promises";

import type { RuntimePaths } from "../runtime/paths.js";
import { checkForPackageUpdate, compareVersions, readUpdateCheckCache, writeUpdateCheckCache, type VersionCheckOptions, type VersionCheckResult } from "../runtime/version.js";

export interface UpdateNoticeOptions {
  paths: RuntimePaths;
  writeLine?: (message: string) => void;
  ttlMs?: number;
  now?: Date;
  versionCheckOptions?: VersionCheckOptions;
  checkForUpdate?: () => Promise<VersionCheckResult>;
}

const DEFAULT_UPDATE_NOTICE_TTL_MS = 24 * 60 * 60 * 1000;

export async function maybePrintUpdateNotice(options: UpdateNoticeOptions): Promise<void> {
  const writeLine = options.writeLine ?? console.log;
  const ttlMs = options.ttlMs ?? DEFAULT_UPDATE_NOTICE_TTL_MS;
  const now = options.now ?? new Date();
  const cached = await readUpdateCheckCache(options.paths);

  if (cached && now.getTime() - Date.parse(cached.checkedAt) < ttlMs) {
    if (compareVersions(cached.currentVersion, cached.latestVersion) < 0) {
      printNotice(writeLine, cached.currentVersion, cached.latestVersion);
    }
    return;
  }

  let result: VersionCheckResult;
  try {
    result = options.checkForUpdate ? await options.checkForUpdate() : await checkForPackageUpdate(options.versionCheckOptions);
  } catch {
    return;
  }

  await mkdir(options.paths.dataDir, { recursive: true });
  await writeUpdateCheckCache(options.paths, result);

  if (result.updateAvailable) {
    printNotice(writeLine, result.currentVersion, result.latestVersion);
  }
}

function printNotice(writeLine: (message: string) => void, currentVersion: string, latestVersion: string): void {
  writeLine(`Bestie update available: ${currentVersion} -> ${latestVersion}`);
  writeLine("Run `bestie update --apply` to install the latest npm version.");
}