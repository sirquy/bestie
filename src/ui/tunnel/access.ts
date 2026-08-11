import { createPublicKey, verify, type JsonWebKey as NodeJsonWebKey } from "node:crypto";

export interface TunnelAccessVerifier {
  verifyAssertion: (assertion: string) => Promise<boolean>;
}

export interface CloudflareAccessOptions {
  teamDomain: string;
  audience: string;
  fetcher?: typeof fetch;
}

interface AccessJwk {
  kid?: string;
  kty?: string;
  alg?: string;
  n?: string;
  e?: string;
}

export function createCloudflareAccessVerifier(options: CloudflareAccessOptions): TunnelAccessVerifier {
  const teamDomain = normalizeTeamDomain(options.teamDomain);
  const fetcher = options.fetcher ?? fetch;
  let keys: AccessJwk[] | undefined;

  return {
    async verifyAssertion(assertion: string): Promise<boolean> {
      try {
        const [encodedHeader, encodedPayload, encodedSignature, ...extra] = assertion.split(".");
        if (!encodedHeader || !encodedPayload || !encodedSignature || extra.length > 0) return false;
        const header = decodeJson(encodedHeader) as { alg?: unknown; kid?: unknown };
        const payload = decodeJson(encodedPayload) as { iss?: unknown; aud?: unknown; exp?: unknown; nbf?: unknown };
        if (header.alg !== "RS256" || typeof header.kid !== "string" || payload.iss !== teamDomain || !hasAudience(payload.aud, options.audience) || !isCurrent(payload)) return false;
        keys ??= await loadKeys(teamDomain, fetcher);
        const jwk = keys.find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA" && candidate.alg === "RS256" && candidate.n && candidate.e);
        if (!jwk) return false;
        const publicKey = createPublicKey({ key: jwk as NodeJsonWebKey, format: "jwk" });
        return verify("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`), publicKey, Buffer.from(encodedSignature, "base64url"));
      } catch {
        return false;
      }
    },
  };
}

async function loadKeys(teamDomain: string, fetcher: typeof fetch): Promise<AccessJwk[]> {
  const response = await fetcher(`${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error("Cloudflare Access signing keys were unavailable.");
  const body = await response.json() as { keys?: unknown };
  if (!Array.isArray(body.keys)) throw new Error("Cloudflare Access signing keys were invalid.");
  return body.keys.filter(isAccessJwk);
}

function decodeJson(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

function hasAudience(value: unknown, expected: string): boolean {
  return value === expected || (Array.isArray(value) && value.includes(expected));
}

function isCurrent(payload: { exp?: unknown; nbf?: unknown }): boolean {
  const now = Math.floor(Date.now() / 1000);
  return typeof payload.exp === "number" && payload.exp > now && (payload.nbf === undefined || (typeof payload.nbf === "number" && payload.nbf <= now));
}

function normalizeTeamDomain(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".cloudflareaccess.com") || url.pathname !== "/") throw new Error("Cloudflare Access team domain must be an HTTPS *.cloudflareaccess.com URL.");
  return url.toString().replace(/\/$/, "");
}

function isAccessJwk(value: unknown): value is AccessJwk {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}