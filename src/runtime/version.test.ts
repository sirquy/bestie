import assert from "node:assert/strict";
import test from "node:test";

import { compareVersions } from "./version.js";

test("compareVersions orders semantic version cores", () => {
  assert.equal(compareVersions("0.1.5", "0.1.6"), -1);
  assert.equal(compareVersions("0.2.0", "0.1.99"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), 0);
});