import { access, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

import { parseTelegramSmokeTranscript, validateTelegramSmokeTranscript } from "../dist/channels/telegram-smoke-transcript.js";

const projectRoot = process.env.INIT_CWD ?? process.cwd();
const cliPath = resolve(projectRoot, "dist/cli/index.js");
const transcriptPath = ".bestie/logs/telegram-smoke.jsonl";
const fullTranscriptPath = resolve(projectRoot, transcriptPath);

if (process.env.BESTIE_TELEGRAM_REAL_SMOKE !== "1") {
  console.error("Real Telegram smoke is opt-in because it calls Telegram and your configured LLM provider.");
  console.error('Send a fresh owner message that should trigger tools, for example: "đọc docs repo rồi summary".');
  console.error("To validate attachment parsing, send a small .txt, .pdf, or .docx file with a short caption before running the smoke.");
  console.error("Then set BESTIE_TELEGRAM_REAL_SMOKE=1 and retry:");
  console.error(`  BESTIE_TELEGRAM_REAL_SMOKE=1 npm run smoke:telegram:real`);
  process.exit(2);
}

await ensureReadable(resolve(projectRoot, ".bestie/config.json"), "Run `npm run dev -- telegram setup` first.");
await ensureReadable(resolve(projectRoot, ".bestie/.env"), "Add Telegram and LLM secrets to .bestie/.env first.");
await rm(fullTranscriptPath, { force: true });

await runCli(["telegram", "--once", "--transcript", transcriptPath]);

const transcript = await readFile(fullTranscriptPath, "utf8");
const summary = validateTelegramSmokeTranscript(parseTelegramSmokeTranscript(transcript));
console.log(
  `Telegram real smoke passed: ${summary.updates} update(s), ${summary.ownerUpdates} owner update(s), ${summary.replies} reply event(s), ${summary.outboundMessages} outbound message(s), ${summary.edits} edit(s), ${summary.progressMessages} progress message(s), ${summary.attachmentUpdates} attachment update(s), ${summary.downloadedFiles} downloaded file(s), ${summary.parsedAttachments} parsed attachment(s), ${summary.textPreviewAttachments} text preview(s), ${summary.parseWarningAttachments} parse warning(s), ${summary.visionInputAttachments} vision input(s), ${summary.audioTranscriptAttachments} audio transcript(s), ${summary.transcriptionWarningAttachments} transcription warning(s).`,
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
