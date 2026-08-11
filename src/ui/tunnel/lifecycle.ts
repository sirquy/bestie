import { loadEnvFile, writeEnvFile } from "../../runtime/env.js";
import { type RuntimePaths } from "../../runtime/paths.js";
import { TunnelControlPlaneClient } from "./control-plane-client.js";
import { isCloudflaredRunning, startCloudflared, stopCloudflared } from "./cloudflared.js";
import { getOrCreateTunnelInstallationId, loadTunnelState, removeTunnelState, rotateTunnelInstallationId, writeTunnelState } from "./state.js";
import type { LocalTunnelState } from "./types.js";

const INSTANCE_TOKEN_ENV = "BESTIE_TUNNEL_INSTANCE_TOKEN";
const CONTROL_PLANE_URL_ENV = "BESTIE_TUNNEL_CONTROL_PLANE_URL";
const DEFAULT_CONTROL_PLANE_URL = "https://tunnel.bestieagent.com";

export interface TunnelLifecycleOptions {
  paths: RuntimePaths;
  clientVersion: string;
  fetcher?: typeof fetch;
}

export async function setupTunnel(options: TunnelLifecycleOptions): Promise<LocalTunnelState> {
  const existing = await loadTunnelState(options.paths);
  if (existing) return existing;
  const env = await loadEnvFile(options.paths);
  const controlPlaneUrl = env[CONTROL_PLANE_URL_ENV] ?? process.env[CONTROL_PLANE_URL_ENV] ?? DEFAULT_CONTROL_PLANE_URL;
  let deviceId = await getOrCreateTunnelInstallationId(options.paths);
  let registration: { instanceId: string; instanceToken: string };
  try {
    registration = await registerTunnelInstance(controlPlaneUrl, deviceId, options.clientVersion, options.fetcher);
  } catch (error) {
    if (!isRegisteredPublicIdConflict(error)) throw error;
    deviceId = await rotateTunnelInstallationId(options.paths);
    registration = await registerTunnelInstance(controlPlaneUrl, deviceId, options.clientVersion, options.fetcher);
  }
  const client = new TunnelControlPlaneClient({ baseUrl: controlPlaneUrl, instanceToken: registration.instanceToken, instanceId: registration.instanceId, fetcher: options.fetcher });
  const tunnel = await client.createTunnel();
  const state: LocalTunnelState = { version: 1, controlPlaneUrl, deviceId, instanceId: registration.instanceId, tunnel };
  try {
    await writeInstanceToken(registration.instanceToken, env, options.paths);
    await writeTunnelState(state, options.paths);
    return state;
  } catch (error) {
    await rollbackTunnelSetup(client, tunnel.id, env, options.paths);
    throw error;
  }
}

export async function getTunnelStatus(options: TunnelLifecycleOptions): Promise<LocalTunnelState | undefined> {
  const state = await loadTunnelState(options.paths);
  if (!state) return undefined;
  const tunnel = await createClient(state, await loadEnvFile(options.paths), options.fetcher).getTunnel(state.tunnel.id);
  const nextState = { ...state, tunnel };
  await writeTunnelState(nextState, options.paths);
  return nextState;
}

export async function revokeTunnel(options: TunnelLifecycleOptions): Promise<string> {
  const state = await requireTunnelState(options.paths);
  if (state.connector) stopCloudflared(state.connector.pid);
  const env = await loadEnvFile(options.paths);
  const result = await createClient(state, env, options.fetcher).disableTunnel(state.tunnel.id);
  delete env[INSTANCE_TOKEN_ENV];
  await writeEnvFile(env, options.paths);
  await removeTunnelState(options.paths);
  return result.hostname;
}

export async function startTunnelConnector(options: TunnelLifecycleOptions): Promise<LocalTunnelState> {
  const state = await requireTunnelState(options.paths);
  if (state.connector && isCloudflaredRunning(state.connector.pid)) return state;
  await requireLocalUi();
  const env = await loadEnvFile(options.paths);
  const client = createClient(state, env, options.fetcher);
  const credential = await client.getLaunchCredential(state.tunnel.id);
  try {
    const connector = await startCloudflared({ paths: options.paths, runToken: credential.cloudflaredRunToken });
    const tunnel = await client.heartbeat(state.tunnel.id, "connected", options.clientVersion);
    const nextState: LocalTunnelState = { ...state, tunnel, connector: { ...connector, startedAt: new Date().toISOString() } };
    await writeTunnelState(nextState, options.paths);
    return nextState;
  } finally {
    credential.cloudflaredRunToken = "";
  }
}

export async function stopTunnelConnector(options: TunnelLifecycleOptions): Promise<LocalTunnelState> {
  const state = await requireTunnelState(options.paths);
  if (state.connector) stopCloudflared(state.connector.pid);
  const env = await loadEnvFile(options.paths);
  const tunnel = await createClient(state, env, options.fetcher).heartbeat(state.tunnel.id, "disconnected", options.clientVersion).catch(() => state.tunnel);
  const { connector: _connector, ...withoutConnector } = state;
  const nextState: LocalTunnelState = { ...withoutConnector, tunnel };
  await writeTunnelState(nextState, options.paths);
  return nextState;
}

function createClient(state: LocalTunnelState, env: Record<string, string>, fetcher?: typeof fetch): TunnelControlPlaneClient {
  const instanceToken = env[INSTANCE_TOKEN_ENV] ?? process.env[INSTANCE_TOKEN_ENV];
  if (!instanceToken) throw new Error(`Missing ${INSTANCE_TOKEN_ENV}. Run 'bestie ui tunnel setup' again.`);
  return new TunnelControlPlaneClient({ baseUrl: state.controlPlaneUrl, instanceToken, instanceId: state.instanceId, fetcher });
}

async function requireTunnelState(paths: RuntimePaths): Promise<LocalTunnelState> {
  const state = await loadTunnelState(paths);
  if (!state) throw new Error("No tunnel is configured. Run 'bestie ui tunnel setup' first.");
  return state;
}

async function writeInstanceToken(instanceToken: string, env: Record<string, string>, paths: RuntimePaths): Promise<void> {
  await writeEnvFile({ ...env, [INSTANCE_TOKEN_ENV]: instanceToken }, paths);
}

async function rollbackTunnelSetup(client: TunnelControlPlaneClient, tunnelId: string, env: Record<string, string>, paths: RuntimePaths): Promise<void> {
  try {
    await client.disableTunnel(tunnelId);
  } catch {
    // Preserve the local write failure while making the best effort to remove remote state.
  }

  delete env[INSTANCE_TOKEN_ENV];
  await writeEnvFile(env, paths).catch(() => undefined);
  await removeTunnelState(paths).catch(() => undefined);
}

async function requireLocalUi(): Promise<void> {
  try {
    const response = await fetch("http://127.0.0.1:8787/api/health", { signal: AbortSignal.timeout(2_000) });
    if (response.ok || response.status === 401) return;
  } catch {
    // Use the same actionable failure for network errors and unexpected responses.
  }

  throw new Error("Bestie UI must be running at http://127.0.0.1:8787 before starting the tunnel. Run 'bestie ui --port 8787 --no-open' first.");
}

function registerTunnelInstance(controlPlaneUrl: string, deviceId: string, clientVersion: string, fetcher?: typeof fetch): Promise<{ instanceId: string; instanceToken: string }> {
  return TunnelControlPlaneClient.register(controlPlaneUrl, {
    userId: deviceId,
    publicId: deviceId,
    platform: process.platform,
    appVersion: clientVersion,
  }, fetcher);
}

function isRegisteredPublicIdConflict(error: unknown): boolean {
  return error instanceof Error && /publicId is already registered/i.test(error.message);
}
