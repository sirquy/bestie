import assert from "node:assert/strict";
import test from "node:test";

import { createCloudflareAccessVerifier } from "./access.js";

test("Cloudflare Access verifier rejects malformed assertions without fetching keys", async () => {
  let fetched = false;
  const verifier = createCloudflareAccessVerifier({
    teamDomain: "https://bestie.cloudflareaccess.com",
    audience: "bestie-aud",
    fetcher: async () => {
      fetched = true;
      return new Response(JSON.stringify({ keys: [] }));
    },
  });
  assert.equal(await verifier.verifyAssertion("not-a-jwt"), false);
  assert.equal(fetched, false);
});

test("Cloudflare Access verifier validates team-domain configuration", () => {
  assert.throws(() => createCloudflareAccessVerifier({ teamDomain: "http://bestie.cloudflareaccess.com", audience: "bestie-aud" }), /must be an HTTPS/);
  assert.throws(() => createCloudflareAccessVerifier({ teamDomain: "https://example.com", audience: "bestie-aud" }), /must be an HTTPS/);
});