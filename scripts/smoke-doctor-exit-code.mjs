import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { validateDoctorReportJsonContract } from "../dist/runtime/doctor-report-contract.js";

const projectRoot = process.env.INIT_CWD ?? process.cwd();
const cliPath = resolve(projectRoot, "dist/cli/index.js");
const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-doctor-exit-code-"));

try {
  const human = spawnSync(process.execPath, [cliPath, "doctor"], {
    cwd: rootDir,
    encoding: "utf8",
  });

  assert.equal(human.status, 1, human.stderr || human.stdout);
  assert.match(human.stdout, /Summary: \d+ issues found\./);

  const json = spawnSync(process.execPath, [cliPath, "doctor", "--json"], {
    cwd: rootDir,
    encoding: "utf8",
  });

  assert.equal(json.status, 1, json.stderr || json.stdout);

  const contract = validateDoctorReportJsonContract(json.stdout);
  assert.equal(contract.valid, true, contract.errors.join("\n"));

  const report = JSON.parse(json.stdout);
  assert.ok(report.issueCount > 0, "missing setup must report failing issues");
  console.log(`doctor exits 1 for ${report.issueCount} missing-setup issues`);
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
