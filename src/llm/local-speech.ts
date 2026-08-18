import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { DEFAULT_LLM_TIMEOUT_MS, type AppConfig } from "../runtime/config.js";
import { ProviderNetworkError, ProviderResponseError, ProviderTimeoutError } from "./errors.js";

const DEFAULT_LOCAL_SPEECH_ARGS = ["--model", "{modelPath}", "--output_file", "{outputPath}"];

export async function createLocalSpeech(config: AppConfig, text: string, options: { rootDir?: string } = {}): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const speech = config.speech;
  if (!speech || speech.provider !== "local-command") {
    throw new ProviderResponseError("local speech provider is not configured.");
  }

  const trimmedText = text.trim();
  if (!trimmedText) throw new ProviderResponseError("speech input is empty.");
  const tempDir = await mkdtemp(resolve(tmpdir(), "bestie-speech-"));
  const outputPath = resolve(tempDir, "speech.wav");
  const modelPath = speech.modelPath === undefined ? "" : resolveLocalRuntimePath(speech.modelPath, options.rootDir);
  const args = (speech.args ?? DEFAULT_LOCAL_SPEECH_ARGS)
    .map((argument) => argument.replaceAll("{modelPath}", modelPath).replaceAll("{outputPath}", outputPath))
    .map((argument) => resolveLocalRuntimeArgument(argument, options.rootDir));

  try {
    await execLocalSpeech(resolveLocalRuntimePath(speech.command, options.rootDir), args, trimmedText, speech.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS, speech.env);
    const bytes = await readFile(outputPath);
    if (bytes.byteLength === 0) throw new ProviderResponseError("local speech command produced empty audio.");
    return { bytes, mimeType: "audio/wav" };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function execLocalSpeech(command: string, args: string[], text: string, timeoutMs: number, env: Record<string, string> | undefined): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024, env: env ? { ...process.env, ...env } : undefined }, (error, _stdout, stderr) => {
      if (!error) {
        resolvePromise();
        return;
      }
      if (isTimeoutError(error)) {
        reject(new ProviderTimeoutError(timeoutMs));
        return;
      }
      reject(new ProviderNetworkError(`Local speech command failed: ${stderr.trim() || error.message}`));
    });
    child.stdin?.end(text);
  });
}

function resolveLocalRuntimePath(value: string, rootDir: string | undefined): string {
  return rootDir && !isAbsolute(value) ? resolve(rootDir, value) : value;
}

function resolveLocalRuntimeArgument(value: string, rootDir: string | undefined): string {
  if (!rootDir || isAbsolute(value) || !/^(?:\.{1,2}[\\/]|[^\\/]+[\\/])/.test(value)) return value;
  return resolve(rootDir, value);
}

function isTimeoutError(error: Error & { killed?: boolean; signal?: string | null }): boolean {
  return error.killed === true || error.signal === "SIGTERM" || error.message.toLowerCase().includes("timed out");
}
