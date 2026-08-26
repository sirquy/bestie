import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const packageJsonPath = resolve(projectRoot, "package.json");
const releaseArtifactsDir = resolve(projectRoot, ".release-artifacts");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const yes = args.includes("--yes");
const requestedVersion = args.find((arg) => !arg.startsWith("--"));

if (!requestedVersion) {
  fail("Usage: npm run release -- <patch|minor|major|x.y.z> [--yes] [--dry-run]");
}

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const version = resolveVersion(packageJson.version, requestedVersion);
const tag = `v${version}`;
const packageLockPath = resolve(projectRoot, "package-lock.json");
const originalPackageJson = await readFile(packageJsonPath);
const originalPackageLock = await readFile(packageLockPath);

await requireCommand("git", ["--version"]);
await requireCommand("npm", ["--version"]);
await requireCommand("gh", ["--version"]);

if (dryRun) {
  await assertReleasePreconditions(tag, false);
  console.log(`[dry-run] Would release ${packageJson.name}@${version}`);
  console.log(`[dry-run] Would run tests and smoke checks, publish npm, commit ${tag}, push main and ${tag}, then create a GitHub release.`);
  process.exit(0);
}

await assertReleasePreconditions(tag, true);
if (!yes) {
  const readline = createInterface({ input, output });
  const answer = await readline.question(`Release ${packageJson.name}@${version} to npm and GitHub? [y/N] `);
  readline.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    fail("Release cancelled.");
  }
}

let packagePublished = false;

try {
  await run("npm", ["version", version, "--no-git-tag-version"]);
  await run("npm", ["test"]);
  await run("npm", ["run", "smoke"]);
  await mkdir(releaseArtifactsDir, { recursive: true });
  await run("npm", ["pack", "--pack-destination", releaseArtifactsDir]);
  const packageFiles = (await readdir(releaseArtifactsDir)).filter((file) => file.endsWith(".tgz"));
  if (packageFiles.length !== 1) {
    fail("npm pack did not return a package filename.");
  }
  const packageFile = packageFiles[0];

  await run("npm", ["publish", resolve(releaseArtifactsDir, packageFile), "--access", "public"]);
  packagePublished = true;
  await run("git", ["add", "package.json", "package-lock.json"]);
  await run("git", ["commit", "-m", `chore: release ${tag}`]);
  await run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);
  await run("git", ["push", "origin", "HEAD:main"]);
  await run("git", ["push", "origin", tag]);
  await run("gh", ["release", "create", tag, resolve(releaseArtifactsDir, packageFile), "--verify-tag", "--generate-notes", "--latest", "--title", `Bestie ${tag}`]);
  console.log(`Released ${packageJson.name}@${version} to npm and GitHub.`);
} catch (error) {
  if (!packagePublished) {
    await writeFile(packageJsonPath, originalPackageJson);
    await writeFile(packageLockPath, originalPackageLock);
    console.error("Release did not publish; restored package version files.");
  }
  throw error;
} finally {
  await rm(releaseArtifactsDir, { recursive: true, force: true });
}

async function assertReleasePreconditions(releaseTag, requireCleanWorktree) {
  if (requireCleanWorktree) {
    const status = await run("git", ["status", "--porcelain"], { captureOutput: true });
    if (status.stdout.trim()) {
      fail("Working tree is not clean. Commit or stash changes before releasing.");
    }
  }

  const branch = await run("git", ["branch", "--show-current"], { captureOutput: true });
  if (branch.stdout.trim() !== "main") {
    fail(`Release must run from main; current branch is ${branch.stdout.trim() || "detached HEAD"}.`);
  }

  const localTag = await run("git", ["rev-parse", "--verify", `refs/tags/${releaseTag}`], { captureOutput: true, allowFailure: true });
  if (localTag.code === 0) {
    fail(`Tag ${releaseTag} already exists locally.`);
  }

  const remoteTag = await run("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${releaseTag}`], { captureOutput: true, allowFailure: true });
  if (remoteTag.code === 0) {
    fail(`Tag ${releaseTag} already exists on origin.`);
  }

  await run("gh", ["auth", "status"]);
}

function resolveVersion(currentVersion, requested) {
  if (["patch", "minor", "major"].includes(requested)) {
    const [major, minor, patch] = currentVersion.split(".").map(Number);
    if (![major, minor, patch].every(Number.isInteger)) fail(`Cannot increment invalid current version ${currentVersion}.`);
    if (requested === "major") return `${major + 1}.0.0`;
    if (requested === "minor") return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
  }

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(requested)) {
    fail(`Invalid version: ${requested}`);
  }
  return requested;
}

async function requireCommand(command, commandArgs) {
  await run(command, commandArgs);
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const isWindowsNpm = process.platform === "win32" && command === "npm";
    const executable = isWindowsNpm ? process.env.ComSpec ?? "cmd.exe" : process.platform === "win32" ? windowsExecutable(command) : command;
    const executableArgs = isWindowsNpm
      ? ["/d", "/s", "/c", `npm ${commandArgs.map(quoteWindowsArgument).join(" ")}`]
      : commandArgs;
    const child = spawn(executable, executableArgs, { cwd: projectRoot, stdio: options.captureOutput ? ["inherit", "pipe", "pipe"] : "inherit" });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code !== 0 && !options.allowFailure) {
        reject(new Error(`Command failed: ${command} ${commandArgs.join(" ")}`));
        return;
      }
      resolvePromise(result);
    });
  });
}

function windowsExecutable(command) {
  if (command === "git") return "git.exe";
  if (command === "gh") return "gh.exe";
  return command;
}

function quoteWindowsArgument(argument) {
  const value = String(argument).replaceAll('"', '""');
  return /[\s"]/.test(value) ? `"${value}"` : value;
}

function fail(message) {
  console.error(`Release failed: ${message}`);
  process.exit(1);
}
