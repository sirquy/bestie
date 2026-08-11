import assert from "node:assert/strict";
import test from "node:test";

import { createUiOriginPolicy, isAllowedSameOrigin, isRemoteTunnelRequest } from "./origin-policy.js";
import type { LocalTunnelState } from "./types.js";

const tunnelState: LocalTunnelState = {
  version: 1,
  controlPlaneUrl: "https://tunnel.bestieagent.com",
  deviceId: "bestie-device-001",
  instanceId: "ins-1",
  tunnel: { id: "tun-1", instanceId: "ins-1", hostname: "a1b2c3d4e5f6g7h8.bestieagent.cloud", url: "https://a1b2c3d4e5f6g7h8.bestieagent.cloud", originUrl: "http://127.0.0.1:8787", status: "ONLINE", credentialVersion: 1, createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z", lastSeenAt: null },
};

test("UI origin policy allows only exact loopback and assigned HTTPS tunnel origins", () => {
  const policy = createUiOriginPolicy({ localHost: "127.0.0.1", localPort: 8787, tunnel: tunnelState });
  assert.equal(isAllowedSameOrigin({ origin: "http://127.0.0.1:8787", host: "127.0.0.1:8787" }, policy), true);
  assert.equal(isAllowedSameOrigin({ origin: "http://localhost:8787", host: "localhost:8787" }, policy), true);
  assert.equal(isAllowedSameOrigin({ origin: "https://a1b2c3d4e5f6g7h8.bestieagent.cloud", host: "a1b2c3d4e5f6g7h8.bestieagent.cloud" }, policy), true);
  assert.equal(isAllowedSameOrigin({ origin: "https://a1b2c3d4e5f6g7h8.bestieagent.cloud", host: "127.0.0.1:8787" }, policy), true);
  assert.equal(isAllowedSameOrigin({ origin: "https://a1b2c3d4e5f6g7h8.bestieagent.cloud", host: "wrong.bestieagent.cloud" }, policy), false);
  assert.equal(isAllowedSameOrigin({ origin: "https://other.bestieagent.cloud", host: "other.bestieagent.cloud" }, policy), false);
  assert.equal(isAllowedSameOrigin({ origin: "http://a1b2c3d4e5f6g7h8.bestieagent.cloud", host: "a1b2c3d4e5f6g7h8.bestieagent.cloud" }, policy), false);
});

test("UI origin policy ignores forwarded headers and recognizes only assigned remote host", () => {
  const policy = createUiOriginPolicy({ localHost: "127.0.0.1", localPort: 8787, tunnel: tunnelState });
  assert.equal(isRemoteTunnelRequest({ host: "a1b2c3d4e5f6g7h8.bestieagent.cloud", "x-forwarded-host": "attacker.bestieagent.cloud", "x-forwarded-proto": "https" }, policy), true);
  assert.equal(isRemoteTunnelRequest({ host: "attacker.bestieagent.cloud", "x-forwarded-host": "a1b2c3d4e5f6g7h8.bestieagent.cloud", "x-forwarded-proto": "https" }, policy), false);
  assert.equal(isRemoteTunnelRequest({ host: "127.0.0.1:8787", origin: "https://a1b2c3d4e5f6g7h8.bestieagent.cloud" }, policy), true);
});