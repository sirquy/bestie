import { stdout as output } from "node:process";

import { runKnowledgeReasoningPass } from "../memory/knowledge-reasoning.js";
import { loadConversationSummaryContext, refreshConversationSummary } from "../memory/conversation-summary.js";
import { loadRelevantMemories } from "../memory/context.js";
import { loadRelevantKnowledgeGraph } from "../memory/knowledge-context.js";
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
import { badge, dim } from "../cli/ui.js";
import { appendConversationTurn, buildChatMessages, getRecentMessageLimit } from "./message-builder.js";
import { buildMcpToolSystemPrompt, completeWithAgentTools, runAgentToolRequest, type AgentToolActivity, type RunAgentToolRequestOptions } from "./mcp-tool-use.js";
import { createTerminalChatInput } from "./terminal-chat-input.js";
import { formatTerminalAssistantMessage, formatTerminalAssistantStart, formatTerminalError, formatTerminalGoodbye, formatTerminalPrompt, formatTerminalThinking, formatTerminalToolActivity, renderTerminalChatHeader } from "./terminal-chat-ui.js";
import { terminalSlashCommands } from "./terminal-slash-commands.js";

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
  const chatInput = createTerminalChatInput({ askFallback: questioner.ask });
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
  const recentMessageLimit = getRecentMessageLimit(options.config);
  let recentTurns: ChatMessage[] = await loadRecentTerminalTurns(options.paths, recentMessageLimit);

  await appendLog({ event: "command_start", detail: { command: "chat" } }, { paths: options.paths });
  printChatHeader(options, writeLine);

  try {
    while (true) {
      const answer = await chatInput(formatPrompt(options.ownerName));

      if (answer === undefined) {
        return;
      }

      const userInput = answer.trim();

      if (!userInput) {
        continue;
      }

      if (userInput === "/exit") {
        writeLine(formatTerminalGoodbye());
        return;
      }

      const handledSlashCommand = await handleSlashCommand(userInput, options.paths, writeLine);

      if (handledSlashCommand) {
        continue;
      }

      try {
        apiKey ??= await loadLlmCandidateSecret(resolvePrimaryLlmCandidate(options.config), options.paths);
        const memories = await loadRelevantMemories(options.paths, { query: userInput });
        const knowledgeGraph = await loadRelevantKnowledgeGraph(options.paths, userInput);
        const conversationSummary = await loadConversationSummaryContext(options.paths, "terminal");
        const messages = buildChatMessages(buildTerminalSystemPrompt(options.systemPrompt, options.config), recentTurns, userInput, memories, { memoryRetrievalPolicy: options.config.memory?.retrievalPolicy ?? "full", knowledgeGraph, conversationSummary, recentMessageLimit });
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
        await runTerminalConversationSummaryPass({ config: options.config, paths: options.paths, apiKey, channel: "terminal", chatCompletion });
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
          recentTurns = appendConversationTurn(recentTurns, userInput, assistantText, recentMessageLimit);
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

async function runTerminalConversationSummaryPass(options: Parameters<typeof refreshConversationSummary>[0]): Promise<void> {
  try {
    await refreshConversationSummary(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown conversation summary error.";
    await appendLog({ event: "conversation_summary_failure", detail: { channel: options.channel, message } }, { paths: options.paths, knownSecrets: [options.apiKey] });
  }
}

export function buildTerminalSystemPrompt(systemPrompt: string, config: AppConfig): string {
  return buildMcpToolSystemPrompt(systemPrompt, config);
}
function printChatHeader(options: TerminalChatOptions, writeLine: (message: string) => void = console.log): void {
  const agentName = options.agentName ?? options.config.agent.name;
  const ownerName = options.ownerName ?? options.config.agent.ownerName;
  for (const line of renderTerminalChatHeader({ agentName, ownerName, model: options.config.llm.primary, runtimePath: options.paths.appDir })) {
    writeLine(line);
  }
}

export function formatPrompt(ownerName?: string): string {
  return formatTerminalPrompt(ownerName);
}

export function formatAssistantMessage(agentName: string | undefined, message: string): string {
  return formatTerminalAssistantMessage(agentName, message);
}

export function formatErrorMessage(message: string): string {
  return formatTerminalError(message);
}

function startChatIndicator(agentName: string | undefined): { clear: () => void; stop: () => void } {
  if (!output.isTTY) {
    return { clear: () => undefined, stop: () => undefined };
  }

  const label = agentName ?? "bestie";
  const frames = [".", "..", "..."];
  let frame = 0;

  const render = () => {
    output.write(`\r${formatTerminalThinking(label, frames[frame % frames.length] ?? "")}   `);
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

  writeLine(formatTerminalToolActivity(agentName, activity.toolName, activity.label));
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
        writeChunk(formatTerminalAssistantStart(agentName));
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
    writeLine(`Commands: ${terminalSlashCommands.map((command) => command.command).join(", ")}`);
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


async function isMemoryPaused(paths: RuntimePaths): Promise<boolean> {
  const store = await SqliteMemoryStore.open(paths);

  try {
    return store.getMemoryState().paused;
  } finally {
    store.close();
  }
}

async function loadRecentTerminalTurns(paths: RuntimePaths, recentMessageLimit: number): Promise<ChatMessage[]> {
  const store = await SqliteMemoryStore.open(paths);

  try {
    if (store.getMemoryState().paused) {
      return [];
    }

    return store.listRecentMessagesForChannel("terminal", undefined, recentMessageLimit).map((message) => ({ role: message.role, content: message.content }));
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
