import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const projectRoot = process.env.INIT_CWD ?? process.cwd();
const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-installer-smoke-"));
const installDir = resolve(rootDir, ".local/share/bestie/source");
const binDir = resolve(rootDir, ".local/bin");

try {
  const install = await run(resolve(projectRoot, "install.sh"), ["--skip-onboard", "--source-dir", projectRoot, "--dir", installDir, "--bin-dir", binDir], { cwd: rootDir, env: { HOME: rootDir } });
  assert.match(install.stdout, /Bestie install complete/);

  const doctor = await run(resolve(binDir, "bestie"), ["doctor"], { cwd: installDir, env: { HOME: rootDir }, allowFailure: true });
  assert.match(doctor.stdout, /Bestie Doctor/);
  assert.equal(doctor.code, 1);

  await run(resolve(binDir, "bestie"), ["onboard", "--skip-provider-test"], {
    cwd: installDir,
    env: { HOME: rootDir },
    input: "Bestie\nBoss\nvi\n7\nask\nopenai-compatible\nhttp://127.0.0.1:9/v1\ntest-model\ntest-key\n",
  });
  const readyDoctor = await run(resolve(binDir, "bestie"), ["doctor"], { cwd: installDir, env: { HOME: rootDir } });
  assert.match(readyDoctor.stdout, /Summary: 0 issues found/);

  const configBefore = await readFile(resolve(installDir, ".bestie/config.json"), "utf8");
  const reinstall = await run(resolve(projectRoot, "install.sh"), ["--skip-onboard", "--source-dir", projectRoot, "--dir", installDir, "--bin-dir", binDir], { cwd: rootDir, env: { HOME: rootDir } });
  assert.match(reinstall.stdout, /Bestie install complete/);
  assert.equal(await readFile(resolve(installDir, ".bestie/config.json"), "utf8"), configBefore);

  const unknownDir = resolve(rootDir, "unknown-existing-dir");
  await mkdir(unknownDir);
  await writeFile(resolve(unknownDir, "README.md"), "not bestie\n");
  const rejected = await run(resolve(projectRoot, "install.sh"), ["--skip-onboard", "--source-dir", projectRoot, "--dir", unknownDir, "--bin-dir", binDir], { cwd: rootDir, env: { HOME: rootDir }, allowFailure: true });
  assert.notEqual(rejected.code, 0);
  assert.match(rejected.stderr, /not a Bestie checkout/);
} finally {
  await rm(rootDir, { recursive: true, force: true });
}

async function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: options.cwd ?? projectRoot, env: { ...process.env, ...(options.env ?? {}) }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out: ${command} ${args.join(" ")}`));
    }, 120_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0 || options.allowFailure) {
        resolvePromise({ code, stdout, stderr });
      } else {
        reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${stdout}${stderr}`));
      }
    });

    child.stdin.end(options.input ?? "");
  });
}