import assert from "node:assert/strict";
import test from "node:test";

import { configuredOwnerIds, hasConfiguredOwner, matchesOwnerId } from "./owner-policy.js";

test("owner policy supports one owner, many owners, and the wildcard", () => {
  assert.equal(matchesOwnerId("owner-1", ["owner-1"]), true);
  assert.equal(matchesOwnerId(["owner-1", "owner-2"], ["owner-2"]), true);
  assert.equal(matchesOwnerId(["owner-1", "owner-2"], ["other"]), false);
  assert.equal(matchesOwnerId(["*"], ["any-sender"]), true);
});

test("owner policy never turns a wildcard into a notification recipient", () => {
  assert.equal(hasConfiguredOwner(["*"]), true);
  assert.deepEqual(configuredOwnerIds(["*"]), []);
  assert.deepEqual(configuredOwnerIds(["owner-1", "owner-2"]), ["owner-1", "owner-2"]);
});
