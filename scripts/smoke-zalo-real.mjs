import { access, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

import { parseZaloSmokeTranscript, validateZaloSmokeTranscript } from "../dist/channels/zalo-smoke-transcript.js";

const projectRoot = process.env.INIT_CWD ?? process.cwd();
const cliPath = resolve(projectRoot, "dist/cli/index.js");
const transcriptPath = ".bestie/logs/zalo-smoke.jsonl";
const runtimeRoot = homedir();
const fullTranscriptPath = resolve(runtimeRoot, transcriptPath);

if (process.env.BESTIE_ZALO_REAL_SMOKE !== "1") {
  console.error("Real Zalo smoke is opt-in because it calls Zalo and your configured LLM provider.");
  console.error('Send a fresh owner text message to the bot, for example: "ping".');
  console.error("Then set BESTIE_ZALO_REAL_SMOKE=1 and retry:");
  console.error("  BESTIE_ZALO_REAL_SMOKE=1 npm run smoke:zalo:real");
  process.exit(2);
}

await ensureReadable(resolve(runtimeRoot, ".bestie/config.json"), "Run `npm run dev -- zalo setup` first.");
await ensureReadable(resolve(runtimeRoot, ".bestie/.env"), "Add Zalo and LLM secrets to .bestie/.env first.");
await rm(fullTranscriptPath, { force: true });

await runCli(["zalo", "--once", "--transcript", transcriptPath]);

const transcript = await readFile(fullTranscriptPath, "utf8");
const summary = validateZaloSmokeTranscript(parseZaloSmokeTranscript(transcript));
console.log(
  `Zalo real smoke passed: ${summary.updates} update(s), ${summary.ownerUpdates} owner update(s), ${summary.replies} reply event(s), ${summary.outboundMessages} outbound message(s), ${summary.progressMessages} progress message(s), ${summary.attachmentUpdates} attachment-like update(s).`,
);
console.log(`Transcript: ${fullTranscriptPath}`);

async function ensureReadable(path, hint) {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(`Missing required file: ${path}. ${hint}`);
  }
}

async function runCli(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out: ${args.join(" ")}`));
    }, 35_000);

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
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        reject(new Error(`Command failed (${code}): ${args.join(" ")}\n${stdout}${stderr}`));
      }
    });
  });
}