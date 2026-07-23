import { stdout as output } from "node:process";

import { runKnowledgeReasoningPass } from "../memory/knowledge-reasoning.js";
import { runMemoryReasoningPass } from "../memory/reasoning.js";
import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import { createCliPermissionApprover } from "../cli/permission-approver.js";
import type { AppConfig } from "../runtime/config.js";
import { appendLog } from "../runtime/logger.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { sendChatCompletionWithFallbacks } from "../llm/chat-completion.js";
import { fallbackLogDetail, formatProviderFallbackDiagnostics, formatProviderFallbackHealth } from "../llm/fallbacks.js";
import { loadLlmCandidateSecret, resolvePrimaryLlmCandidate } from "../llm/resolve-config.js";
import type { ChatCompletionOptions, ChatMessage } from "../llm/types.js";
import { createCliQuestioner } from "../cli/prompt.js";
import { badge, bold, color, dim, rule } from "../cli/ui.js";
import { appendConversationTurn, buildChatMessages } from "./message-builder.js";
import { buildMcpToolSystemPrompt, completeWithAgentTools, runAgentToolRequest, type AgentToolActivity, type RunAgentToolRequestOptions } from "./mcp-tool-use.js";

export interface TerminalChatOptions {
  config: AppConfig;
  systemPrompt: string;
  paths: RuntimePaths;
  agentName?: string;
  ownerName?: string;
  questioner?: Questioner;
  chatCompletion?: ChatCompletionRunner;
  mcpToolRunner?: McpToolRunner;
  writeLine?: (message: string) => void;
  writeChunk?: (message: string) => void;
}

export interface Questioner {
  ask: (question: string) => Promise<string | undefined>;
  confirm?: (question: string, defaultValue?: boolean) => Promise<boolean>;
  close: () => void;
}

export type ChatCompletionRunner = (config: AppConfig, apiKey: string, options: ChatCompletionOptions) => Promise<string>;
export type McpToolRunner = (options: RunAgentToolRequestOptions) => Promise<{ ok: boolean; status: "pass" | "warn" | "fail"; message: string; result?: unknown }>;

export async function runTerminalChat(options: TerminalChatOptions): Promise<void> {
  const questioner = options.questioner ?? createQuestioner();
  const writeLine = options.writeLine ?? console.log;
  const writeChunk = options.writeChunk ?? ((message) => output.write(message));
  const chatCompletion = options.chatCompletion ?? ((config, _apiKeyValue, requestOptions) => sendChatCompletionWithFallbacks(config, { ...requestOptions, stream: requestOptions.stream ?? true }, { paths: options.paths }));
  const mcpToolRunner = options.mcpToolRunner ?? runAgentToolRequest;
  const approver = await createCliPermissionApprover({
    writeLine,
    questioner: {
      ask: async (question) => (await questioner.ask(question)) ?? "",
      confirm: questioner.confirm,
      close: () => undefined,
    },
  });
  let apiKey: string | undefined;
  let recentTurns: ChatMessage[] = [];

  await appendLog({ event: "command_start", detail: { command: "chat" } }, { paths: options.paths });
  printChatHeader(options, writeLine);

  try {
    while (true) {
      const answer = await questioner.ask(formatPrompt(options.ownerName));

      if (answer === undefined) {
        return;
      }

      const userInput = answer.trim();

      if (!userInput) {
        continue;
      }

      if (userInput === "/exit") {
        writeLine("Bye.");
        return;
      }

      const handledSlashCommand = await handleSlashCommand(userInput, options.paths, writeLine);

      if (handledSlashCommand) {
        continue;
      }

      try {
        apiKey ??= await loadLlmCandidateSecret(resolvePrimaryLlmCandidate(options.config), options.paths);
        const memories = await loadActiveMemories(options.paths);
        const knowledgeGraph = await loadRelevantKnowledgeGraph(options.paths, userInput);
        const messages = buildChatMessages(buildTerminalSystemPrompt(options.systemPrompt, options.config), recentTurns, userInput, memories, { memoryRetrievalPolicy: options.config.memory?.retrievalPolicy ?? "full", knowledgeGraph });
        const indicator = startChatIndicator(options.agentName);
        let assistantText: string;
        const writeChatLine = (message: string) => {
          indicator.clear();
          writeLine(message);
        };
        const streamedAnswer = createTerminalAnswerStreamer(options.agentName, indicator, writeLine, writeChunk);

        try {
          assistantText = await completeWithAgentTools({
            config: options.config,
            paths: options.paths,
            apiKey,
            messages,
            chatCompletion,
            toolRunner: mcpToolRunner,
            approver,
            streamFinalResponse: false,
            onToken: (token) => streamedAnswer.write(token),
            onToolActivity: (activity) => printTerminalToolActivity(options.agentName, activity, writeChatLine),
          });
        } finally {
          indicator.stop();
        }

        if (streamedAnswer.didStream()) {
          streamedAnswer.finish();
        } else {
          writeChatLine(formatAssistantMessage(options.agentName, assistantText));
        }
        await persistConversationTurn(options.paths, userInput, assistantText);
        await runTerminalMemoryReasoningPass({
          config: options.config,
          paths: options.paths,
          apiKey,
          turn: { channel: "terminal", userInput, assistantText },
          chatCompletion,
        });
        await runTerminalKnowledgeReasoningPass({
          config: options.config,
          paths: options.paths,
          apiKey,
          turn: { channel: "terminal", userInput, assistantText },
          chatCompletion,
        });
        if (!(await isMemoryPaused(options.paths))) {
          recentTurns = appendConversationTurn(recentTurns, userInput, assistantText);
        }
        await appendLog({ event: "chat_request_success", detail: { model: options.config.llm.primary } }, { paths: options.paths });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown chat error.";
        await appendLog({ event: "chat_request_failure", detail: { message, ...fallbackLogDetail(error) } }, { paths: options.paths, knownSecrets: apiKey ? [apiKey] : [] });
        writeLine(formatErrorMessage(message));
      }
    }
  } finally {
    questioner.close();
  }
}


async function runTerminalMemoryReasoningPass(options: Parameters<typeof runMemoryReasoningPass>[0]): Promise<void> {
  try {
    await runMemoryReasoningPass(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown memory reasoning error.";
    await appendLog({ event: "memory_reasoning_failure", detail: { channel: "terminal", message } }, { paths: options.paths, knownSecrets: [options.apiKey] });
  }
}

async function runTerminalKnowledgeReasoningPass(options: Parameters<typeof runKnowledgeReasoningPass>[0]): Promise<void> {
  try {
    await runKnowledgeReasoningPass(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown knowledge reasoning error.";
    await appendLog({ event: "knowledge_reasoning_failure", detail: { channel: "terminal", message } }, { paths: options.paths, knownSecrets: [options.apiKey] });
  }
}

export function buildTerminalSystemPrompt(systemPrompt: string, config: AppConfig): string {
  return buildMcpToolSystemPrompt(systemPrompt, config);
}
function printChatHeader(options: TerminalChatOptions, writeLine: (message: string) => void = console.log): void {
  const agentName = options.agentName ?? options.config.agent.name;
  const ownerName = options.ownerName ?? options.config.agent.ownerName;
  writeLine(`${bold(color("magenta", "Bestie chat"))} ${dim("local terminal session")}`);
  writeLine(`${dim("Runtime")} ${options.paths.appDir}`);
  writeLine(`${dim("Model")} ${options.config.llm.primary}`);
  writeLine(`${badge("BOT", "cyan")} ${bold(agentName)} ${dim("with")} ${badge("YOU", "green")} ${bold(ownerName)}`);
  writeLine(`${dim("Commands")} /help  /status  /providers  /memory  /pending  /exit`);
  writeLine(rule(28));
}

export function formatPrompt(ownerName?: string): string {
  const label = ownerName ? `${ownerName}` : "you";
  return `${badge("YOU", "green")} ${label} ${dim(">")} `;
}

export function formatAssistantMessage(agentName: string | undefined, message: string): string {
  const label = agentName ?? "bestie";
  return `${badge("BOT", "cyan")} ${label} ${dim(">")} ${message}`;
}

export function formatErrorMessage(message: string): string {
  return `${badge("FAIL", "red")} ${message}`;
}

function startChatIndicator(agentName: string | undefined): { clear: () => void; stop: () => void } {
  if (!output.isTTY) {
    return { clear: () => undefined, stop: () => undefined };
  }

  const label = agentName ?? "bestie";
  const frames = [".", "..", "..."];
  let frame = 0;

  const render = () => {
    output.write(`\r${badge("BOT", "yellow")} ${label} ${dim("thinking")}${frames[frame % frames.length]}   `);
    frame += 1;
  };

  render();
  const timer = setInterval(render, 220);

  return {
    clear: () => {
      output.write("\r\x1b[2K");
    },
    stop: () => {
      clearInterval(timer);
      output.write("\r\x1b[2K");
    },
  };
}

function printTerminalToolActivity(agentName: string | undefined, activity: AgentToolActivity, writeLine: (message: string) => void): void {
  if (activity.phase !== "start") {
    return;
  }

  writeLine(formatAssistantMessage(agentName, `${badge("TOOL", "yellow")} ${activity.toolName} ${dim(activity.label)}`));
}

function createTerminalAnswerStreamer(
  agentName: string | undefined,
  indicator: { clear: () => void },
  writeLine: (message: string) => void,
  writeChunk: (message: string) => void,
): { write: (token: string) => void; didStream: () => boolean; finish: () => void } {
  let started = false;
  let ended = false;

  return {
    write: (token) => {
      if (!token) {
        return;
      }

      if (!started) {
        indicator.clear();
        writeChunk(formatAssistantMessage(agentName, ""));
        started = true;
      }

      writeChunk(token);
    },
    didStream: () => started,
    finish: () => {
      if (!started || ended) {
        return;
      }

      writeLine("");
      ended = true;
    },
  };
}

async function handleSlashCommand(userInput: string, paths: RuntimePaths, writeLine: (message: string) => void): Promise<boolean> {
  if (!userInput.startsWith("/")) {
    return false;
  }

  if (userInput === "/help") {
    writeLine("Commands: /help, /status, /providers, /memory, /memory pause, /memory resume, /pending, /exit");
    return true;
  }

  if (userInput === "/providers") {
    writeLine(await formatProviderFallbackDiagnostics(paths));
    return true;
  }

  if (userInput === "/status") {
    const store = await SqliteMemoryStore.open(paths);

    try {
      const state = store.getMemoryState();
      const activeCount = store.listActiveMemories().length;
      const pendingCount = store.listPendingMemories().length;
      const providerHealth = await formatProviderFallbackHealth(paths);
      writeLine([`Status -> memory ${state.paused ? "paused" : "active"}; active ${activeCount}; pending ${pendingCount}`, providerHealth].filter(Boolean).join("; "));
    } finally {
      store.close();
    }

    return true;
  }

  if (userInput === "/memory pause" || userInput === "/memory resume") {
    const paused = userInput === "/memory pause";
    const store = await SqliteMemoryStore.open(paths);

    try {
      store.setMemoryPaused(paused);
      writeLine(`Memory ${paused ? "paused" : "resumed"}.`);
    } finally {
      store.close();
    }

    return true;
  }

  if (userInput === "/memory") {
    const store = await SqliteMemoryStore.open(paths);

    try {
      const memories = store.listActiveMemories();

      if (memories.length === 0) {
        writeLine("No active memories.");
        return true;
      }

      writeLine(`Active memories (${memories.length}):`);
      for (const memory of memories) {
        writeLine(`${memory.id}. [${memory.type}] ${memory.content}`);
      }
    } finally {
      store.close();
    }

    return true;
  }

  if (userInput === "/pending") {
    const store = await SqliteMemoryStore.open(paths);

    try {
      const memories = store.listPendingMemories(5);

      if (memories.length === 0) {
        writeLine("No pending memories.");
        return true;
      }

      writeLine("Pending memories:");
      for (const memory of memories) {
        writeLine(`${memory.id}. [${memory.type}] ${memory.content}`);
      }
    } finally {
      store.close();
    }

    return true;
  }

  writeLine(`Unknown command: ${userInput}. Try /help.`);
  return true;
}

function createQuestioner(): Questioner {
  return createCliQuestioner({ echoAnswer: true, returnUndefinedOnInputEnd: true });
}

async function loadActiveMemories(paths: RuntimePaths): Promise<import("../memory/sqlite-store.js").StoredMemory[]> {
  const store = await SqliteMemoryStore.open(paths);

  try {
    if (store.getMemoryState().paused) {
      return [];
    }

    return store.listActiveMemories();
  } finally {
    store.close();
  }
}

async function loadRelevantKnowledgeGraph(paths: RuntimePaths, query: string): Promise<import("../memory/sqlite-store.js").KnowledgeGraphSearchResult | undefined> {
  const store = await SqliteMemoryStore.open(paths);

  try {
    if (store.getMemoryState().paused) {
      return undefined;
    }

    const graph = store.searchKnowledgeGraph(query, 12);
    return graph.entities.length === 0 && graph.relations.length === 0 ? undefined : graph;
  } finally {
    store.close();
  }
}

async function isMemoryPaused(paths: RuntimePaths): Promise<boolean> {
  const store = await SqliteMemoryStore.open(paths);

  try {
    return store.getMemoryState().paused;
  } finally {
    store.close();
  }
}
async function persistConversationTurn(paths: RuntimePaths, userInput: string, assistantText: string): Promise<void> {
  const store = await SqliteMemoryStore.open(paths);

  try {
    if (store.getMemoryState().paused) {
      return;
    }

    store.addMessage({ channel: "terminal", role: "user", content: userInput });
    store.addMessage({ channel: "terminal", role: "assistant", content: assistantText });
  } finally {
    store.close();
  }
}
