import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { getRuntimePaths } from "../runtime/paths.js";
import { UiAuthService } from "./auth.js";

test("UI auth hashes a PIN and creates an expiring in-memory session", async () => {
  const paths = getRuntimePaths(await mkdtemp(join(tmpdir(), "bestie-ui-auth-")));
  let now = 1000;
  const auth = new UiAuthService(paths, () => now);

  await auth.setup("123456");
  const stored = await readFile(resolve(paths.dataDir, "ui-auth.json"), "utf8");
  assert.ok(!stored.includes("123456"));
  const login = await auth.login("123456");
  const session = auth.validateSession(login.sessionId);
  assert.ok(session);
  assert.equal(auth.validateCsrf(session, login.csrfToken), true);
  assert.equal(auth.validateCsrf(session, "wrong"), false);

  now += 31 * 60 * 1000;
  assert.equal(auth.validateSession(login.sessionId), undefined);
});

test("UI auth rate limits incorrect PIN attempts and reset removes the local credential", async () => {
  const paths = getRuntimePaths(await mkdtemp(join(tmpdir(), "bestie-ui-auth-")));
  const auth = new UiAuthService(paths);
  await auth.setup("123456");
  for (let index = 0; index < 5; index += 1) await assert.rejects(auth.login("000000"));
  await assert.rejects(auth.login("123456"), /Too many incorrect PIN attempts/);
  assert.equal(await auth.reset(), true);
  assert.equal(await auth.isConfigured(), false);
});