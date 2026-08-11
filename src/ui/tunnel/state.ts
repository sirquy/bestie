import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { RuntimePaths } from "../../runtime/paths.js";
import { isTunnelPublicRecord, type LocalTunnelState } from "./types.js";

export function getTunnelStatePath(paths: RuntimePaths): string {
  return resolve(paths.dataDir, "ui-tunnel.json");
}

export function createTunnelDeviceId(): string {
  return `bestie-${randomBytes(16).toString("hex")}`;
}

export async function getOrCreateTunnelInstallationId(paths: RuntimePaths): Promise<string> {
  const installationPath = resolve(paths.dataDir, "ui-tunnel-installation.json");
  try {
    const parsed = JSON.parse(await readFile(installationPath, "utf8")) as unknown;
    if (isRecord(parsed) && typeof parsed.id === "string" && /^bestie-[a-f0-9]{32}$/.test(parsed.id)) {
      return parsed.id;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  return writeTunnelInstallationId(paths, installationPath);
}

export async function rotateTunnelInstallationId(paths: RuntimePaths): Promise<string> {
  return writeTunnelInstallationId(paths, resolve(paths.dataDir, "ui-tunnel-installation.json"));
}

export async function loadTunnelState(paths: RuntimePaths): Promise<LocalTunnelState | undefined> {
  try {
    const parsed = JSON.parse(await readFile(getTunnelStatePath(paths), "utf8")) as unknown;
    return isLocalTunnelState(parsed) ? parsed : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeTunnelState(state: LocalTunnelState, paths: RuntimePaths): Promise<void> {
  await mkdir(paths.dataDir, { recursive: true, mode: 0o700 });
  const statePath = getTunnelStatePath(paths);
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, statePath);
}

export async function removeTunnelState(paths: RuntimePaths): Promise<void> {
  await rm(getTunnelStatePath(paths), { force: true });
}

function isLocalTunnelState(value: unknown): value is LocalTunnelState {
  if (!isRecord(value) || value.version !== 1 || typeof value.controlPlaneUrl !== "string" || typeof value.deviceId !== "string" || !isRecord(value.tunnel)) return false;
  const tunnel = value.tunnel;
  const connector = value.connector;
  return typeof value.instanceId === "string" && isTunnelPublicRecord(tunnel) && (connector === undefined || (isRecord(connector) && typeof connector.pid === "number" && typeof connector.executable === "string" && typeof connector.logPath === "string" && typeof connector.startedAt === "string"));
}

async function writeTunnelInstallationId(paths: RuntimePaths, installationPath: string): Promise<string> {
  const id = createTunnelDeviceId();
  await mkdir(paths.dataDir, { recursive: true, mode: 0o700 });
  await writeFile(installationPath, `${JSON.stringify({ version: 1, id }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}