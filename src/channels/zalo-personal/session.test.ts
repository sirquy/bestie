import assert from "node:assert/strict";
import test from "node:test";

import { decodeZaloPersonalSession, encodeZaloPersonalSession } from "./session.js";

const credentials = {
  imei: "device-id",
  cookie: [{ name: "zpsid", value: "secret-cookie" }],
  userAgent: "Bestie test agent",
  language: "vi",
};

test("Zalo Personal session codec round-trips versioned credentials", () => {
  const encoded = encodeZaloPersonalSession(credentials);

  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeZaloPersonalSession(encoded), { version: 1, credentials });
});

test("Zalo Personal session codec rejects malformed, incomplete, and unsupported sessions without echoing secrets", () => {
  const badVersion = Buffer.from(JSON.stringify({ version: 2, credentials }), "utf8").toString("base64url");
  const incomplete = Buffer.from(JSON.stringify({ version: 1, credentials: { imei: "device-id", cookie: [], userAgent: "Bestie test agent" } }), "utf8").toString("base64url");

  for (const value of ["not-a-session", badVersion, incomplete]) {
    assert.throws(() => decodeZaloPersonalSession(value), (error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      assert.doesNotMatch(message, /secret-cookie/);
      return true;
    });
  }
});
