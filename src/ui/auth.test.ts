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

test("UI auth changes the PIN and invalidates existing sessions", async () => {
  const paths = getRuntimePaths(await mkdtemp(join(tmpdir(), "bestie-ui-auth-")));
  const auth = new UiAuthService(paths);
  await auth.setup("123456");
  const oldSession = await auth.login("123456");
  await assert.rejects(auth.changePin("000000", "654321"), /Current unlock PIN is incorrect/);
  await auth.changePin("123456", "654321");
  assert.equal(auth.validateSession(oldSession.sessionId), undefined);
  await assert.rejects(auth.login("123456"), /Incorrect unlock PIN/);
  assert.ok(await auth.login("654321"));
});

test("UI auth can inspect a session without extending its idle lifetime", async () => {
  const paths = getRuntimePaths(await mkdtemp(join(tmpdir(), "bestie-ui-auth-")));
  let now = 1000;
  const auth = new UiAuthService(paths, () => now);
  await auth.setup("123456");
  const login = await auth.login("123456");
  now += 5 * 60 * 1000;
  const status = auth.getSessionStatus(auth.validateSession(login.sessionId, { touch: false })!);
  assert.equal(status.idleExpiresAt, new Date(1000 + 30 * 60 * 1000).toISOString());
  auth.validateSession(login.sessionId);
  assert.equal(auth.getSessionStatus(auth.validateSession(login.sessionId, { touch: false })!).idleExpiresAt, new Date(1000 + 35 * 60 * 1000).toISOString());
});

test("UI auth accepts exactly six-digit PINs", async () => {
  const paths = getRuntimePaths(await mkdtemp(join(tmpdir(), "bestie-ui-auth-")));
  const auth = new UiAuthService(paths);
  await assert.rejects(auth.setup("12345"), /exactly 6 digits/);
  await assert.rejects(auth.setup("1234567"), /exactly 6 digits/);
  await auth.setup("123456");
  await assert.rejects(auth.login("12345"), /Incorrect unlock PIN/);
  await assert.rejects(auth.login("1234567"), /Incorrect unlock PIN/);
});