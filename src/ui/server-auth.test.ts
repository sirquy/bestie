import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getRuntimePaths } from "../runtime/paths.js";
import { startUiServer } from "./server.js";

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