import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getRuntimePaths } from "../../runtime/paths.js";
import { ensureCloudflared, getCloudflaredStatus, startCloudflared } from "./cloudflared.js";

test("cloudflared connector starts without a shell using only the enrollment token", async () => {
  const root = await mkdtemp(join(tmpdir(), "bestie-cloudflared-"));
  let captured: { command?: string; args?: string[]; options?: Record<string, unknown> } = {};
  try {
    const connector = await startCloudflared({
      paths: getRuntimePaths(root),
      runToken: "connector-secret",
      executable: "cloudflared-test",
      verifyExecutable: async () => undefined,
      spawnProcess: ((command: string, args: string[], options: Record<string, unknown>) => {
        captured = { command, args, options };
        return { pid: 4321, unref: () => undefined } as never;
      }) as never,
    });
    assert.equal(connector.pid, 4321);
    assert.equal(captured.command, "cloudflared-test");
    assert.deepEqual(captured.args, ["tunnel", "run", "--token", "connector-secret"]);
    assert.equal(captured.options?.detached, true);
    assert.equal(captured.options?.shell, undefined);
    assert.match(connector.logPath, /tunnel-cloudflared\.log$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cloudflared connector surfaces executable verification failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "bestie-cloudflared-"));
  try {
    await assert.rejects(
      startCloudflared({ paths: getRuntimePaths(root), runToken: "connector-secret", executable: "missing-cloudflared", verifyExecutable: async () => { throw new Error("missing"); } }),
      /missing/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cloudflared installer runs only after an unavailable binary check", async () => {
  const calls: string[] = [];
  await ensureCloudflared({
    verifyExecutable: async () => {
      calls.push("verify");
      if (calls.length === 1) throw new Error("missing");
    },
    runInstaller: async (command, args) => { calls.push(`${command} ${args.join(" ")}`); },
  });

  assert.equal(calls.filter((call) => call === "verify").length, 2);
  assert.equal(calls.length, 3);
});

test("cloudflared status reports an unavailable executable without installing it", async () => {
  const status = await getCloudflaredStatus({ executable: "missing-cloudflared", verifyExecutable: async () => { throw new Error("missing"); } });
  assert.equal(status.available, false);
  assert.equal(status.executable, "missing-cloudflared");
});
