import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { getRuntimePaths } from "../runtime/paths.js";
import { startUiServer } from "./server.js";
import { writeTunnelState } from "./tunnel/state.js";

test("UI server requires local unlock and validates same-origin CSRF mutations", async () => {
  const root = await mkdtemp(join(tmpdir(), "bestie-ui-server-auth-"));
  const server = await startUiServer({ port: 0, paths: getRuntimePaths(root) });
  try {
    const locked = await fetch(`${server.url}/api/health`);
    assert.equal(locked.status, 401);

    const crossOrigin = await fetch(`${server.url}/api/auth/setup`, { method: "POST", headers: { "content-type": "application/json", origin: "http://attacker.invalid" }, body: JSON.stringify({ pin: "123456" }) });
    assert.equal(crossOrigin.status, 403);

    const setup = await fetch(`${server.url}/api/auth/setup`, { method: "POST", headers: { "content-type": "application/json", origin: server.url }, body: JSON.stringify({ pin: "123456" }) });
    const setupBody = await setup.json() as { csrfToken?: string };
    const cookie = setup.headers.get("set-cookie")?.split(";", 1)[0];
    assert.equal(setup.status, 200);
    assert.ok(cookie);
    assert.ok(setupBody.csrfToken);

  const status = await fetch(`${server.url}/api/auth/status`, { headers: { cookie } });
  const statusBody = await status.json() as { authenticated?: boolean; session?: { idleExpiresAt?: string; sessionExpiresAt?: string } };
  assert.equal(statusBody.authenticated, true);
  assert.ok(statusBody.session?.idleExpiresAt);
  assert.ok(statusBody.session?.sessionExpiresAt);

    const authenticated = await fetch(`${server.url}/api/health`, { headers: { cookie } });
    assert.equal(authenticated.status, 200);
    const invalidPinChange = await fetch(`${server.url}/api/auth/change-pin`, { method: "POST", headers: { cookie, origin: server.url, "x-bestie-csrf": setupBody.csrfToken ?? "", "content-type": "application/json" }, body: JSON.stringify({ currentPin: "000000", nextPin: "654321" }) });
    assert.equal(invalidPinChange.status, 400);
    const blockedMutation = await fetch(`${server.url}/api/auth/logout`, { method: "POST", headers: { cookie } });
    assert.equal(blockedMutation.status, 403);
    const logout = await fetch(`${server.url}/api/auth/logout`, { method: "POST", headers: { cookie, origin: server.url, "x-bestie-csrf": setupBody.csrfToken ?? "" } });
    assert.equal(logout.status, 200);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});


test("UI server uses its supplied runtime paths for skill APIs", async () => {
  const root = await mkdtemp(join(tmpdir(), "bestie-ui-server-paths-"));
  const paths = getRuntimePaths(root);
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(paths.configPath, `${JSON.stringify({
    version: 2,
    agent: { name: "Path Test", ownerName: "Boss", language: "vi", toneIntensity: 7 },
    llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: { "openai:api-key": { provider: "openai-compatible", mode: "api-key", baseUrl: "https://example.test/v1", apiKeyEnv: "OPENAI_API_KEY" } },
      modelCatalog: { "openai/test-model": { profile: "openai:api-key" } },
    },
  }, null, 2)}\n`);
  await mkdir(resolve(paths.appDir, "skills", "custom-runtime-skill"), { recursive: true });
  await writeFile(resolve(paths.appDir, "skills", "custom-runtime-skill", "SKILL.md"), "# Custom Runtime Skill\n\nOnly in the supplied runtime.\n");

  const server = await startUiServer({ port: 0, paths });
  try {
    const setup = await fetch(`${server.url}/api/auth/setup`, { method: "POST", headers: { "content-type": "application/json", origin: server.url }, body: JSON.stringify({ pin: "123456" }) });
    const cookie = setup.headers.get("set-cookie")?.split(";", 1)[0];
    assert.equal(setup.status, 200);
    assert.ok(cookie);

    const skills = await fetch(`${server.url}/api/skills`, { headers: { cookie } });
    const body = await skills.json() as { skills?: Array<{ name: string }> };
    assert.equal(skills.status, 200);
    assert.ok(body.skills?.some((skill) => skill.name === "custom-runtime-skill"));
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("UI server requires an exact assigned remote origin and sets Secure cookies for it", async () => {
  const root = await mkdtemp(join(tmpdir(), "bestie-ui-server-remote-auth-"));
  const paths = getRuntimePaths(root);
  const hostname = "a1b2c3d4e5f6g7h8.bestieagent.cloud";
  await writeTunnelState({
    version: 1,
    controlPlaneUrl: "https://tunnel.bestieagent.com",
    deviceId: "bestie-device-001",
    instanceId: "ins-1",
    tunnel: { id: "tun-1", instanceId: "ins-1", hostname, url: `https://${hostname}`, originUrl: "http://127.0.0.1:8787", status: "ONLINE", credentialVersion: 1, createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z", lastSeenAt: null },
  }, paths);
  const server = await startUiServer({ port: 0, paths, tunnelAccessVerifier: { verifyAssertion: async (assertion) => assertion === "verified-access-jwt" } });
  try {
    const remoteOrigin = `https://${hostname}`;
    const rejected = await postJson(server, "wrong.bestieagent.com", remoteOrigin, { pin: "123456" });
    assert.equal(rejected.statusCode, 403);

    const missingAssertion = await postJson(server, hostname, remoteOrigin, { pin: "123456" });
    assert.equal(missingAssertion.statusCode, 403);

    const rejectedAssertion = await postJson(server, hostname, remoteOrigin, { pin: "123456" }, "invalid-access-jwt");
    assert.equal(rejectedAssertion.statusCode, 403);

    const setup = await postJson(server, hostname, remoteOrigin, { pin: "123456" }, "verified-access-jwt");
    assert.equal(setup.statusCode, 200);
    assert.match(setup.headers["set-cookie"]?.[0] ?? "", /HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200; Secure/);

    const loopbackSetup = await postJson(server, `127.0.0.1:${server.port}`, remoteOrigin, { pin: "123456" }, "verified-access-jwt", "/api/auth/login");
    assert.equal(loopbackSetup.statusCode, 200);
    assert.match(loopbackSetup.headers["set-cookie"]?.[0] ?? "", /HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200; Secure/);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("UI server permits assigned tunnel access with the local unlock when Cloudflare Access is not configured", async () => {
  const root = await mkdtemp(join(tmpdir(), "bestie-ui-server-remote-pin-auth-"));
  const paths = getRuntimePaths(root);
  const hostname = "a1b2c3d4e5f6g7h8.bestieagent.cloud";
  await writeTunnelState({
    version: 1,
    controlPlaneUrl: "https://tunnel.bestieagent.com",
    deviceId: "bestie-device-001",
    instanceId: "ins-1",
    tunnel: { id: "tun-1", instanceId: "ins-1", hostname, url: `https://${hostname}`, originUrl: "http://127.0.0.1:8787", status: "ONLINE", credentialVersion: 1, createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z", lastSeenAt: null },
  }, paths);
  const server = await startUiServer({ port: 0, paths });
  try {
    const setup = await postJson(server, hostname, `https://${hostname}`, { pin: "123456" });
    assert.equal(setup.statusCode, 200);
    assert.match(setup.headers["set-cookie"]?.[0] ?? "", /HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200; Secure/);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

function postJson(server: Awaited<ReturnType<typeof startUiServer>>, host: string, origin: string, body: unknown, accessAssertion?: string, path = "/api/auth/setup"): Promise<{ statusCode: number; headers: import("node:http").IncomingHttpHeaders }> {
  return new Promise((resolvePromise, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port: server.port, path, method: "POST", headers: { host, origin, "content-type": "application/json", ...(accessAssertion ? { "cf-access-jwt-assertion": accessAssertion } : {}) } }, (response) => {
      response.resume();
      response.once("end", () => resolvePromise({ statusCode: response.statusCode ?? 0, headers: response.headers }));
    });
    request.once("error", reject);
    request.end(JSON.stringify(body));
  });
}