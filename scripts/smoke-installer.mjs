import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const projectRoot = process.env.INIT_CWD ?? process.cwd();
const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-installer-smoke-"));
const binDir = resolve(rootDir, ".local/bin");

try {
  const pack = await run("npm", ["pack", "--pack-destination", rootDir], { cwd: projectRoot });
  const packagePath = resolve(rootDir, pack.stdout.trim().split(/\r?\n/).pop());

  const install = await run(resolve(projectRoot, "install.sh"), ["--skip-onboard", "--package", packagePath, "--bin-dir", binDir], { cwd: rootDir, env: { HOME: rootDir } });
  assert.match(install.stdout, /Cài đặt Bestie hoàn tất/);
  assert.match(install.stdout, /Lệnh bestie đã sẵn sàng/);
  assert(!install.stdout.includes("==> Chạy Doctor"), "skip-onboard install should not run doctor before onboard");

  const pathCheck = await run("bestie", ["--help"], { cwd: rootDir, env: { HOME: rootDir, PATH: `${binDir}:${process.env.PATH ?? ""}` } });
  assert.match(pathCheck.stdout, /Usage: bestie/);

  const doctor = await run(resolve(binDir, "bestie"), ["doctor"], { cwd: rootDir, env: { HOME: rootDir }, allowFailure: true });
  assert.match(doctor.stdout, /Bestie Doctor/);
  assert.equal(doctor.code, 1);

  await run(resolve(binDir, "bestie"), ["onboard", "--skip-provider-test"], {
    cwd: rootDir,
    env: { HOME: rootDir },
    input: "Bestie\nBoss\nallow\nopenai-compatible\nhttp://127.0.0.1:9/v1\ntest-model\ntest-key\n",
  });
  const readyDoctor = await run(resolve(binDir, "bestie"), ["doctor"], { cwd: rootDir, env: { HOME: rootDir } });
  assert.match(readyDoctor.stdout, /Tóm tắt: tìm thấy 0 vấn đề/);

  const configBefore = await readFile(resolve(rootDir, ".bestie/config.json"), "utf8");
  const config = JSON.parse(configBefore);
  assert.equal(config.agent.language, "vi");
  assert.equal(config.agent.timeZone, "Asia/Bangkok");
  assert.equal(config.agent.toneIntensity, 7);
  const reinstall = await run(resolve(projectRoot, "install.sh"), ["--skip-onboard", "--package", packagePath, "--bin-dir", binDir], { cwd: rootDir, env: { HOME: rootDir } });
  assert.match(reinstall.stdout, /Cài đặt Bestie hoàn tất/);
  assert.equal(await readFile(resolve(rootDir, ".bestie/config.json"), "utf8"), configBefore);

  const rejected = await run(resolve(projectRoot, "install.sh"), ["--skip-onboard", "--source-dir", projectRoot, "--bin-dir", binDir], { cwd: rootDir, env: { HOME: rootDir }, allowFailure: true });
  assert.notEqual(rejected.code, 0);
  assert.match(rejected.stderr, /Không hỗ trợ tùy chọn: --source-dir/);
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