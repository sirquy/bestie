import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { sendChatCompletionWithFallbacks } from "../llm/openai-compatible.js";
import { loadRequiredSecret } from "../runtime/env.js";
import { appendLog } from "../runtime/logger.js";
import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import { buildChatMessages, MEMORY_CONTEXT_ITEM_LIMIT } from "../chat/message-builder.js";
import { completeWithAgentTools, type AgentToolChatCompletionRunner } from "../chat/mcp-tool-use.js";
import type { ChatCompletionOptions } from "../llm/types.js";

const CRON_MAX_TOOL_CALLS = 50;

const CRON_SYSTEM_PREFIX = `[Scheduled task context]\nYou are executing a scheduled background task. You are not chatting with your owner.\nComplete the task as instructed. Be concise. Do not mention that you are running on a schedule.`;

export interface IsolatedChatOptions {
  config: AppConfig;
  paths: RuntimePaths;
  apiKey?: string;
  prompt: string;
  maxToolCalls?: number;
}

const cronChatCompletion: AgentToolChatCompletionRunner = (config: AppConfig, _apiKey: string, options: ChatCompletionOptions) =>
  sendChatCompletionWithFallbacks(config, options);

export async function runIsolatedChat(options: IsolatedChatOptions): Promise<string> {
  const apiKey = options.apiKey ?? (await loadRequiredSecret(options.config.llm.apiKeyEnv, options.paths));

  const systemPrompt = buildCronSystemPrompt(options.config);
  const memories = await loadActiveMemories(options.paths);
  const messages = buildChatMessages(systemPrompt, [], options.prompt, memories);

  appendLog(
    { event: "cron_isolated_chat_start", detail: { prompt: options.prompt.slice(0, 120) } },
    { paths: options.paths },
  );

  const result = await completeWithAgentTools({
    config: options.config,
    paths: options.paths,
    apiKey,
    messages,
    chatCompletion: cronChatCompletion,
    maxToolCalls: options.maxToolCalls ?? CRON_MAX_TOOL_CALLS,
    streamFinalResponse: false,
  });

  return result;
}

function buildCronSystemPrompt(config: AppConfig): string {
  const base = [CRON_SYSTEM_PREFIX, `Agent name: ${config.agent.name}. Owner: ${config.agent.ownerName}.`].join("\n\n");
  return base;
}

async function loadActiveMemories(paths: RuntimePaths): Promise<import("../memory/sqlite-store.js").StoredMemory[]> {
  const store = await SqliteMemoryStore.open(paths);

  try {
    if (store.getMemoryState().paused) {
      return [];
    }

    return store.listActiveMemories(MEMORY_CONTEXT_ITEM_LIMIT);
  } finally {
    store.close();
  }
}
