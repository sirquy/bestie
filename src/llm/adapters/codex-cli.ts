import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { ProviderNetworkError, ProviderResponseError, ProviderTimeoutError } from "../errors.js";
import type { ChatCompletionOptions, ChatMessage, ChatMessageContent } from "../types.js";
import type { ProviderAdapter } from "./types.js";

export type CodexCliSpawn = typeof spawn;

export interface CodexCliRunOptions {
  command?: string;
  commandArgs?: string[];
  cwd?: string;
  timeoutMs: number;
  spawnImpl?: CodexCliSpawn;
  model?: string;
}

export const codexCliAdapter: ProviderAdapter = {
  metadata: {
    id: "codex-cli",
    displayName: "Codex CLI",
    authModes: ["local"],
    supportsStreaming: false,
    supportsVision: false,
    supportsToolCalls: false,
  },
  async send(candidate, _apiKey, options, context) {
    const text = await runCodexCliCompletion(options, {
      timeoutMs: context.timeoutMs,
      cwd: context.paths?.workspaceDir,
      model: candidate.model,
    });
    options.onToken?.(text);
    return text;
  },
};

export async function runCodexCliCompletion(options: ChatCompletionOptions, runOptions: CodexCliRunOptions): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "bestie-codex-cli-"));
  const promptPath = join(tempDir, "prompt.txt");
  const outputPath = join(tempDir, "last-message.txt");

  try {
    const prompt = buildCodexCliPrompt(options.messages);
    if (runOptions.cwd) {
      await mkdir(runOptions.cwd, { recursive: true });
    }
    await writeFile(promptPath, prompt, "utf8");
    await runCodexCliProcess(buildCodexCliArgs({ outputPath, model: runOptions.model }), prompt, runOptions);
    const output = (await readFile(outputPath, "utf8")).trim();
    if (!output) {
      throw new ProviderResponseError("Codex CLI returned an empty final message.");
    }
    return output;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function buildCodexCliArgs(options: { outputPath: string; model?: string }): string[] {
  return [
    "--ask-for-approval",
    "never",
    ...(options.model && options.model !== "default" ? ["--model", options.model] : []),
    "exec",
    "--json",
    "--color",
    "never",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-rules",
    "--output-last-message",
    options.outputPath,
    "-",
  ];
}

export function buildCodexCliPrompt(messages: ChatMessage[]): string {
  const rendered = messages.map((message) => renderCodexCliMessage(message)).join("\n\n");
  return `${rendered}\n\nRespond only with the assistant's final message for Bestie. Do not edit files, run commands, or ask for approval.`;
}

async function runCodexCliProcess(args: string[], prompt: string, options: CodexCliRunOptions): Promise<void> {
  const commandSpec = resolveCodexCliCommand(options);
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
    throw new ProviderNetworkError(error instanceof Error ? error.message : "Failed to spawn Codex CLI.");
  }

  child.stdin.end(prompt);
  await waitForCodexCliChild(child, options.timeoutMs);
}

function waitForCodexCliChild(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
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
      if (code === 0) {
        resolve();
        return;
      }
      reject(new ProviderResponseError(formatCodexCliFailure(code, stdout, stderr)));
    });
  });
}

function renderCodexCliMessage(message: ChatMessage): string {
  return `<${message.role}>\n${renderCodexCliContent(message.content)}\n</${message.role}>`;
}

function renderCodexCliContent(content: ChatMessageContent): string {
  if (typeof content === "string") {
    return content;
  }
  return content.map((part) => part.type === "text" ? part.text : `[image omitted: ${part.image_url.url.slice(0, 80)}]`).join("\n");
}

function formatCodexCliFailure(code: number | null, stdout: string, stderr: string): string {
  const detail = [stderr, stdout].map((part) => part.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
  const clipped = detail.length > 320 ? `${detail.slice(0, 317)}...` : detail;
  return clipped ? `Codex CLI exited with code ${code}: ${clipped}` : `Codex CLI exited with code ${code}.`;
}

interface CodexCliCommandSpec {
  command: string;
  argsPrefix: string[];
  shell: boolean;
}

function resolveCodexCliCommand(options: CodexCliRunOptions): CodexCliCommandSpec {
  if (options.command) {
    return { command: options.command, argsPrefix: options.commandArgs ?? [], shell: false };
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    const npmCodexEntry = appData ? join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js") : undefined;
    if (npmCodexEntry && existsSync(npmCodexEntry)) {
      return { command: process.execPath, argsPrefix: [npmCodexEntry], shell: false };
    }
    return { command: "codex.cmd", argsPrefix: [], shell: true };
  }

  return { command: "codex", argsPrefix: [], shell: false };
}
