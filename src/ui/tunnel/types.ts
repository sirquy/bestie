export interface TunnelLocalUiTarget {
  host: "127.0.0.1" | "localhost";
  port: number;
}

export interface TunnelPublicRecord {
  id: string;
  instanceId: string;
  hostname: string;
  url: string;
  originUrl: "http://127.0.0.1:8787";
  status: "REQUESTED" | "PROVISIONING" | "ONLINE" | "OFFLINE" | "DISABLING" | "DISABLED" | "ROTATING" | "REVOKED" | "FAILED";
  credentialVersion: number;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
}

const TUNNEL_STATUSES = new Set<TunnelPublicRecord["status"]>([
  "REQUESTED",
  "PROVISIONING",
  "ONLINE",
  "OFFLINE",
  "DISABLING",
  "DISABLED",
  "ROTATING",
  "REVOKED",
  "FAILED",
]);

export function isTunnelPublicRecord(value: unknown): value is TunnelPublicRecord {
  if (!isRecord(value)) return false;

  return typeof value.id === "string"
    && typeof value.instanceId === "string"
    && isValidTunnelHostname(value.hostname)
    && value.url === `https://${value.hostname}`
    && value.originUrl === "http://127.0.0.1:8787"
    && typeof value.status === "string"
    && TUNNEL_STATUSES.has(value.status as TunnelPublicRecord["status"])
    && typeof value.credentialVersion === "number"
    && Number.isInteger(value.credentialVersion)
    && value.credentialVersion >= 1
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string"
    && (value.lastSeenAt === undefined || value.lastSeenAt === null || typeof value.lastSeenAt === "string")
    && (value.failureCode === undefined || value.failureCode === null || typeof value.failureCode === "string")
    && (value.failureMessage === undefined || value.failureMessage === null || typeof value.failureMessage === "string");
}

function isValidTunnelHostname(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9-]{3,64}\.bestieagent\.cloud$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export interface TunnelLaunchCredential {
  tunnelId: string;
  credentialVersion: number;
  cloudflaredRunToken: string;
  command: string[];
}

export interface LocalTunnelState {
  version: 1;
  controlPlaneUrl: string;
  deviceId: string;
  instanceId: string;
  tunnel: TunnelPublicRecord;
  connector?: {
    pid: number;
    executable: string;
    logPath: string;
    startedAt: string;
  };
}