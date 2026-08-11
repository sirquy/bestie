import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadEnvFile } from "../../runtime/env.js";
import { getRuntimePaths } from "../../runtime/paths.js";
import { setupTunnel } from "./lifecycle.js";
import { loadTunnelState } from "./state.js";

test("tunnel setup persists the contract tunnel and secret only after successful provisioning", async () => {
  const root = await mkdtemp(join(tmpdir(), "bestie-tunnel-lifecycle-"));
  const paths = getRuntimePaths(root);
  await mkdir(paths.appDir, { recursive: true });
  const requests: string[] = [];

  try {
    const state = await setupTunnel({
      paths,
      clientVersion: "test",
      fetcher: async (url) => {
        const path = new URL(String(url)).pathname;
        requests.push(path);
        if (path === "/v1/instances/register") {
          return jsonResponse({ instanceId: "ins-1", instanceToken: "instance-secret" }, 201);
        }
        return jsonResponse(tunnelRecord(), 201);
      },
    });

    assert.deepEqual(requests, ["/v1/instances/register", "/v1/tunnels"]);
    assert.equal(state.tunnel.id, "tun-1");
    assert.equal((await loadTunnelState(paths))?.tunnel.id, "tun-1");
    assert.equal((await loadEnvFile(paths)).BESTIE_TUNNEL_INSTANCE_TOKEN, "instance-secret");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tunnel setup disables the remote tunnel and removes the token when state persistence fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "bestie-tunnel-lifecycle-"));
  const paths = getRuntimePaths(root);
  await mkdir(paths.envPath, { recursive: true });
  const requests: string[] = [];

  try {
    await assert.rejects(setupTunnel({
      paths,
      clientVersion: "test",
      fetcher: async (url) => {
        const path = new URL(String(url)).pathname;
        requests.push(path);
        if (path === "/v1/instances/register") {
          return jsonResponse({ instanceId: "ins-1", instanceToken: "instance-secret" }, 201);
        }
        if (path === "/v1/tunnels") {
          return jsonResponse(tunnelRecord(), 201);
        }
        return jsonResponse({ ...tunnelRecord(), status: "DISABLED" }, 200);
      },
    }));

    assert.deepEqual(requests, ["/v1/instances/register", "/v1/tunnels", "/v1/tunnels/tun-1/disable"]);
    assert.equal((await loadEnvFile(paths)).BESTIE_TUNNEL_INSTANCE_TOKEN, undefined);
    assert.equal(await loadTunnelState(paths), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function tunnelRecord() {
  return { id: "tun-1", instanceId: "ins-1", hostname: "random.bestieagent.cloud", url: "https://random.bestieagent.cloud", originUrl: "http://127.0.0.1:8787", status: "OFFLINE", credentialVersion: 1, createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z", lastSeenAt: null };
}
