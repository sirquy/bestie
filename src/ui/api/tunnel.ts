import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { getTunnelStatus, revokeTunnel, setupTunnel, startTunnelConnector, stopTunnelConnector } from "../tunnel/lifecycle.js";
import { loadTunnelState } from "../tunnel/state.js";
import type { LocalTunnelState } from "../tunnel/types.js";

const CLIENT_VERSION = "0.1.39";

export type UiTunnelAction = "setup" | "start" | "stop" | "revoke";

export interface UiTunnelSummary {
  ok: true;
  tunnel?: {
    hostname: string;
    url: string;
    status: LocalTunnelState["tunnel"]["status"];
    updatedAt: string;
    lastSeenAt: string | null;
    connectorRunning: boolean;
    failureCode?: string;
    failureMessage?: string;
  };
}

export async function getUiTunnelSummary(paths: RuntimePaths = getRuntimePaths()): Promise<UiTunnelSummary> {
  const state = await loadTunnelState(paths);
  return toSummary(state ? await getTunnelStatus({ paths, clientVersion: CLIENT_VERSION }) : undefined);
}

export async function runUiTunnelAction(options: { action: UiTunnelAction; confirm: boolean; paths?: RuntimePaths }): Promise<UiTunnelSummary> {
  if (!options.confirm) throw new Error("Tunnel actions require confirm=true.");
  const paths = options.paths ?? getRuntimePaths();
  const lifecycleOptions = { paths, clientVersion: CLIENT_VERSION };

  if (options.action === "setup") return toSummary(await setupTunnel(lifecycleOptions));
  if (options.action === "start") return toSummary(await startTunnelConnector(lifecycleOptions));
  if (options.action === "stop") return toSummary(await stopTunnelConnector(lifecycleOptions));
  await revokeTunnel(lifecycleOptions);
  return { ok: true };
}

function toSummary(state: LocalTunnelState | undefined): UiTunnelSummary {
  if (!state) return { ok: true };
  return {
    ok: true,
    tunnel: {
      hostname: state.tunnel.hostname,
      url: state.tunnel.url,
      status: state.tunnel.status,
      updatedAt: state.tunnel.updatedAt,
      lastSeenAt: state.tunnel.lastSeenAt,
      connectorRunning: Boolean(state.connector),
      ...(state.tunnel.failureCode ? { failureCode: state.tunnel.failureCode } : {}),
      ...(state.tunnel.failureMessage ? { failureMessage: state.tunnel.failureMessage } : {}),
    },
  };
}