import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getRuntimePaths } from "../../runtime/paths.js";
import { getOrCreateTunnelInstallationId, rotateTunnelInstallationId } from "./state.js";

test("tunnel installation identity is opaque and persists across setup retries", async () => {
  const root = await mkdtemp(join(tmpdir(), "bestie-tunnel-installation-"));
  try {
    const paths = getRuntimePaths(root);
    const first = await getOrCreateTunnelInstallationId(paths);
    const second = await getOrCreateTunnelInstallationId(paths);

    assert.match(first, /^bestie-[a-f0-9]{32}$/);
    assert.equal(second, first);
    assert.deepEqual(JSON.parse(await readFile(join(paths.dataDir, "ui-tunnel-installation.json"), "utf8")), { version: 1, id: first });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tunnel installation identity can rotate after an incomplete registration", async () => {
  const root = await mkdtemp(join(tmpdir(), "bestie-tunnel-installation-"));
  try {
    const paths = getRuntimePaths(root);
    const original = await getOrCreateTunnelInstallationId(paths);
    const replacement = await rotateTunnelInstallationId(paths);

    assert.match(replacement, /^bestie-[a-f0-9]{32}$/);
    assert.notEqual(replacement, original);
    assert.equal(await getOrCreateTunnelInstallationId(paths), replacement);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});