import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-onboard-smoke-"));
const projectRoot = process.env.INIT_CWD ?? process.cwd();
const cliPath = resolve(projectRoot, "dist/cli/index.js");

try {
  const result = spawnSync(process.execPath, [cliPath, "onboard", "--skip-provider-test"], {
    cwd: rootDir,
    env: { ...process.env, HOME: rootDir, USERPROFILE: rootDir, HOMEDRIVE: "", HOMEPATH: rootDir },
    input: "Bestie\nBoss\nask\nopenai-compatible\nhttp://127.0.0.1:9/v1\ntest-model\ntest-key\n",
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /test-key/);
  console.log("Onboard smoke passed.");
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
