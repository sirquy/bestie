import type { IncomingHttpHeaders } from "node:http";

import type { LocalTunnelState } from "./types.js";

export interface UiOriginPolicy {
  localOrigins: ReadonlySet<string>;
  localHosts: ReadonlySet<string>;
  remoteOrigin?: string;
}

export function createUiOriginPolicy(options: { localHost: string; localPort: number; tunnel?: LocalTunnelState }): UiOriginPolicy {
  const localOrigins = new Set<string>();
  const normalizedHost = options.localHost === "localhost" ? "localhost" : "127.0.0.1";
  localOrigins.add(`http://${normalizedHost}:${options.localPort}`);
  if (normalizedHost === "127.0.0.1") localOrigins.add(`http://localhost:${options.localPort}`);
  if (normalizedHost === "localhost") localOrigins.add(`http://127.0.0.1:${options.localPort}`);
  const localHosts = new Set([...localOrigins].map((origin) => new URL(origin).host));

  const remoteOrigin = options.tunnel?.tunnel.status === "ONLINE" && isValidTunnelHostname(options.tunnel.tunnel.hostname)
    ? `https://${options.tunnel.tunnel.hostname}`
    : undefined;
  return { localOrigins, localHosts, ...(remoteOrigin ? { remoteOrigin } : {}) };
}

export function isAllowedSameOrigin(headers: IncomingHttpHeaders, policy: UiOriginPolicy): boolean {
  const origin = readSingleHeader(headers.origin);
  const host = readSingleHeader(headers.host)?.toLowerCase();
  if (!origin || !host) return false;
  if (origin === policy.remoteOrigin) return host === new URL(policy.remoteOrigin).host || policy.localHosts.has(host);
  return policy.localOrigins.has(origin) && new URL(origin).host === host;
}

export function isRemoteTunnelRequest(headers: IncomingHttpHeaders, policy: UiOriginPolicy): boolean {
  const host = readSingleHeader(headers.host)?.toLowerCase();
  const origin = readSingleHeader(headers.origin);
  return Boolean(policy.remoteOrigin && (host === new URL(policy.remoteOrigin).host || origin === policy.remoteOrigin));
}

function isValidTunnelHostname(hostname: string): boolean {
  return /^[a-z0-9-]{3,64}\.bestieagent\.cloud$/.test(hostname);
}

function readSingleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}