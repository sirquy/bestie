import { randomUUID } from "node:crypto";

import { isTunnelPublicRecord, type TunnelLaunchCredential, type TunnelPublicRecord } from "./types.js";

export interface TunnelControlPlaneClientOptions {
  baseUrl: string;
  instanceToken: string;
  instanceId?: string;
  fetcher?: typeof fetch;
}

export interface RegisterInstanceInput {
  userId: string;
  publicId: string;
  name?: string;
  platform: string;
  appVersion: string;
}

export class TunnelControlPlaneClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: TunnelControlPlaneClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetcher = options.fetcher ?? fetch;
  }

  static async register(baseUrl: string, input: RegisterInstanceInput, fetcher: typeof fetch = fetch): Promise<{ instanceId: string; instanceToken: string }> {
    const client = new TunnelControlPlaneClient({ baseUrl, instanceToken: "registration-not-authorized", fetcher });
    return client.request("/v1/instances/register", { method: "POST", body: input, includeAuthorization: false }) as Promise<{ instanceId: string; instanceToken: string }>;
  }

  async createTunnel(): Promise<TunnelPublicRecord> {
    return parseTunnelRecord(await this.request("/v1/tunnels", { method: "POST", body: {}, idempotencyKey: randomUUID() }), this.options.instanceId);
  }

  async getTunnel(tunnelId: string): Promise<TunnelPublicRecord> {
    return parseTunnelRecord(await this.request(`/v1/tunnels/${encodeURIComponent(tunnelId)}`, { method: "GET" }), this.options.instanceId);
  }

  async getLaunchCredential(tunnelId: string): Promise<TunnelLaunchCredential> {
    return parseLaunchCredential(await this.request(`/v1/tunnels/${encodeURIComponent(tunnelId)}/launch-credential`, { method: "POST" }));
  }

  async heartbeat(tunnelId: string, status: "connected" | "disconnected", runtimeVersion: string): Promise<TunnelPublicRecord> {
    return parseTunnelRecord(await this.request(`/v1/tunnels/${encodeURIComponent(tunnelId)}/heartbeat`, { method: "POST", body: { status, runtimeVersion } }), this.options.instanceId);
  }

  async disableTunnel(tunnelId: string): Promise<TunnelPublicRecord> {
    return parseTunnelRecord(await this.request(`/v1/tunnels/${encodeURIComponent(tunnelId)}/disable`, { method: "POST", idempotencyKey: randomUUID() }), this.options.instanceId);
  }

  private async request(path: string, options: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string; includeAuthorization?: boolean }): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: options.method,
      headers: {
        accept: "application/json",
        ...(options.includeAuthorization === false ? {} : { authorization: `Bearer ${this.options.instanceToken}` }),
        ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const body = await response.json() as { error?: unknown; code?: unknown };
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Tunnel control-plane request failed (${response.status}).`);
    return body;
  }
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost"))) {
    throw new Error("Tunnel control-plane URL must use HTTPS, except for localhost development.");
  }
  return url.toString().replace(/\/$/, "");
}

function parseTunnelRecord(value: unknown, instanceId?: string): TunnelPublicRecord {
  if (!isTunnelPublicRecord(value)) {
    throw new Error("Tunnel control plane returned an invalid tunnel record.");
  }

  if (instanceId && value.instanceId !== instanceId) {
    throw new Error("Tunnel control plane returned a tunnel for a different instance.");
  }

  return value;
}

function parseLaunchCredential(value: unknown): TunnelLaunchCredential {
  if (!isRecord(value)
    || typeof value.tunnelId !== "string"
    || !Number.isInteger(value.credentialVersion)
    || (value.credentialVersion as number) < 1
    || typeof value.cloudflaredRunToken !== "string"
    || !value.cloudflaredRunToken
    || !Array.isArray(value.command)
    || !value.command.every((part) => typeof part === "string")) {
    throw new Error("Tunnel control plane returned an invalid launch credential.");
  }

  return {
    tunnelId: value.tunnelId,
    credentialVersion: value.credentialVersion,
    cloudflaredRunToken: value.cloudflaredRunToken,
    command: value.command,
  } as TunnelLaunchCredential;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
