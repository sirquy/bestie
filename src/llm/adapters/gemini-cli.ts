import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { ProviderAuthError, ProviderNetworkError, ProviderResponseError, ProviderTimeoutError } from "../errors.js";
import type { ChatCompletionOptions, ChatMessage, ChatMessageContent } from "../types.js";
import type { ProviderAdapter } from "./types.js";

export type GeminiCliSpawn = typeof spawn;

export interface GeminiCliRunOptions {
  command?: string;
  commandArgs?: string[];
  cwd?: string;
  timeoutMs: number;
  spawnImpl?: GeminiCliSpawn;
  model?: string;
}

interface GeminiCliResult {
  response?: string;
  error?: string;
  status?: string;
  message?: string;
}

export const geminiCliAdapter: ProviderAdapter = {
  metadata: {
    id: "gemini-cli",
    displayName: "Gemini CLI",
    authModes: ["local"],
    supportsStreaming: false,
    supportsVision: false,
    supportsToolCalls: false,
  },
  async send(candidate, _apiKey, options, context) {
    const text = await runGeminiCliCompletion(options, {
      timeoutMs: context.timeoutMs,
      cwd: context.paths?.workspaceDir,
      model: candidate.model,
    });
    options.onToken?.(text);
    return text;
  },
};

export async function runGeminiCliCompletion(options: ChatCompletionOptions, runOptions: GeminiCliRunOptions): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "bestie-gemini-cli-"));
  const promptPath = join(tempDir, "prompt.txt");

  try {
    const prompt = buildGeminiCliPrompt(options.messages);
    if (runOptions.cwd) {
      await mkdir(runOptions.cwd, { recursive: true });
    }
    await writeFile(promptPath, prompt, "utf8");
    const processResult = await runGeminiCliProcess(buildGeminiCliArgs({ model: runOptions.model }), prompt, runOptions);
    return parseGeminiCliOutput(processResult.stdout, processResult.stderr, processResult.code);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function buildGeminiCliArgs(options: { model?: string } = {}): string[] {
  return [
    "--skip-trust",
    "--prompt=",
    "--output-format",
    "json",
    "--approval-mode",
    "plan",
    ...(options.model && options.model !== "default" ? ["--model", options.model] : []),
  ];
}

export function buildGeminiCliPrompt(messages: ChatMessage[]): string {
  const rendered = messages.map((message) => renderGeminiCliMessage(message)).join("\n\n");
  return `${rendered}\n\nRespond only with the assistant's final message for Bestie. Do not edit files, run commands, call tools, or ask for approval.`;
}

export function parseGeminiCliOutput(stdout: string, stderr: string, code: number | null): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    if (code !== 0) {
      throw classifyGeminiCliFailure(formatGeminiCliFailure(code, stdout, stderr));
    }
    throw new ProviderResponseError("Gemini CLI returned an empty response.");
  }

  let parsed: GeminiCliResult;
  try {
    parsed = JSON.parse(trimmed) as GeminiCliResult;
  } catch {
    if (code !== 0) {
      throw classifyGeminiCliFailure(formatGeminiCliFailure(code, stdout, stderr));
    }
    throw new ProviderResponseError("Gemini CLI response was not valid JSON.");
  }

  const response = typeof parsed.response === "string" ? parsed.response.trim() : "";
  if (code !== 0) {
    throw classifyGeminiCliFailure(parsed.error || parsed.message || formatGeminiCliFailure(code, stdout, stderr));
  }

  if (!response) {
    throw new ProviderResponseError(parsed.error || parsed.message || "Gemini CLI returned an empty final message.");
  }

  return response;
}

async function runGeminiCliProcess(args: string[], prompt: string, options: GeminiCliRunOptions): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const commandSpec = resolveGeminiCliCommand(options);
  const spawnImpl = options.spawnImpl ?? spawn;
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawnImpl(commandSpec.command, [...commandSpec.argsPrefix, ...args], {
      cwd: options.cwd,
      shell: commandSpec.shell,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    throw new ProviderNetworkError(error instanceof Error ? error.message : "Failed to spawn Gemini CLI.");
  }

  child.stdin.end(prompt);
  return waitForGeminiCliChild(child, options.timeoutMs);
}

function waitForGeminiCliChild(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      reject(new ProviderTimeoutError(timeoutMs));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(new ProviderNetworkError(error.message));
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ stdout, stderr, code });
    });
  });
}

function renderGeminiCliMessage(message: ChatMessage): string {
  return `<${message.role}>\n${renderGeminiCliContent(message.content)}\n</${message.role}>`;
}

function renderGeminiCliContent(content: ChatMessageContent): string {
  if (typeof content === "string") {
    return content;
  }
  return content.map((part) => part.type === "text" ? part.text : `[image omitted: ${part.image_url.url.slice(0, 80)}]`).join("\n");
}

function classifyGeminiCliFailure(message: string): ProviderAuthError | ProviderResponseError {
  const normalized = message.toLowerCase();
  if (normalized.includes("not authenticated")
    || normalized.includes("not logged in")
    || normalized.includes("login")
    || normalized.includes("api key")
    || normalized.includes("gemini_api_key")
    || normalized.includes("google_api_key")) {
    return new ProviderAuthError(message);
  }
  return new ProviderResponseError(message);
}

function formatGeminiCliFailure(code: number | null, stdout: string, stderr: string): string {
  const detail = [stderr, stdout].map((part) => part.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
  const clipped = detail.length > 320 ? `${detail.slice(0, 317)}...` : detail;
  return clipped ? `Gemini CLI exited with code ${code}: ${clipped}` : `Gemini CLI exited with code ${code}.`;
}

interface GeminiCliCommandSpec {
  command: string;
  argsPrefix: string[];
  shell: boolean;
}

function resolveGeminiCliCommand(options: GeminiCliRunOptions): GeminiCliCommandSpec {
  if (options.command) {
    return { command: options.command, argsPrefix: options.commandArgs ?? [], shell: false };
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    const npmGeminiEntry = appData ? join(appData, "npm", "node_modules", "@google", "gemini-cli", "bundle", "gemini.js") : undefined;
    if (npmGeminiEntry && existsSync(npmGeminiEntry)) {
      return { command: process.execPath, argsPrefix: [npmGeminiEntry], shell: false };
    }
    return { command: "gemini.cmd", argsPrefix: [], shell: true };
  }

  return { command: "gemini", argsPrefix: [], shell: false };
}
