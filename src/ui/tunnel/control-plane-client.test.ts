import assert from "node:assert/strict";
import test from "node:test";

import { TunnelControlPlaneClient } from "./control-plane-client.js";

test("tunnel control-plane client registers an instance and provisions a tunnel with idempotency", async () => {
  let captured: { url?: string; init?: RequestInit } = {};
  const registration = await TunnelControlPlaneClient.register("http://127.0.0.1:8788", {
    userId: "user-1",
    publicId: "bestie-device-001",
    platform: "win32",
    appVersion: "0.1.39",
  }, async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ instanceId: "ins-1", instanceToken: "instance-secret" }), { status: 201, headers: { "content-type": "application/json" } });
  });
  assert.equal(captured.url, "http://127.0.0.1:8788/v1/instances/register");
  assert.equal(new Headers(captured.init?.headers).get("authorization"), null);
  assert.deepEqual(JSON.parse(String(captured.init?.body)), { userId: "user-1", publicId: "bestie-device-001", platform: "win32", appVersion: "0.1.39" });
  assert.equal(registration.instanceToken, "instance-secret");

  const client = new TunnelControlPlaneClient({
    baseUrl: "http://127.0.0.1:8788",
    instanceToken: registration.instanceToken,
    fetcher: async (url, init) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify(tunnelRecord()), { status: 201, headers: { "content-type": "application/json" } });
    },
  });

  const result = await client.createTunnel();
  assert.equal(captured.url, "http://127.0.0.1:8788/v1/tunnels");
  assert.equal(new Headers(captured.init?.headers).get("authorization"), "Bearer instance-secret");
  assert.ok(new Headers(captured.init?.headers).get("idempotency-key"));
  assert.equal(result.url, "https://random.bestieagent.cloud");
});

test("tunnel registration uses the opaque local installation identity without a user secret", async () => {
  let captured: RequestInit | undefined;
  await TunnelControlPlaneClient.register("http://127.0.0.1:8788", {
    userId: "bestie-0123456789abcdef0123456789abcdef",
    publicId: "bestie-0123456789abcdef0123456789abcdef",
    platform: "win32",
    appVersion: "0.1.39",
  }, async (_url, init) => {
    captured = init;
    return new Response(JSON.stringify({ instanceId: "ins-1", instanceToken: "instance-secret" }), { status: 201, headers: { "content-type": "application/json" } });
  });

  assert.deepEqual(JSON.parse(String(captured?.body)), {
    userId: "bestie-0123456789abcdef0123456789abcdef",
    publicId: "bestie-0123456789abcdef0123456789abcdef",
    platform: "win32",
    appVersion: "0.1.39",
  });
});

test("tunnel control-plane client rejects non-HTTPS non-local endpoints", () => {
  assert.throws(() => new TunnelControlPlaneClient({ baseUrl: "http://tunnel.bestieagent.com", instanceToken: "token" }), /must use HTTPS/);
});

test("tunnel control-plane client rejects tunnel records that violate the fixed origin contract", async () => {
  const client = new TunnelControlPlaneClient({
    baseUrl: "http://127.0.0.1:8788",
    instanceToken: "instance-secret",
    fetcher: async () => new Response(JSON.stringify({ ...tunnelRecord(), originUrl: "http://127.0.0.1:9999" }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  await assert.rejects(client.getTunnel("tun-1"), /invalid tunnel record/);
});

test("tunnel control-plane client accepts omitted optional tunnel fields", async () => {
  const client = new TunnelControlPlaneClient({
    baseUrl: "http://127.0.0.1:8788",
    instanceToken: "instance-secret",
    fetcher: async () => {
      const { lastSeenAt: _lastSeenAt, ...record } = tunnelRecord();
      return new Response(JSON.stringify(record), { status: 201, headers: { "content-type": "application/json" } });
    },
  });

  const result = await client.createTunnel();
  assert.equal(result.lastSeenAt, undefined);
});

test("tunnel control-plane client rejects incomplete tunnel responses", async () => {
  const client = new TunnelControlPlaneClient({
    baseUrl: "http://127.0.0.1:8788",
    instanceToken: "instance-secret",
    instanceId: "ins-1",
    fetcher: async () => new Response(JSON.stringify({ tunnelId: "tun-1", status: "OFFLINE", hostname: "random.bestieagent.cloud", url: "https://random.bestieagent.cloud" }), { status: 201, headers: { "content-type": "application/json" } }),
  });

  await assert.rejects(client.createTunnel(), /invalid tunnel record/);
});

test("tunnel control-plane client requires full failure tunnel responses", async () => {
  const client = new TunnelControlPlaneClient({
    baseUrl: "http://127.0.0.1:8788",
    instanceToken: "instance-secret",
    instanceId: "ins-1",
    fetcher: async () => new Response(JSON.stringify({ id: "tun-1", status: "FAILED", hostname: "random.bestieagent.cloud", url: "https://random.bestieagent.cloud", lastSeenAt: null, createdAt: "2026-08-11T10:58:19.868Z", failureCode: "cloudflare_disable_failed" }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  await assert.rejects(client.getTunnel("tun-1"), /invalid tunnel record/);
});

test("tunnel control-plane client rejects a tunnel owned by another instance", async () => {
  const client = new TunnelControlPlaneClient({
    baseUrl: "http://127.0.0.1:8788",
    instanceToken: "instance-secret",
    instanceId: "ins-expected",
    fetcher: async () => new Response(JSON.stringify(tunnelRecord()), { status: 200, headers: { "content-type": "application/json" } }),
  });

  await assert.rejects(client.getTunnel("tun-1"), /different instance/);
});

test("tunnel control-plane client validates sensitive launch credentials before use", async () => {
  const client = new TunnelControlPlaneClient({
    baseUrl: "http://127.0.0.1:8788",
    instanceToken: "instance-secret",
    fetcher: async () => new Response(JSON.stringify({ tunnelId: "tun-1", credentialVersion: 1, cloudflaredRunToken: "", command: ["cloudflared"] }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  await assert.rejects(client.getLaunchCredential("tun-1"), /invalid launch credential/);
});

function tunnelRecord() {
  return { id: "tun-1", instanceId: "ins-1", hostname: "random.bestieagent.cloud", url: "https://random.bestieagent.cloud", originUrl: "http://127.0.0.1:8787", status: "REQUESTED", credentialVersion: 1, createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z", lastSeenAt: null };
}
