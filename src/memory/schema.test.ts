import assert from "node:assert/strict";
import test from "node:test";

import { MEMORY_DB_RELATIVE_PATH, MEMORY_SCHEMA_SQL } from "./schema.js";

test("MEMORY_SCHEMA_SQL defines the MVP memory tables", () => {
  assert.match(MEMORY_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS memories/);
  assert.match(MEMORY_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS messages/);
  assert.match(MEMORY_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS pending_memories/);
  assert.match(MEMORY_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS memory_state/);
  assert.match(MEMORY_SCHEMA_SQL, /sensitivity TEXT DEFAULT 'normal'/);
  assert.match(MEMORY_SCHEMA_SQL, /source TEXT DEFAULT 'manual'/);
  assert.match(MEMORY_SCHEMA_SQL, /explicit_consent INTEGER DEFAULT 0/);
  assert.match(MEMORY_SCHEMA_SQL, /policy_reason TEXT/);
});

test("MEMORY_DB_RELATIVE_PATH stays local to repo data", () => {
  assert.equal(MEMORY_DB_RELATIVE_PATH, ".bestie/data/memory.sqlite");
});
