import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const projectRoot = process.env.INIT_CWD ?? process.cwd();
const cliPath = resolve(projectRoot, "dist/cli/index.js");
const { validateDoctorReportJsonContract } = await import(resolve(projectRoot, "dist/runtime/doctor-report-contract.js"));

const result = spawnSync(process.execPath, [cliPath, "doctor", "--json"], {
  cwd: projectRoot,
  encoding: "utf8",
});

assert.equal(result.status, 0, result.stderr || result.stdout);

const contract = validateDoctorReportJsonContract(result.stdout);
assert.equal(contract.valid, true, contract.errors.join("\n"));

const report = JSON.parse(result.stdout);
console.log(`${report.checks.length} checks, ${report.fixes.length} fixes, ${report.issueCount} issues`);
