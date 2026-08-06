import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { ProviderAuthError, ProviderNetworkError, ProviderResponseError, ProviderTimeoutError } from "../errors.js";
import type { ChatCompletionOptions, ChatMessage, ChatMessageContent } from "../types.js";
import type { ProviderAdapter } from "./types.js";

export type ClaudeCliSpawn = typeof spawn;

export interface ClaudeCliRunOptions {
  command?: string;
  commandArgs?: string[];
  cwd?: string;
  timeoutMs: number;
  spawnImpl?: ClaudeCliSpawn;
  model?: string;
}

interface ClaudeCliResult {
  type?: string;
  result?: string;
  is_error?: boolean;
  terminal_reason?: string;
  api_error_status?: number | null;
}

export const claudeCliAdapter: ProviderAdapter = {
  metadata: {
    id: "claude-cli",
    displayName: "Claude CLI",
    authModes: ["local"],
    supportsStreaming: false,
    supportsVision: false,
    supportsToolCalls: false,
  },
  async send(candidate, _apiKey, options, context) {
    const text = await runClaudeCliCompletion(options, {
      timeoutMs: context.timeoutMs,
      cwd: context.paths?.workspaceDir,
      model: candidate.model,
    });
    options.onToken?.(text);
    return text;
  },
};

export async function runClaudeCliCompletion(options: ChatCompletionOptions, runOptions: ClaudeCliRunOptions): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "bestie-claude-cli-"));
  const promptPath = join(tempDir, "prompt.txt");

  try {
    const promptParts = buildClaudeCliPromptParts(options.messages);
    if (runOptions.cwd) {
      await mkdir(runOptions.cwd, { recursive: true });
    }
    await writeFile(promptPath, promptParts.prompt, "utf8");
    const processResult = await runClaudeCliProcess(buildClaudeCliArgs({ model: runOptions.model, systemPrompt: promptParts.systemPrompt }), promptParts.prompt, runOptions);
    return parseClaudeCliOutput(processResult.stdout, processResult.stderr, processResult.code);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function buildClaudeCliArgs(options: { model?: string; systemPrompt?: string }): string[] {
  return [
    "--safe-mode",
    "--print",
    "--output-format",
    "json",
    "--permission-mode",
    "dontAsk",
    "--tools=",
    ...(options.model && options.model !== "default" ? ["--model", options.model] : []),
    ...(options.systemPrompt ? ["--system-prompt", options.systemPrompt] : []),
  ];
}

export function buildClaudeCliPromptParts(messages: ChatMessage[]): { systemPrompt?: string; prompt: string } {
  const systemPrompt = messages
    .filter((message) => message.role === "system")
    .map((message) => renderClaudeCliContent(message.content))
    .join("\n\n")
    .trim();
  const prompt = messages
    .filter((message) => message.role !== "system")
    .map((message) => renderClaudeCliMessage(message))
    .join("\n\n")
    .trim();
  const finalPrompt = `${prompt || "<user>\nContinue.\n</user>"}\n\nRespond only with the assistant's final message for Bestie. Do not edit files, run commands, call tools, or ask for approval.`;

  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    prompt: finalPrompt,
  };
}

export function parseClaudeCliOutput(stdout: string, stderr: string, code: number | null): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    if (code !== 0) {
      throw new ProviderResponseError(formatClaudeCliFailure(code, stdout, stderr));
    }
    throw new ProviderResponseError("Claude CLI returned an empty response.");
  }

  let parsed: ClaudeCliResult;
  try {
    parsed = JSON.parse(trimmed) as ClaudeCliResult;
  } catch {
    if (code !== 0) {
      throw new ProviderResponseError(formatClaudeCliFailure(code, stdout, stderr));
    }
    throw new ProviderResponseError("Claude CLI response was not valid JSON.");
  }

  const result = typeof parsed.result === "string" ? parsed.result.trim() : "";
  if (parsed.is_error) {
    if (isClaudeCliAuthError(result, parsed)) {
      throw new ProviderAuthError(result || "Claude CLI is not authenticated.");
    }
    throw new ProviderResponseError(result || `Claude CLI returned an error (${parsed.terminal_reason ?? "unknown"}).`, parsed.api_error_status ?? undefined);
  }

  if (code !== 0) {
    throw new ProviderResponseError(formatClaudeCliFailure(code, stdout, stderr));
  }

  if (!result) {
    throw new ProviderResponseError("Claude CLI returned an empty final message.");
  }

  return result;
}

async function runClaudeCliProcess(args: string[], prompt: string, options: ClaudeCliRunOptions): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const commandSpec = resolveClaudeCliCommand(options);
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
    throw new ProviderNetworkError(error instanceof Error ? error.message : "Failed to spawn Claude CLI.");
  }

  child.stdin.end(prompt);
  return waitForClaudeCliChild(child, options.timeoutMs);
}

function waitForClaudeCliChild(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number | null }> {
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

function renderClaudeCliMessage(message: Exclude<ChatMessage, { role: "system" }>): string {
  return `<${message.role}>\n${renderClaudeCliContent(message.content)}\n</${message.role}>`;
}

function renderClaudeCliContent(content: ChatMessageContent): string {
  if (typeof content === "string") {
    return content;
  }
  return content.map((part) => part.type === "text" ? part.text : `[image omitted: ${part.image_url.url.slice(0, 80)}]`).join("\n");
}

function isClaudeCliAuthError(result: string, parsed: ClaudeCliResult): boolean {
  const normalized = result.toLowerCase();
  return normalized.includes("not logged in")
    || normalized.includes("please run /login")
    || normalized.includes("authentication")
    || normalized.includes("api key")
    || normalized.includes("anthropic_api_key");
}

function formatClaudeCliFailure(code: number | null, stdout: string, stderr: string): string {
  const detail = [stderr, stdout].map((part) => part.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
  const clipped = detail.length > 320 ? `${detail.slice(0, 317)}...` : detail;
  return clipped ? `Claude CLI exited with code ${code}: ${clipped}` : `Claude CLI exited with code ${code}.`;
}

interface ClaudeCliCommandSpec {
  command: string;
  argsPrefix: string[];
  shell: boolean;
}

function resolveClaudeCliCommand(options: ClaudeCliRunOptions): ClaudeCliCommandSpec {
  if (options.command) {
    return { command: options.command, argsPrefix: options.commandArgs ?? [], shell: false };
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    const npmClaudeEntry = appData ? join(appData, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe") : undefined;
    if (npmClaudeEntry && existsSync(npmClaudeEntry)) {
      return { command: npmClaudeEntry, argsPrefix: [], shell: false };
    }
    return { command: "claude.cmd", argsPrefix: [], shell: true };
  }

  return { command: "claude", argsPrefix: [], shell: false };
}
