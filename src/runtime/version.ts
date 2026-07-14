import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { RuntimePaths } from "./paths.js";

export interface PackageVersionInfo {
  name: string;
  version: string;
}

export interface VersionCheckResult {
  packageName: string;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

export interface VersionCheckOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  registryUrl?: string;
}

export interface UpdateCheckCache {
  checkedAt: string;
  packageName: string;
  currentVersion: string;
  latestVersion: string;
}

const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org";
const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 2_500;

export async function loadPackageVersionInfo(): Promise<PackageVersionInfo> {
  const runtimeDir = dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = resolve(runtimeDir, "..", "..", "package.json");
  const rawPackageJson = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(rawPackageJson) as { name?: unknown; version?: unknown };

  if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string") {
    throw new Error("package.json is missing name or version.");
  }

  return { name: packageJson.name, version: packageJson.version };
}

export async function checkForPackageUpdate(options: VersionCheckOptions = {}): Promise<VersionCheckResult> {
  const packageInfo = await loadPackageVersionInfo();
  const latestVersion = await fetchLatestPackageVersion(packageInfo.name, options);

  return {
    packageName: packageInfo.name,
    currentVersion: packageInfo.version,
    latestVersion,
    updateAvailable: compareVersions(packageInfo.version, latestVersion) < 0,
  };
}

export async function writeUpdateCheckCache(paths: RuntimePaths, result: VersionCheckResult): Promise<void> {
  const cache: UpdateCheckCache = {
    checkedAt: new Date().toISOString(),
    packageName: result.packageName,
    currentVersion: result.currentVersion,
    latestVersion: result.latestVersion,
  };

  await writeFile(resolve(paths.dataDir, "update-check.json"), `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
}

export async function readUpdateCheckCache(paths: RuntimePaths): Promise<UpdateCheckCache | undefined> {
  try {
    const parsed = JSON.parse(await readFile(resolve(paths.dataDir, "update-check.json"), "utf8")) as unknown;
    if (!isUpdateCheckCache(parsed)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

async function fetchLatestPackageVersion(packageName: string, options: VersionCheckOptions): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const registryUrl = options.registryUrl ?? DEFAULT_REGISTRY_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_VERSION_CHECK_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${registryUrl.replace(/\/$/, "")}/${encodeURIComponent(packageName)}/latest`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`npm registry returned HTTP ${response.status}.`);
    }

    const body = (await response.json()) as { version?: unknown };
    if (typeof body.version !== "string") {
      throw new Error("npm registry response did not include a version.");
    }

    return body.version;
  } finally {
    clearTimeout(timeout);
  }
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersionCore(left);
  const rightParts = parseVersionCore(right);

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1;
    }
  }

  return 0;
}

function parseVersionCore(version: string): number[] {
  return version
    .split(/[+-]/, 1)[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function isUpdateCheckCache(value: unknown): value is UpdateCheckCache {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as UpdateCheckCache).checkedAt === "string" &&
      typeof (value as UpdateCheckCache).packageName === "string" &&
      typeof (value as UpdateCheckCache).currentVersion === "string" &&
      typeof (value as UpdateCheckCache).latestVersion === "string",
  );
}