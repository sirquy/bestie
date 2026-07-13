import { execFile } from "node:child_process";

import { DEFAULT_LLM_TIMEOUT_MS, type AppConfig } from "../runtime/config.js";
import { ProviderNetworkError, ProviderResponseError, ProviderTimeoutError } from "./errors.js";

export interface LocalAudioTranscriptionInput {
  localPath: string;
}

const DEFAULT_LOCAL_WHISPER_ARGS = ["-m", "{modelPath}", "-f", "{audioPath}", "-nt"];
const MAX_TRANSCRIPTION_STDOUT_BYTES = 1024 * 1024;

export async function createLocalAudioTranscription(config: AppConfig, input: LocalAudioTranscriptionInput): Promise<string> {
  const transcription = config.transcription;
  if (!transcription || transcription.provider !== "local-whisper") {
    throw new ProviderResponseError("local transcription provider is not configured.");
  }

  const args = buildLocalWhisperArgs(transcription.args ?? DEFAULT_LOCAL_WHISPER_ARGS, {
    audioPath: input.localPath,
    modelPath: transcription.modelPath,
  });
  const stdout = await execLocalWhisper(transcription.command, args, transcription.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS);
  const text = extractLocalTranscriptionText(stdout);

  if (!text) {
    throw new ProviderResponseError("missing local transcription text.");
  }

  return text;
}

export function buildLocalWhisperArgs(args: string[], values: { audioPath: string; modelPath: string }): string[] {
  return args.map((arg) => arg.replaceAll("{audioPath}", values.audioPath).replaceAll("{modelPath}", values.modelPath));
}

function execLocalWhisper(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_TRANSCRIPTION_STDOUT_BYTES }, (error, stdout, stderr) => {
      if (error) {
        if (isTimeoutError(error)) {
          reject(new ProviderTimeoutError(timeoutMs));
          return;
        }

        reject(new ProviderNetworkError(formatLocalWhisperError(error, stderr)));
        return;
      }

      resolve(stdout);
    });
  });
}

function extractLocalTranscriptionText(stdout: string): string | undefined {
  const text = stdout.trim();
  return text.length > 0 ? text : undefined;
}

function isTimeoutError(error: Error & { killed?: boolean; signal?: string | null }): boolean {
  return error.killed === true || error.signal === "SIGTERM" || error.message.toLowerCase().includes("timed out");
}

function formatLocalWhisperError(error: Error, stderr: string): string {
  const detail = stderr.trim() || error.message;
  return `Local transcription command failed: ${detail}`;
}
