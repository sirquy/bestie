import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { reviewActionPermission, type PermissionApprover, type PermissionPolicy } from "../safety/permission-policy.js";
import { getTunnelStatus, revokeTunnel, startTunnelConnector, stopTunnelConnector } from "../ui/tunnel/lifecycle.js";
import { getCloudflaredStatus } from "../ui/tunnel/cloudflared.js";

export type TunnelToolAction = "status" | "start" | "stop" | "revoke";

export async function runTunnelTool(options: { action: TunnelToolAction; config: AppConfig; paths: RuntimePaths; clientVersion: string; approver?: PermissionApprover; policy?: PermissionPolicy }) {
  const category = options.action === "status" ? "read" : options.action === "revoke" ? "destructive" : "local_write";
  const configured = options.config.internalTools?.policies?.[`internal.tunnel_${options.action}`];
  if (configured === "deny") return { ok: false, message: `internal.tunnel_${options.action} is denied by config.` };
  if (configured !== "allow" && options.action !== "start") {
    const request = { tool: `internal.tunnel_${options.action}`, arguments: {} } as const;
    const permission = await reviewActionPermission({ category, action: request.tool, target: "Bestie remote-access tunnel", reason: `Agent requested tunnel ${options.action}.`, trusted: options.action === "status", payloadJson: JSON.stringify(request) }, { paths: options.paths, approver: options.approver, policy: options.policy });
    if (permission.decision !== "allow") return { ok: false, message: `Tunnel ${options.action} denied: ${permission.reason}` };
  }
  if (options.action === "status") return { ok: true, message: "Tunnel status loaded.", result: { tunnel: await getTunnelStatus({ paths: options.paths, clientVersion: options.clientVersion }), cloudflared: await getCloudflaredStatus() } };
  if (options.action === "start") return { ok: true, message: "Tunnel connector started.", result: await startTunnelConnector({ paths: options.paths, clientVersion: options.clientVersion }) };
  if (options.action === "stop") return { ok: true, message: "Tunnel connector stopped.", result: await stopTunnelConnector({ paths: options.paths, clientVersion: options.clientVersion }) };
  return { ok: true, message: "Tunnel revoked.", result: { hostname: await revokeTunnel({ paths: options.paths, clientVersion: options.clientVersion }) } };
}
