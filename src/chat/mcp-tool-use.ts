import { discoverOAuthServerInfo } from "@modelcontextprotocol/sdk/client/auth.js";

import { callMcpServerTool, listMcpServerTools, type McpToolCallResult } from "../mcp/connection.js";
import { findConfiguredMcpTool, findMcpServer, listMcpServers } from "../mcp/servers.js";
import { loadConfig, validateConfig, writeConfig, type AppConfig, type McpToolCategory } from "../runtime/config.js";
import { loadEnvFile } from "../runtime/env.js";
import { appendLog } from "../runtime/logger.js";
import type { RuntimePaths } from "../runtime/paths.js";
import type { ChatCompletionOptions, ChatMessage } from "../llm/types.js";
import { reviewActionPermission, type PermissionApprover, type PermissionPolicy } from "../safety/permission-policy.js";
import { evaluateMemoryCandidate, type MemoryType } from "../memory/policy.js";
import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import { applyPatchTool, editLocalFileTool, execLocalTool, listProcessesTool, writeLocalFileTool } from "../tools/local-action-tools.js";
import { analyzeMemoriesTool, inspectMemoryTool, listActiveMemoriesTool, listLocalFilesTool, planMemoryHygieneTool, planMemoryRebalanceTool, readGitDiffTool, readGitLogTool, readGitStatusTool, readLocalFileTool, readManyLocalFilesTool, readMarkdownBundleTool, readMemoryHygieneTrendTool, readRecentAppLogsTool, searchLocalFilesTool, searchMemoriesTool, type MemoryAnalysisMode } from "../tools/local-read-tools.js";
import { readUrlTool } from "../tools/web-read-tools.js";
import { addCronScheduleTool, listCronSchedulesTool, removeCronScheduleTool, toggleCronScheduleTool } from "../tools/cron-tools.js";

export type AgentToolRunner = (options: RunAgentToolRequestOptions) => Promise<McpToolCallResult>;
export type AgentToolChatCompletionRunner = (config: AppConfig, apiKey: string, options: ChatCompletionOptions) => Promise<string>;
export type AgentToolActivityHandler = (activity: AgentToolActivity) => void | Promise<void>;

export interface AgentToolActivity {
  phase: "start" | "finish";
  callIndex: number;
  toolName: string;
  label: string;
  status?: McpToolCallResult["status"];
  ok?: boolean;
  durationMs?: number;
}

export interface CompleteWithAgentToolsOptions {
  config: AppConfig;
  paths: RuntimePaths;
  apiKey: string;
  messages: ChatMessage[];
  chatCompletion: AgentToolChatCompletionRunner;
  toolRunner?: AgentToolRunner;
  approver?: PermissionApprover;
  policy?: PermissionPolicy;
  maxToolCalls?: number;
  streamFinalResponse?: boolean;
  onToken?: (token: string) => void;
  onToolActivity?: AgentToolActivityHandler;
  runtimeContext?: string;
  subagentDepth?: number;
}

export interface McpToolRequest {
  tool: "mcp.read";
  server: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface InternalToolRequest {
  tool: "internal.read_file" | "internal.read_many_files" | "internal.read_markdown_bundle" | "internal.list_files" | "internal.search_files" | "internal.read_logs" | "internal.read_url" | "internal.git_status" | "internal.git_diff" | "internal.git_log" | "internal.mcp_list_servers" | "internal.mcp_list_tools" | "internal.mcp_discover_oauth" | "internal.mcp_prepare_server_config" | "internal.mcp_apply_server_config" | "internal.write_file" | "internal.edit_file" | "internal.apply_patch" | "internal.exec" | "internal.list_processes" | "internal.spawn_subagent" | "internal.list_memories" | "internal.search_memories" | "internal.inspect_memory" | "internal.analyze_memories" | "internal.plan_memory_hygiene" | "internal.plan_memory_rebalance" | "internal.memory_hygiene_trend" | "internal.remember_memory" | "internal.delete_memory" | "internal.cleanup_memories" | "internal.supersede_memory" | "internal.add_cron_schedule" | "internal.list_cron_schedules" | "internal.remove_cron_schedule" | "internal.toggle_cron_schedule";
  arguments: Record<string, unknown>;
}

export type AgentToolRequest = McpToolRequest | InternalToolRequest;

export type McpToolRequestParseResult =
  | { kind: "none" }
  | { kind: "valid"; request: AgentToolRequest }
  | { kind: "invalid"; message: string };

export type AgentToolDecisionParseResult =
  | { kind: "answer"; content: string }
  | { kind: "tool"; request: AgentToolRequest }
  | { kind: "invalid"; message: string };

export interface RunMcpToolRequestOptions {
  config: AppConfig;
  paths: RuntimePaths;
  request: McpToolRequest;
  approver?: PermissionApprover;
  policy?: PermissionPolicy;
  callTool?: typeof callMcpServerTool;
}

export interface RunAgentToolRequestOptions extends Omit<RunMcpToolRequestOptions, "request"> {
  request: AgentToolRequest;
  apiKey?: string;
  chatCompletion?: AgentToolChatCompletionRunner;
  runtimeContext?: string;
  subagentDepth?: number;
}

const DEFAULT_MAX_AGENT_TOOL_CALLS = 250;
const DEFAULT_MAX_SUBAGENT_TOOL_CALLS = 50;
const MAX_SUBAGENT_TOOL_CALLS = 100;
const MAX_SUBAGENT_TASK_BYTES = 16 * 1024;

export async function completeWithAgentTools(options: CompleteWithAgentToolsOptions): Promise<string> {
  const toolRunner = options.toolRunner ?? runAgentToolRequest;
  const maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_AGENT_TOOL_CALLS;
  let currentConfig = options.config;
  const messages = [...options.messages, { role: "user" as const, content: buildAgentToolDecisionMessage() }];
  const completedToolResults = new Map<string, { toolName: string; result: McpToolCallResult }>();
  let assistantText = await options.chatCompletion(currentConfig, options.apiKey, { messages });

  for (let toolCallCount = 0; toolCallCount < maxToolCalls; toolCallCount += 1) {
    const decision = parseAgentToolDecisionResult(assistantText);

    if (decision.kind === "answer") {
      return decision.content;
    }

    messages.push({ role: "assistant", content: assistantText });

    if (decision.kind === "invalid") {
      messages.push({ role: "user", content: buildInvalidMcpToolRequestMessage(decision.message) });
      assistantText = await options.chatCompletion(options.config, options.apiKey, { messages });
      if (isPlainFinalResponse(assistantText)) {
        return assistantText;
      }
      continue;
    }

    const toolName = formatToolRequestName(decision.request);
    const toolSignature = stableToolRequestSignature(decision.request);
    const completedToolResult = completedToolResults.get(toolSignature);
    if (decision.request.tool === "internal.exec" && completedToolResult?.result.ok) {
      return buildRepeatedSuccessfulToolAnswer(completedToolResult.toolName, completedToolResult.result);
    }

    const label = formatToolActivityLabel(decision.request);
    const startedAt = Date.now();
    await notifyToolActivity(options, { phase: "start", callIndex: toolCallCount + 1, toolName, label });
    let toolResult: McpToolCallResult;
    try {
      toolResult = await toolRunner({ config: currentConfig, paths: options.paths, request: decision.request, approver: options.approver, policy: options.policy, apiKey: options.apiKey, chatCompletion: options.chatCompletion, runtimeContext: options.runtimeContext, subagentDepth: options.subagentDepth ?? 0 });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      await notifyToolActivity(options, { phase: "finish", callIndex: toolCallCount + 1, toolName, label, ok: false, status: "fail", durationMs });
      throw error;
    }
    const durationMs = Date.now() - startedAt;
    await notifyToolActivity(options, { phase: "finish", callIndex: toolCallCount + 1, toolName, label, ok: toolResult.ok, status: toolResult.status, durationMs });
    if (toolResult.ok) {
      completedToolResults.set(toolSignature, { toolName, result: toolResult });
      currentConfig = await loadConfig(options.paths).catch(() => currentConfig);
    }
    messages.push({ role: "user", content: buildAgentToolResultMessage(toolName, toolResult) });
    assistantText = await options.chatCompletion(currentConfig, options.apiKey, { messages, stream: options.streamFinalResponse, onToken: options.onToken });
    if (isStreamedPlainFinalResponse(options, assistantText)) {
      return assistantText;
    }
  }

  return `Tool loop stopped after ${maxToolCalls} tool calls. Ask me to narrow the request or continue with a smaller scope.`;
}

export function parseMcpToolRequest(text: string): AgentToolRequest | undefined {
  const result = parseMcpToolRequestResult(text);
  return result.kind === "valid" ? result.request : undefined;
}

export function parseMcpToolRequestResult(text: string): McpToolRequestParseResult {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const rawJson = fenced?.[1] ?? extractToolRequestJson(trimmed);

  if (!fenced && rawJson !== trimmed && looksLikeMixedToolJson(trimmed)) {
    return { kind: "invalid", message: "Tool request JSON must be the entire assistant message, with no prose before or after it." };
  }

  if (!rawJson?.startsWith("{") || !rawJson.endsWith("}")) {
    return { kind: "none" };
  }

  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!isRecord(parsed) || typeof parsed.tool !== "string") {
      return { kind: "invalid", message: "Tool requests must use internal.* or mcp.read schema. Shell command JSON such as {\"cmd\":...} is not supported." };
    }

    const args = parsed.arguments === undefined ? {} : parsed.arguments;
    if (!isRecord(args)) {
      return { kind: "invalid", message: "Tool request arguments must be a JSON object." };
    }

    if (isInternalToolName(parsed.tool)) {
      return { kind: "valid", request: { tool: parsed.tool, arguments: args } };
    }

    if (parsed.tool !== "mcp.read" || typeof parsed.server !== "string" || typeof parsed.name !== "string") {
      return { kind: "invalid", message: "Tool requests must use only these schemas: {\"tool\":\"internal.read_file\",\"arguments\":{\"path\":\"...\"}} or {\"tool\":\"mcp.read\",\"server\":\"server-name\",\"name\":\"tool-name\",\"arguments\":{}}. Shell command JSON such as {\"cmd\":...} is not supported." };
    }

    return { kind: "valid", request: { tool: "mcp.read", server: parsed.server, name: parsed.name, arguments: args } };
  } catch {
    return { kind: "invalid", message: "Tool request JSON could not be parsed. Reply with normal text or the exact MCP read JSON schema." };
  }
}

function extractToolRequestJson(text: string): string | undefined {
  return text.startsWith("{") && text.endsWith("}") ? text : undefined;
}

function looksLikeMixedToolJson(text: string): boolean {
  return /\{[\s\S]*"tool"\s*:/.test(text);
}

export function parseAgentToolDecisionResult(text: string): AgentToolDecisionParseResult {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const rawJson = fenced?.[1] ?? extractToolDecisionJson(trimmed);

  if (!rawJson?.startsWith("{") || !rawJson.endsWith("}")) {
    return { kind: "invalid", message: "Tool decisions must be JSON with either {\"answer\":\"...\"} or a supported tool request." };
  }

  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!isRecord(parsed)) {
      return { kind: "invalid", message: "Tool decisions must be a JSON object." };
    }

    if (typeof parsed.answer === "string") {
      return { kind: "answer", content: parsed.answer };
    }

    const toolResult = parseMcpToolRequestResult(rawJson);
    if (toolResult.kind === "valid") {
      return { kind: "tool", request: toolResult.request };
    }

    return { kind: "invalid", message: toolResult.kind === "invalid" ? toolResult.message : "Tool decisions must include answer or a supported tool request." };
  } catch {
    return { kind: "invalid", message: "Tool decision JSON could not be parsed." };
  }
}

function extractToolDecisionJson(text: string): string | undefined {
  if (text.startsWith("{") && text.endsWith("}")) {
    return text;
  }

  return extractToolRequestJson(text);
}

function isStreamedPlainFinalResponse(options: CompleteWithAgentToolsOptions, text: string): boolean {
  return options.streamFinalResponse === true && options.onToken !== undefined && isPlainFinalResponse(text);
}

function isPlainFinalResponse(text: string): boolean {
  return !text.trim().startsWith("{");
}

export function buildMcpToolInstructions(config: AppConfig, runtimeContext?: string): string | undefined {
  const readTools = (config.mcp?.servers ?? [])
    .filter((server) => server.enabled)
    .flatMap((server) => (server.tools ?? []).filter((tool) => tool.category === "read").map((tool) => `${server.name}/${tool.name}`));

  const contextSection = runtimeContext?.trim() ? `\nRuntime context:\n${runtimeContext.trim()}` : "";
  const mcpSection = readTools.length === 0 ? "" : `\nAvailable read-only MCP tools:\n${readTools.map((tool) => `- ${tool}`).join("\n")}`;

  const tools = [
    'internal.read_file {"path":"relative/or/allowed/absolute/path"}',
    'internal.read_many_files {"paths":["README.md","docs/ARCHITECTURE.md"],"maxBytesPerFile":24576,"maxTotalBytes":163840}',
    'internal.read_markdown_bundle {"path":".","limit":40,"maxBytesPerFile":24576,"maxTotalBytes":163840}',
    'internal.list_files {"path":"optional/path","limit":50}',
    'internal.search_files {"query":"*.log","path":"optional/path","limit":20}',
    'internal.read_logs {"lines":40}',
    'internal.read_url {"url":"https://example.com/mcp-docs","maxBytes":131072,"timeoutMs":10000}',
    'internal.git_status {"path":"optional/repo/path"}',
    'internal.git_diff {"path":"optional/repo/path","staged":false,"maxBytes":98304}',
    'internal.git_log {"path":"optional/repo/path","limit":10}',
    'internal.mcp_list_servers {}',
    'internal.mcp_list_tools {"server":"server-name","connect":true}',
    'internal.mcp_discover_oauth {"url":"https://provider.example/mcp","resourceMetadataUrl":"optional explicit metadata URL"}',
    'internal.mcp_prepare_server_config {"name":"server-name","transport":"streamable-http","url":"https://provider.example/mcp","auth":{"type":"oauth","authorizationUrl":"https://provider.example/oauth/authorize","tokenUrl":"https://provider.example/oauth/token","clientId":"discovered-client-id","scopes":["discovered.scope"],"redirectUri":"http://127.0.0.1:8989/oauth/callback","resource":"https://provider.example/mcp","envVar":"PROVIDER_MCP_AUTHORIZATION","headerName":"authorization"},"tools":[{"name":"tool_name","category":"read|local_write|external_write|public_action|destructive|money|unknown"}]}',
    'internal.mcp_apply_server_config {"server":{"name":"server-name","enabled":true,"transport":"streamable-http","url":"https://provider.example/mcp","auth":{"type":"oauth","authorizationUrl":"https://provider.example/oauth/authorize","tokenUrl":"https://provider.example/oauth/token","clientId":"discovered-client-id","envVar":"PROVIDER_MCP_AUTHORIZATION"},"tools":[]},"mode":"upsert"}',
    'internal.write_file {"path":"relative/path","content":"text","overwrite":false}',
    'internal.edit_file {"path":"relative/path","oldText":"exact text","newText":"replacement","replaceAll":false}',
    'internal.apply_patch {"patch":"git apply compatible patch"}',
    'internal.exec {"command":"npm","args":["test"],"cwd":".","timeoutMs":30000}',
    'internal.list_processes {"limit":20}',
    'internal.spawn_subagent {"task":"focused task for a helper agent","name":"optional short name","maxToolCalls":20}',
    'internal.list_memories {}',
    'internal.search_memories {"query":"memory search text"}',
    'internal.inspect_memory {"id":1}',
    'internal.analyze_memories {"mode":"all|duplicates|stale|conflicts"}',
    'internal.plan_memory_hygiene {}',
    'internal.plan_memory_rebalance {}',
    'internal.remember_memory {"type":"preference|communication_preference|user_fact|project_context|durable_decision|sensitive_personal","content":"durable memory to save"}',
    'internal.delete_memory {"id":1,"reason":"why this memory is stale, wrong, duplicate, or no longer useful"}',
    'internal.cleanup_memories {"ids":[1,2,3],"reason":"why these memories should be deleted"}',
    'internal.supersede_memory {"oldId":1,"newId":2,"reason":"why the old memory is replaced by the new memory"}',
    'internal.add_cron_schedule {"name":"job name","schedule_type":"interval|cron_expr|once","schedule_value":"30m | 0 8 * * * | 2026-12-25T08:00:00Z","prompt":"what to do when triggered","channel":"optional telegram:<userId>|zalo:<userId> destination for completion report"}',
    'internal.list_cron_schedules {}',
    'internal.remove_cron_schedule {"schedule_id":1}',
    'internal.toggle_cron_schedule {"schedule_id":1,"enabled":true}',
  ];

  return `Available internal tools:${contextSection}\n- ${tools.join("\n- ")}${mcpSection}\n\nTool selection guide:\n- Answer directly only when the request does not depend on local files, logs, repo contents, git state, HTTP(S) links, configured MCP data, MCP server discovery, or making a requested local change.\n- Approved local memories may already be included in the conversation as system context. Use that memory context directly when it answers the user; do not call memory tools just to rediscover information already shown there.\n- If the user gives an MCP server link, MCP docs link, or asks to install/connect/configure an MCP server, do the setup yourself through tools. Do not tell the user to edit config.json, run bestie mcp commands, manually classify tools, restart/reload Bestie, or discover auth endpoints themselves. Only ask the user for account-consent actions, the returned auth code/result, or missing provider facts that cannot be discovered from the URL/docs.\n- Use MCP tools/configuration in this order when the user asks to install, discover, login, or configure an MCP service: read service docs with read_url when needed, inspect existing config with mcp_list_servers, then prefer internal.exec command bestie args ["mcp","add","server-name","--url","https://provider.example/mcp","--oauth-client-id","client-id"] for URL-based servers. The add command discovers OAuth metadata when possible and saves config without guessing auth URLs. If the user only provides a docs page, read it first, extract the real MCP endpoint/client id from that page, then run bestie mcp add yourself. Use mcp_discover_oauth, mcp_prepare_server_config, and mcp_apply_server_config only when docs require custom config not covered by bestie mcp add. OAuth config should include tokenUrl when available; without tokenUrl, bestie mcp login can generate the authorization URL but cannot exchange the returned code. If the server auth is oauth, run internal.exec with command bestie and args ["mcp","login","server-name"] after config is saved; use only the generated login command output URL in the final answer and ask the user to log in/approve. OAuth metadata authorization_endpoint or config auth.authorizationUrl is not a clickable user auth URL; never send it to the user as the authorization URL unless it already includes OAuth query parameters such as client_id, response_type, redirect_uri, state, and code_challenge. After the user sends the auth code, run internal.exec with command bestie and args ["mcp","login","server-name","--code","<code>"], then use mcp_list_tools with connect=true to verify discovery and auto-classify annotated tools. Do not guess auth URLs by hand; let bestie mcp login generate PKCE/state URLs. Do not put raw secrets in config; use env var names via env, headersEnv, or auth.envVar.\n- Use memory tools only when the included memory context is missing or insufficient, when the user explicitly asks to search/list/inspect memories, when saving a durable memory, when cleaning stale/incorrect/duplicate memories, or when checking whether core/project/session scopes need rebalancing.\n- Use file tools for repo/local context: read_file for a known path, list_files to inspect a directory, search_files to discover likely paths, read_many_files for a small known set, read_markdown_bundle for repo/docs summaries. If the user asks you to edit a known config or project file, read the file if needed, then use edit_file/write_file/apply_patch; do not merely explain the edit unless the tool is denied or unavailable.\n- Generic list/search requests such as "list files" or internal.list_files with path "." inspect the agent workspace, defaulting to .bestie/workspace. Use an explicit project path such as "src", "docs", or an absolute project root path when the user asks to inspect repository files.\n- Relative read_file/read_many_files/read_markdown_bundle paths resolve from the project root. Relative write/edit/exec paths resolve from the agent workspace to avoid polluting the project root.\n- Absolute paths outside the project root and agent workspace are allowed only when covered by workspace.externalPaths in config.\n- Use read_logs only for recent runtime behavior, failures, diagnostics, or debugging questions.\n- Use read_url when the user gives an HTTP(S) link whose page content is needed, such as MCP setup docs, package pages, or install instructions; it obeys internalTools.policies and may require approval.\n- Use git tools for repository state questions: git_status for changed files, git_diff for current or staged patches, git_log for recent commits.\n- Use internal.mcp_list_servers when the user asks what MCP servers are configured or available. Use internal.mcp_list_tools when the user asks what a configured MCP server can do, or before claiming a remote MCP server has no tools.\n- Use write/edit/apply_patch/exec/process tools when the user asks you to change files, update config, run validation, commit changes, or inspect running processes; these tools obey internalTools.policies and may require approval.\n- Use configured MCP read tools only for external configured data that internal local tools cannot provide. If a server has discovered tools but no configured tool categories, explain that discovery works but tool execution still needs allowlisted categories.\n\nTool-use rule:\n- When asked for a tool decision, reply with exactly one JSON object and no extra text.\n- Use {"answer":"..."} only when no tool is needed by the selection guide.\n- If a listed tool is needed, reply with that executable tool JSON immediately and nothing else. Do not put prose before or after tool JSON.\n- After any empty, denied, or failed result, either try one clearly useful adjacent tool call or answer transparently that the data was not found/available. Do not invent missing facts.\n- Internal examples: {"tool":"internal.mcp_list_servers","arguments":{}} or {"tool":"internal.mcp_list_tools","arguments":{"server":"composio","connect":true}}\n- MCP example: {"tool":"mcp.read","server":"server-name","name":"tool-name","arguments":{}}\n- Do not invent shell command JSON, cmd fields, workdir fields, bash commands, sed, cat, rg, terminal actions, or non-git patch markers. Only the tool schemas above can be executed. internal.apply_patch requires a git apply compatible diff, not *** Begin Patch format.\n- The runtime can execute multiple tool calls in sequence, then show you each result so you can continue or answer the user.`;
}

export function buildAgentToolDecisionMessage(): string {
  return `Tool decision required. Reply with exactly one JSON object and no extra text:\n- {"answer":"final answer text"} if you can answer without tools.\n- A supported internal or MCP tool request if local files, logs, memories, repo contents, HTTP(S) links, configured MCP data, MCP server discovery, validation, or requested file/config changes are needed.\nNever reply with a plan to call a tool later. If the user asked for a file/config change and a supported tool can do it, call the tool instead of describing the edit.`;
}

export function buildMcpToolSystemPrompt(systemPrompt: string, config: AppConfig, runtimeContext?: string): string {
  const instructions = buildMcpToolInstructions(config, runtimeContext);
  return instructions ? `${systemPrompt.trimEnd()}\n\n${instructions}` : systemPrompt;
}

export function buildMcpToolResultMessage(server: string, name: string, toolResult: McpToolCallResult): string {
  const guidance = buildToolResultGuidance(`${server}/${name}`, toolResult);
  return `Tool result for ${server}/${name}: ${JSON.stringify({ ok: toolResult.ok, status: toolResult.status, message: toolResult.message, result: toolResult.result })}\n${guidance}\nRespond to the user using this result.`;
}

export function buildAgentToolResultMessage(toolName: string, toolResult: McpToolCallResult): string {
  const guidance = buildToolResultGuidance(toolName, toolResult);
  return `Tool result for ${toolName}: ${JSON.stringify({ ok: toolResult.ok, status: toolResult.status, message: toolResult.message, result: toolResult.result })}\n${guidance}\nTool decision required. Reply with exactly one JSON object and no extra text: either {"answer":"final answer text"} if this result satisfies the original user request, or the next supported tool request if work remains. For internal.exec, use stdout, stderr, and exitCode from this result to answer; do not rerun the same successful command. Do not repeat the same successful tool request. Do not describe a future action; execute it with a tool request.`;
}

function buildToolResultGuidance(toolName: string, toolResult: McpToolCallResult): string {
  const recoveryHint = buildToolResultRecoveryHint(toolName, toolResult);
  if (recoveryHint) {
    return recoveryHint;
  }

  if (!toolResult.ok) {
    return "This tool did not succeed. Do not invent the missing data; explain the limitation or try one clearly useful adjacent tool if available.";
  }

  if (isEmptyToolResult(toolResult.result)) {
    return "This tool returned no matching data. Do not claim the data exists; answer that nothing relevant was found or try one clearly useful adjacent search/list tool.";
  }

  return "Ground the next step in this tool result. If the result answers the original user request, return an answer now. If the original user request still has required files, edits, commands, or other actions remaining, call the next needed tool instead of answering as if the task is complete. Do not add facts that are not supported by the result or prior conversation.";
}

function stableToolRequestSignature(request: AgentToolRequest): string {
  return JSON.stringify(sortJsonValue(request));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entryValue]) => [key, sortJsonValue(entryValue)]));
}

function buildRepeatedSuccessfulToolAnswer(toolName: string, toolResult: McpToolCallResult): string {
  const result = isRecord(toolResult.result) ? toolResult.result : undefined;
  const stdout = typeof result?.stdout === "string" ? result.stdout.trim() : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr.trim() : "";
  const exitCode = typeof result?.exitCode === "number" ? result.exitCode : undefined;

  if (toolName === "internal.exec" && stdout) {
    return stdout;
  }

  if (toolName === "internal.exec" && stderr) {
    return stderr;
  }

  if (toolName === "internal.exec" && exitCode !== undefined) {
    return `Command already completed successfully with exit code ${exitCode}.`;
  }

  return `Tool ${toolName} already completed successfully, but the model repeated the same request. Result: ${JSON.stringify({ message: toolResult.message, result: toolResult.result })}`;
}

function buildToolResultRecoveryHint(toolName: string, toolResult: McpToolCallResult): string | undefined {
  if (!toolName.startsWith("internal.") || toolResult.ok || toolResult.message !== "Path does not exist.") {
    return undefined;
  }

  return "If this missing path blocks the request and another tool call is still useful, use internal.list_files on the nearest existing parent directory or internal.search_files for the likely file name before answering.";
}

function isEmptyToolResult(result: unknown): boolean {
  if (Array.isArray(result)) {
    return result.length === 0;
  }

  if (!result || typeof result !== "object") {
    return false;
  }

  return ["memories", "matches", "entries", "files", "lines"].some((key) => Array.isArray((result as Record<string, unknown>)[key]) && ((result as Record<string, unknown>)[key] as unknown[]).length === 0);
}

function formatToolRequestName(request: { tool: string; server?: string; name?: string }): string {
  return request.tool === "mcp.read" ? `${request.server}/${request.name}` : request.tool;
}

export function buildInvalidMcpToolRequestMessage(message: string): string {
  return `The previous assistant message is not an executable tool-loop decision: ${message}\nReply with exactly one JSON object and no extra text: either {"answer":"final answer text"} for a completed answer, or a supported internal/MCP tool request for work that still needs execution. Do not describe what you will do next.`;
}

export function formatToolActivityLabel(request: AgentToolRequest): string {
  const args = request.arguments;

  if (request.tool === "mcp.read") {
    return `${request.server}/${request.name}`;
  }

  if (request.tool === "internal.read_file") {
    return stringArg(args.path) ?? "file";
  }

  if (request.tool === "internal.read_many_files") {
    const paths = Array.isArray(args.paths) ? args.paths.filter((path) => typeof path === "string") : [];
    return `${paths.length} files`;
  }

  if (request.tool === "internal.read_markdown_bundle") {
    return stringArg(args.path) ?? ".";
  }

  if (request.tool === "internal.list_files") {
    return stringArg(args.path) ?? ".";
  }

  if (request.tool === "internal.search_files") {
    const query = stringArg(args.query) ?? "files";
    const path = stringArg(args.path) ?? ".";
    return `${query} in ${path}`;
  }

  if (request.tool === "internal.read_logs") {
    return "recent logs";
  }

  if (request.tool === "internal.read_url") {
    return stringArg(args.url) ?? "url";
  }

  if (request.tool === "internal.git_status") {
    return stringArg(args.repoPath) ?? stringArg(args.path) ?? "git status";
  }

  if (request.tool === "internal.git_diff") {
    return stringArg(args.repoPath) ?? stringArg(args.path) ?? (booleanArg(args.staged) ? "staged git diff" : "git diff");
  }

  if (request.tool === "internal.git_log") {
    return stringArg(args.repoPath) ?? stringArg(args.path) ?? "git log";
  }

  if (request.tool === "internal.mcp_list_servers") {
    return "mcp servers";
  }

  if (request.tool === "internal.mcp_list_tools") {
    return stringArg(args.server) ?? "mcp tools";
  }

  if (request.tool === "internal.write_file" || request.tool === "internal.edit_file") {
    return stringArg(args.path) ?? "file";
  }

  if (request.tool === "internal.apply_patch") {
    return "patch";
  }

  if (request.tool === "internal.exec") {
    return stringArg(args.command) ?? "command";
  }

  if (request.tool === "internal.list_processes") {
    return "processes";
  }

  if (request.tool === "internal.remember_memory") {
    return stringArg(args.type) ?? "memory";
  }

  if (request.tool === "internal.delete_memory") {
    return `memory #${numberArg(args.id) ?? "?"}`;
  }

  if (request.tool === "internal.inspect_memory") {
    return `memory #${numberArg(args.id) ?? "?"}`;
  }

  if (request.tool === "internal.cleanup_memories") {
    const ids = memoryIdsArg(args.ids);
    return ids.length > 0 ? `${ids.length} memories` : "memories";
  }

  if (request.tool === "internal.supersede_memory") {
    return `memory #${numberArg(args.oldId) ?? "?"} -> #${numberArg(args.newId) ?? "?"}`;
  }

  if (request.tool === "internal.analyze_memories") {
    return stringArg(args.mode) ?? "all";
  }

  if (request.tool === "internal.plan_memory_hygiene") {
    return "memory hygiene";
  }

  if (request.tool === "internal.plan_memory_rebalance") {
    return "memory rebalance";
  }

  if (request.tool === "internal.memory_hygiene_trend") {
    return "memory hygiene trend";
  }

  if (request.tool === "internal.search_memories") {
    return stringArg(args.query) ?? "memories";
  }

  return "active memories";
}

async function notifyToolActivity(options: CompleteWithAgentToolsOptions, activity: AgentToolActivity): Promise<void> {
  await options.onToolActivity?.(activity);
  await appendLog(
    {
      event: "agent_tool_activity",
      detail: {
        phase: activity.phase,
        callIndex: activity.callIndex,
        toolName: activity.toolName,
        label: activity.label,
        ok: activity.ok,
        status: activity.status,
        durationMs: activity.durationMs,
      },
    },
    { paths: options.paths },
  );
}

export async function runMcpToolRequest(options: RunMcpToolRequestOptions): Promise<McpToolCallResult> {
  const server = findMcpServer(options.config, options.request.server);

  if (!server) {
    return { ok: false, status: "fail", message: `MCP server not found: ${options.request.server}` };
  }

  const configuredTool = findConfiguredMcpTool(server, options.request.name);
  if (!configuredTool) {
    return { ok: false, status: "fail", message: `MCP tool ${server.name}/${options.request.name} is not configured in the local allowlist.` };
  }

  if (configuredTool.category !== "read") {
    return { ok: false, status: "fail", message: `MCP tool ${server.name}/${options.request.name} is categorized as ${configuredTool.category}, but only read tools can be called in this MVP.` };
  }

  const permission = await reviewActionPermission(
    {
      category: configuredTool.category,
      action: `mcp_tool_call:${server.name}/${options.request.name}`,
      target: `mcp:${server.name}/${options.request.name}`,
      reason: "Run a read-only MCP tool call requested by terminal chat.",
      trusted: true,
    },
    {
      paths: options.paths,
      approver: options.approver,
      policy: options.policy,
      knownSecrets: Object.values(server.env),
    },
  );

  if (permission.decision !== "allow") {
    return { ok: false, status: "fail", message: `MCP tool call denied: ${permission.reason}` };
  }

  return (options.callTool ?? callMcpServerTool)(server, options.request.name, options.request.arguments, { env: await loadEnvFile(options.paths) });
}

export async function runAgentToolRequest(options: RunAgentToolRequestOptions): Promise<McpToolCallResult> {
  if (options.request.tool === "mcp.read") {
    return runMcpToolRequest({ ...options, request: options.request });
  }

  const args = options.request.arguments;
  if (options.request.tool === "internal.read_file") {
    const path = typeof args.path === "string" ? args.path : undefined;
    if (!path) return { ok: false, status: "fail", message: "internal.read_file requires arguments.path." };
    const result = await readLocalFileTool({ config: options.config, paths: options.paths, path, maxBytes: numberArg(args.maxBytes), approver: options.approver, policy: options.policy });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result: { path: result.path, content: result.content } };
  }

  if (options.request.tool === "internal.read_many_files") {
    const pathsToRead = Array.isArray(args.paths) ? args.paths.filter((path): path is string => typeof path === "string") : [];
    if (pathsToRead.length === 0) return { ok: false, status: "fail", message: "internal.read_many_files requires arguments.paths." };
    const result = await readManyLocalFilesTool({ config: options.config, paths: options.paths, pathsToRead, maxBytesPerFile: numberArg(args.maxBytesPerFile), maxTotalBytes: numberArg(args.maxTotalBytes), approver: options.approver, policy: options.policy });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result: { files: result.files, skipped: result.skipped, totalBytes: result.totalBytes } };
  }

  if (options.request.tool === "internal.read_markdown_bundle") {
    const result = await readMarkdownBundleTool({ config: options.config, paths: options.paths, path: stringArg(args.path), limit: numberArg(args.limit), maxBytesPerFile: numberArg(args.maxBytesPerFile), maxTotalBytes: numberArg(args.maxTotalBytes), approver: options.approver, policy: options.policy });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result: { manifest: result.manifest, files: result.files, skipped: result.skipped, totalBytes: result.totalBytes, truncatedFiles: result.truncatedFiles } };
  }

  if (options.request.tool === "internal.list_files") {
    const result = await listLocalFilesTool({ config: options.config, paths: options.paths, path: stringArg(args.path), limit: numberArg(args.limit), approver: options.approver, policy: options.policy });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result: { path: result.path, entries: result.entries } };
  }

  if (options.request.tool === "internal.search_files") {
    const query = typeof args.query === "string" ? args.query : undefined;
    if (!query) return { ok: false, status: "fail", message: "internal.search_files requires arguments.query." };
    const result = await searchLocalFilesTool({ config: options.config, paths: options.paths, query, path: stringArg(args.path), limit: numberArg(args.limit), approver: options.approver, policy: options.policy });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result: { path: result.path, matches: result.matches } };
  }

  if (options.request.tool === "internal.read_logs") {
    const result = await readRecentAppLogsTool({ paths: options.paths, lineCount: numberArg(args.lines), approver: options.approver, policy: options.policy });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result: { lines: result.lines } };
  }

  if (options.request.tool === "internal.read_url") {
    const url = stringArg(args.url);
    if (!url) return { ok: false, status: "fail", message: "internal.read_url requires arguments.url." };
    const result = await readUrlTool({ config: options.config, paths: options.paths, url, maxBytes: numberArg(args.maxBytes), timeoutMs: numberArg(args.timeoutMs), approver: options.approver });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result: { url: result.url, statusCode: result.statusCode, contentType: result.contentType, content: result.content, truncated: result.truncated } };
  }

  if (options.request.tool === "internal.git_status") {
    const result = await readGitStatusTool({ config: options.config, paths: options.paths, path: stringArg(args.path), repoPath: stringArg(args.repoPath), approver: options.approver, policy: options.policy });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result: { output: result.output } };
  }

  if (options.request.tool === "internal.git_diff") {
    const result = await readGitDiffTool({ config: options.config, paths: options.paths, path: stringArg(args.path), repoPath: stringArg(args.repoPath), staged: booleanArg(args.staged), maxBytes: numberArg(args.maxBytes), approver: options.approver, policy: options.policy });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result: { output: result.output, truncated: result.truncated } };
  }

  if (options.request.tool === "internal.git_log") {
    const result = await readGitLogTool({ config: options.config, paths: options.paths, path: stringArg(args.path), repoPath: stringArg(args.repoPath), limit: numberArg(args.limit), approver: options.approver, policy: options.policy });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result: { output: result.output } };
  }

  if (options.request.tool === "internal.mcp_list_servers") {
    const servers = listMcpServers(options.config).map((server) => ({
      name: server.name,
      enabled: server.enabled,
      transport: server.transport,
      url: server.url,
      command: server.command,
      configuredTools: server.tools,
      envKeys: server.envKeys,
      headerEnvKeys: Object.values(server.headersEnv).sort(),
    }));
    return { ok: true, status: "pass", message: `Found ${servers.length} configured MCP server(s).`, result: { servers } };
  }

  if (options.request.tool === "internal.mcp_list_tools") {
    const serverName = stringArg(args.server);
    if (!serverName) return { ok: false, status: "fail", message: "internal.mcp_list_tools requires arguments.server." };
    const server = findMcpServer(options.config, serverName);
    if (!server) return { ok: false, status: "fail", message: `MCP server not found: ${serverName}` };
    if (!booleanArg(args.connect)) {
      return { ok: true, status: "pass", message: `MCP server ${server.name} has ${server.tools.length} configured tool(s).`, result: { server: server.name, transport: server.transport, tools: server.tools, discovered: false } };
    }
    const result = await listMcpServerTools(server, { timeoutMs: numberArg(args.timeoutMs), env: await loadEnvFile(options.paths) });
    return { ok: result.ok, status: result.status, message: result.message, result: { server: server.name, transport: server.transport, tools: result.tools, configuredTools: server.tools, discovered: true } };
  }

  if (options.request.tool === "internal.mcp_discover_oauth") {
    return discoverMcpOauthTool(args);
  }

  if (options.request.tool === "internal.mcp_prepare_server_config") {
    return prepareMcpServerConfigTool(options.config, args);
  }

  if (options.request.tool === "internal.mcp_apply_server_config") {
    return applyMcpServerConfigTool(options, args);
  }

  if (options.request.tool === "internal.write_file") {
    const path = stringArg(args.path);
    const content = stringArg(args.content);
    if (!path || content === undefined) return { ok: false, status: "fail", message: "internal.write_file requires arguments.path and arguments.content." };
    const result = await writeLocalFileTool({ config: options.config, paths: options.paths, path, content, overwrite: booleanArg(args.overwrite), approver: options.approver });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result: { path: result.path, bytes: result.bytes } };
  }

  if (options.request.tool === "internal.edit_file") {
    const path = stringArg(args.path);
    const oldText = stringArg(args.oldText);
    const newText = stringArg(args.newText);
    if (!path || oldText === undefined || newText === undefined) return { ok: false, status: "fail", message: "internal.edit_file requires arguments.path, arguments.oldText, and arguments.newText." };
    const result = await editLocalFileTool({ config: options.config, paths: options.paths, path, oldText, newText, replaceAll: booleanArg(args.replaceAll), approver: options.approver });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result: { path: result.path, bytes: result.bytes, replacements: result.replacements } };
  }

  if (options.request.tool === "internal.apply_patch") {
    const patch = stringArg(args.patch);
    if (patch === undefined) return { ok: false, status: "fail", message: "internal.apply_patch requires arguments.patch." };
    const result = await applyPatchTool({ config: options.config, paths: options.paths, patch, approver: options.approver });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result: { output: result.output } };
  }

  if (options.request.tool === "internal.exec") {
    const command = stringArg(args.command);
    if (!command) return { ok: false, status: "fail", message: "internal.exec requires arguments.command." };
    const result = await execLocalTool({ config: options.config, paths: options.paths, command, args: arrayOfStringsArg(args.args), cwd: stringArg(args.cwd), timeoutMs: numberArg(args.timeoutMs), approver: options.approver });
    return { ok: result.allowed && result.exitCode === 0, status: result.allowed && result.exitCode === 0 ? "pass" : "fail", message: result.reason, result: { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut } };
  }

  if (options.request.tool === "internal.list_processes") {
    const result = await listProcessesTool({ config: options.config, paths: options.paths, limit: numberArg(args.limit), approver: options.approver });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result: { processes: result.processes } };
  }

  if (options.request.tool === "internal.spawn_subagent") {
    return runSubagentTool(options, args);
  }

  if (options.request.tool === "internal.list_memories") {
    const result = await listActiveMemoriesTool({ paths: options.paths, limit: numberArg(args.limit), approver: options.approver, policy: options.policy });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result: { memories: result.memories } };
  }

  if (options.request.tool === "internal.inspect_memory") {
    const id = numberArg(args.id);
    if (!id) return { ok: false, status: "fail", message: "internal.inspect_memory requires arguments.id." };
    const result = await inspectMemoryTool({ paths: options.paths, id, approver: options.approver, policy: options.policy });
    return { ok: result.allowed && result.memory !== undefined, status: result.allowed && result.memory !== undefined ? "pass" : "fail", message: result.memory ? result.reason : "Active memory not found.", result: { memory: result.memory } };
  }

  if (options.request.tool === "internal.remember_memory") {
    return rememberMemoryTool(options.config, options.paths, args);
  }

  if (options.request.tool === "internal.delete_memory") {
    return deleteMemoryTool(options, args);
  }

  if (options.request.tool === "internal.cleanup_memories") {
    return cleanupMemoriesTool(options, args);
  }

  if (options.request.tool === "internal.supersede_memory") {
    return supersedeMemoryTool(options, args);
  }

  if (options.request.tool === "internal.search_memories") {
    const query = typeof args.query === "string" ? args.query : undefined;
    if (!query) return { ok: false, status: "fail", message: "internal.search_memories requires arguments.query." };
    const result = await searchMemoriesTool({ paths: options.paths, query, limit: numberArg(args.limit), approver: options.approver, policy: options.policy });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result: { query: result.query, memories: result.memories } };
  }

  if (options.request.tool === "internal.analyze_memories") {
    const mode = memoryAnalysisModeArg(args.mode);
    const result = await analyzeMemoriesTool({ paths: options.paths, mode, approver: options.approver, policy: options.policy });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result };
  }

  if (options.request.tool === "internal.plan_memory_hygiene") {
    const result = await planMemoryHygieneTool({ paths: options.paths, approver: options.approver, policy: options.policy });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result };
  }

  if (options.request.tool === "internal.plan_memory_rebalance") {
    const result = await planMemoryRebalanceTool({ paths: options.paths, approver: options.approver, policy: options.policy });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result };
  }

  if (options.request.tool === "internal.memory_hygiene_trend") {
    const result = await readMemoryHygieneTrendTool({ paths: options.paths, limit: numberArg(args.limit), approver: options.approver, policy: options.policy });
    return { ok: result.allowed, status: result.allowed ? "pass" : "fail", message: result.reason, result };
  }

  if (options.request.tool === "internal.add_cron_schedule") {
    return addCronScheduleTool(options.request.arguments, { config: options.config, paths: options.paths });
  }

  if (options.request.tool === "internal.list_cron_schedules") {
    return listCronSchedulesTool({ config: options.config, paths: options.paths });
  }

  if (options.request.tool === "internal.remove_cron_schedule") {
    return removeCronScheduleTool(options.request.arguments, { config: options.config, paths: options.paths });
  }

  if (options.request.tool === "internal.toggle_cron_schedule") {
    return toggleCronScheduleTool(options.request.arguments, { config: options.config, paths: options.paths });
  }

  return { ok: false, status: "fail", message: `Unsupported internal tool: ${options.request.tool}` };
}

export function isInternalToolName(value: string): value is InternalToolRequest["tool"] {
  return ["internal.read_file", "internal.read_many_files", "internal.read_markdown_bundle", "internal.list_files", "internal.search_files", "internal.read_logs", "internal.read_url", "internal.git_status", "internal.git_diff", "internal.git_log", "internal.mcp_list_servers", "internal.mcp_list_tools", "internal.mcp_discover_oauth", "internal.mcp_prepare_server_config", "internal.mcp_apply_server_config", "internal.write_file", "internal.edit_file", "internal.apply_patch", "internal.exec", "internal.list_processes", "internal.spawn_subagent", "internal.list_memories", "internal.search_memories", "internal.inspect_memory", "internal.analyze_memories", "internal.plan_memory_hygiene", "internal.plan_memory_rebalance", "internal.memory_hygiene_trend", "internal.remember_memory", "internal.delete_memory", "internal.cleanup_memories", "internal.supersede_memory", "internal.add_cron_schedule", "internal.list_cron_schedules", "internal.remove_cron_schedule", "internal.toggle_cron_schedule"].includes(value);
}

async function runSubagentTool(options: RunAgentToolRequestOptions, args: Record<string, unknown>): Promise<McpToolCallResult> {
  const task = stringArg(args.task)?.trim();
  if (!task) {
    return { ok: false, status: "fail", message: "internal.spawn_subagent requires arguments.task." };
  }
  if (Buffer.byteLength(task, "utf8") > MAX_SUBAGENT_TASK_BYTES) {
    return { ok: false, status: "fail", message: `Subagent task exceeds ${MAX_SUBAGENT_TASK_BYTES} bytes.` };
  }
  if (!options.chatCompletion || !options.apiKey) {
    return { ok: false, status: "fail", message: "internal.spawn_subagent requires chatCompletion and apiKey from the parent runtime." };
  }
  if ((options.subagentDepth ?? 0) >= 1) {
    return { ok: false, status: "fail", message: "Nested subagents are not supported." };
  }

  const permission = await reviewSubagentPermission(options, task);
  if (permission.decision !== "allow") {
    return { ok: false, status: "fail", message: `Subagent spawn denied: ${permission.reason}` };
  }

  const name = stringArg(args.name)?.trim() || "helper";
  const maxToolCalls = Math.min(Math.max(numberArg(args.maxToolCalls) ?? DEFAULT_MAX_SUBAGENT_TOOL_CALLS, 1), MAX_SUBAGENT_TOOL_CALLS);
  const systemMessage = [
    `You are a focused Bestie subagent named ${name}.`,
    "Work only on the delegated task. Use tools when needed, but do not spawn another subagent.",
    "Return a concise answer with evidence and any uncertainty. Do not address unrelated user requests.",
    options.runtimeContext ? `Parent runtime context:\n${options.runtimeContext}` : undefined,
  ].filter(Boolean).join("\n");
  const systemPrompt = buildMcpToolSystemPrompt(systemMessage, options.config, options.runtimeContext);

  const answer = await completeWithAgentTools({
    config: options.config,
    paths: options.paths,
    apiKey: options.apiKey,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: task },
    ],
    chatCompletion: options.chatCompletion,
    approver: options.approver,
    policy: options.policy,
    maxToolCalls,
    runtimeContext: options.runtimeContext,
    subagentDepth: (options.subagentDepth ?? 0) + 1,
  });

  return { ok: true, status: "pass", message: `Subagent ${name} completed.`, result: { name, task, answer } };
}

async function reviewSubagentPermission(options: RunAgentToolRequestOptions, task: string): Promise<{ decision: "allow" | "ask" | "deny"; reason: string }> {
  const configured = options.config.internalTools?.policies?.["internal.spawn_subagent"];
  if (configured === "deny") {
    return { decision: "deny", reason: "internal.spawn_subagent is denied by config." };
  }
  if (configured === "allow" || configured === undefined) {
    return { decision: "allow", reason: "internal.spawn_subagent is allowed by config." };
  }

  return reviewActionPermission(
    {
      category: "read",
      action: "internal.spawn_subagent",
      target: "subagent",
      reason: "Spawn a bounded helper agent requested by the agent.",
      trusted: false,
      payloadJson: JSON.stringify({ tool: "internal.spawn_subagent", arguments: { task } }),
    },
    { paths: options.paths, approver: options.approver, policy: options.policy },
  );
}

type McpServerConfig = NonNullable<AppConfig["mcp"]>["servers"][number];
interface McpAuthPlan {
  required: boolean;
  url?: string;
  envVarName?: string;
  headerName?: string;
  parameterName?: string;
  instructions: string[];
}

async function discoverMcpOauthTool(args: Record<string, unknown>): Promise<McpToolCallResult> {
  const url = stringArg(args.url)?.trim();
  if (!url) {
    return { ok: false, status: "fail", message: "internal.mcp_discover_oauth requires arguments.url." };
  }

  try {
    const result = await discoverOAuthServerInfo(url, { ...(stringArg(args.resourceMetadataUrl)?.trim() ? { resourceMetadataUrl: new URL(stringArg(args.resourceMetadataUrl)!.trim()) } : {}) });
    const metadata = result.authorizationServerMetadata;
    return {
      ok: true,
      status: metadata ? "pass" : "warn",
      message: metadata ? "Discovered MCP OAuth metadata." : "OAuth authorization server was inferred but metadata endpoints did not return token metadata.",
      result: {
        authorizationServerUrl: result.authorizationServerUrl,
        resource: result.resourceMetadata?.resource ?? url,
        scopes: result.resourceMetadata?.scopes_supported ?? metadata?.scopes_supported ?? [],
        authorizationUrl: metadata?.authorization_endpoint,
        tokenUrl: metadata?.token_endpoint,
        tokenEndpointAuthMethods: metadata?.token_endpoint_auth_methods_supported ?? [],
        resourceMetadataUrl: result.resourceMetadata ? stringArg(args.resourceMetadataUrl) ?? undefined : undefined,
      },
    };
  } catch (error) {
    return { ok: false, status: "fail", message: `MCP OAuth discovery failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function prepareMcpServerConfigTool(config: AppConfig, args: Record<string, unknown>): McpToolCallResult {
  const server = parseMcpServerConfigArgs(args);
  if (!server.ok) {
    return { ok: false, status: "fail", message: server.message };
  }

  const validation = validateMcpConfigProposal(config, server.server);
  if (!validation.ok) {
    return validation;
  }

  const auth = parseMcpAuthPlan(args, server.server);
  const existing = config.mcp?.servers.some((configured) => configured.name === server.server.name) ?? false;
  return {
    ok: true,
    status: "pass",
    message: `Prepared MCP server config for ${server.server.name}.`,
    result: {
      server: redactMcpServerConfig(server.server),
      auth,
      mode: existing ? "update" : "add",
      nextSteps: auth.required
        ? [
            "If auth.url came from bestie mcp login or already includes OAuth query params, reply with that complete URL and ask the user to authorize the MCP service.",
            "If you only have an OAuth authorization endpoint from metadata/config, apply the config first and run bestie mcp login; do not send the bare endpoint to the user.",
            "After the user sends the auth result, call internal.mcp_apply_server_config with authResult.",
            "Run internal.mcp_list_tools with connect=true after apply to verify discovery.",
          ]
        : [
            "Apply with internal.mcp_apply_server_config if the user asked to change config.",
            "Set any required env vars in .env or the service environment before connecting.",
            "Run internal.mcp_list_tools with connect=true after apply to verify discovery.",
          ],
    },
  };
}

async function applyMcpServerConfigTool(options: RunAgentToolRequestOptions, args: Record<string, unknown>): Promise<McpToolCallResult> {
  const rawServer = isRecord(args.server) ? args.server : args;
  const parsed = parseMcpServerConfigArgs(rawServer);
  if (!parsed.ok) {
    return { ok: false, status: "fail", message: parsed.message };
  }

  const authResult = parseMcpAuthResult(args.authResult);
  if (!authResult.ok) {
    return { ok: false, status: "fail", message: authResult.message };
  }

  const server = applyMcpAuthResult(parsed.server, authResult.result);
  const validation = validateMcpConfigProposal(options.config, server);
  if (!validation.ok) {
    return validation;
  }

  const mode = stringArg(args.mode) ?? "upsert";
  if (mode !== "upsert" && mode !== "add" && mode !== "replace") {
    return { ok: false, status: "fail", message: "internal.mcp_apply_server_config arguments.mode must be upsert, add, or replace." };
  }

  const nextServers = options.config.mcp?.servers ?? [];
  const existingIndex = nextServers.findIndex((configuredServer) => configuredServer.name === server.name);
  if (mode === "add" && existingIndex !== -1) {
    return { ok: false, status: "fail", message: `MCP server ${server.name} already exists; use mode upsert or replace.` };
  }
  if (mode === "replace" && existingIndex === -1) {
    return { ok: false, status: "fail", message: `MCP server ${server.name} does not exist; use mode upsert or add.` };
  }

  const config = {
    ...options.config,
    mcp: {
      servers: existingIndex === -1 ? [...nextServers, server] : nextServers.map((configuredServer, index) => (index === existingIndex ? server : configuredServer)),
    },
  } satisfies AppConfig;
  validateConfig(config);

  await writeConfig(config, options.paths);
  return { ok: true, status: "pass", message: `MCP server ${server.name} ${existingIndex === -1 ? "added" : "updated"}.`, result: { server: redactMcpServerConfig(server), auth: redactMcpAuthResult(authResult.result), configPath: options.paths.configPath } };
}

function validateMcpConfigProposal(config: AppConfig, server: McpServerConfig): McpToolCallResult {
  try {
    validateConfig({ ...config, mcp: { servers: [server] } });
    return { ok: true, status: "pass", message: "MCP server config is valid." };
  } catch (error) {
    return { ok: false, status: "fail", message: error instanceof Error ? error.message : "MCP server config is invalid." };
  }
}

function parseMcpAuthPlan(args: Record<string, unknown>, server: McpServerConfig): McpAuthPlan {
  const authUrl = stringArg(args.authUrl)?.trim();
  const authUrlCheck = validateMcpAuthUrl(authUrl);
  if (!authUrlCheck.ok) {
    return {
      required: true,
      envVarName: stringArg(args.authResultEnvVar)?.trim() ?? stringArg(args.authEnvVar)?.trim() ?? defaultMcpAuthEnvVarName(server.name),
      instructions: [authUrlCheck.message, "Do not return a bare OAuth authorization endpoint to the user. Apply config and run bestie mcp login to generate a full PKCE/state authorization URL, or continue discovery."],
    };
  }
  const envVarName = stringArg(args.authResultEnvVar)?.trim() ?? stringArg(args.authEnvVar)?.trim() ?? defaultMcpAuthEnvVarName(server.name);
  const headerName = stringArg(args.authHeaderName)?.trim();
  const parameterName = stringArg(args.authParameterName)?.trim();
  const hasConfiguredAuth = Object.keys(server.env ?? {}).length > 0 || Object.keys(server.headersEnv ?? {}).length > 0 || Object.keys(server.headers ?? {}).length > 0;
  const required = booleanArg(args.authRequired) ?? Boolean(authUrlCheck.url || !hasConfiguredAuth);

  if (!required) {
    return { required: false, instructions: ["No extra authorization handoff was requested for this MCP server."] };
  }

  return {
    required: true,
    ...(authUrlCheck.url ? { url: authUrlCheck.url } : {}),
    envVarName,
    ...(headerName ? { headerName } : {}),
    ...(parameterName ? { parameterName } : {}),
    instructions: [
      authUrlCheck.url ? "Send this full URL to the user only if it already includes the provider-required OAuth query parameters." : "Apply config and run bestie mcp login to generate the full authorization URL before asking the user to authorize.",
      `When the user returns the result, apply config with authResult.envVarName set to ${envVarName}.`,
      "Do not ask the user to paste secrets into normal chat when direct terminal/env entry is available; if they already provided a token, store only the env var reference in config.",
    ],
  };
}

function validateMcpAuthUrl(value: string | undefined): { ok: true; url?: string } | { ok: false; message: string } {
  if (!value) {
    return { ok: true };
  }

  if (/[<>{}\[\]]|\.\.\.|\bTODO\b|\bPLACEHOLDER\b/i.test(value)) {
    return { ok: false, message: "MCP authUrl contains a placeholder instead of a complete provider URL." };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, message: "MCP authUrl must be a valid HTTP(S) URL copied from provider docs or a tool result." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, message: "MCP authUrl must use http or https." };
  }

  const pathLooksLikeAuthorize = /(^|\/)authorize\/?$/i.test(parsed.pathname);
  const hasOAuthParameters = ["client_id", "response_type", "redirect_uri", "state", "code_challenge", "scope", "client"].some((name) => parsed.searchParams.has(name));
  if (pathLooksLikeAuthorize && !hasOAuthParameters) {
    return { ok: false, message: "MCP authUrl looks like an incomplete guessed /authorize endpoint; use only the full authorization URL returned by provider docs/tooling." };
  }

  return { ok: true, url: parsed.toString() };
}

function parseMcpAuthResult(value: unknown): { ok: true; result?: { envVarName: string; headerName?: string; parameterName?: string; value?: string } } | { ok: false; message: string } {
  if (value === undefined) {
    return { ok: true };
  }

  if (!isRecord(value)) {
    return { ok: false, message: "internal.mcp_apply_server_config authResult must be an object." };
  }

  const envVarName = stringArg(value.envVarName)?.trim();
  if (!envVarName) {
    return { ok: false, message: "internal.mcp_apply_server_config authResult.envVarName is required." };
  }

  const headerName = stringArg(value.headerName)?.trim();
  const parameterName = stringArg(value.parameterName)?.trim();
  const tokenValue = stringArg(value.value)?.trim() ?? stringArg(value.token)?.trim() ?? stringArg(value.authorization)?.trim();

  return {
    ok: true,
    result: {
      envVarName,
      ...(headerName ? { headerName } : {}),
      ...(parameterName ? { parameterName } : {}),
      ...(tokenValue ? { value: tokenValue } : {}),
    },
  };
}

function applyMcpAuthResult(server: McpServerConfig, authResult: { envVarName: string; headerName?: string; parameterName?: string; value?: string } | undefined): McpServerConfig {
  if (!authResult) {
    return server;
  }

  if (server.transport === "http" || server.transport === "streamable-http") {
    const headerName = authResult.headerName ?? "authorization";
    return { ...server, headersEnv: { ...(server.headersEnv ?? {}), [headerName]: authResult.envVarName } };
  }

  const envName = authResult.parameterName ?? authResult.envVarName;
  return { ...server, env: { ...(server.env ?? {}), [envName]: authResult.envVarName } };
}

function redactMcpAuthResult(authResult: { envVarName: string; headerName?: string; parameterName?: string; value?: string } | undefined): Record<string, string | boolean> | undefined {
  if (!authResult) {
    return undefined;
  }

  return {
    envVarName: authResult.envVarName,
    ...(authResult.headerName ? { headerName: authResult.headerName } : {}),
    ...(authResult.parameterName ? { parameterName: authResult.parameterName } : {}),
    valueProvided: Boolean(authResult.value),
  };
}

function defaultMcpAuthEnvVarName(serverName: string): string {
  const normalized = serverName.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase();
  return `${normalized || "MCP"}_AUTHORIZATION`;
}

function parseMcpServerConfigArgs(args: Record<string, unknown>): { ok: true; server: McpServerConfig } | { ok: false; message: string } {
  const name = stringArg(args.name)?.trim();
  if (!name) {
    return { ok: false, message: "MCP server name is required." };
  }

  const transport = stringArg(args.transport) ?? (stringArg(args.url) ? "http" : "stdio");
  const enabled = booleanArg(args.enabled) ?? true;
  const tools = parseMcpToolConfigArray(args.tools);
  if (!tools.ok) return tools;

  if (transport === "http" || transport === "streamable-http") {
    const url = stringArg(args.url)?.trim();
    if (!url) return { ok: false, message: "HTTP MCP server config requires url." };
    const headers = optionalStringRecordField(args.headers, "headers");
    if (!headers.ok) return headers;
    const headersEnv = optionalStringRecordField(args.headersEnv, "headersEnv");
    if (!headersEnv.ok) return headersEnv;
    const auth = parseMcpServerAuthConfig(args.auth);
    if (!auth.ok) return auth;
    return { ok: true, server: { name, enabled, transport, url, ...headers.field, ...headersEnv.field, ...auth.field, ...(tools.tools.length === 0 ? {} : { tools: tools.tools }) } };
  }

  if (transport === "stdio") {
    const command = stringArg(args.command)?.trim();
    if (!command) return { ok: false, message: "stdio MCP server config requires command." };
    const env = optionalStringRecordField(args.env, "env");
    if (!env.ok) return env;
    return { ok: true, server: { name, enabled, transport, command, ...(arrayOfStringsArg(args.args) === undefined ? {} : { args: arrayOfStringsArg(args.args) }), ...env.field, ...(tools.tools.length === 0 ? {} : { tools: tools.tools }) } };
  }

  return { ok: false, message: "MCP server transport must be http, streamable-http, or stdio." };
}

function parseMcpServerAuthConfig(value: unknown): { ok: true; field: { auth?: McpServerConfig["auth"] } } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, field: {} };
  if (!isRecord(value)) return { ok: false, message: "MCP server auth must be an object." };
  if (value.type !== "oauth") return { ok: false, message: "MCP server auth.type must be oauth." };

  const authorizationUrl = stringArg(value.authorizationUrl)?.trim();
  const clientId = stringArg(value.clientId)?.trim();
  const envVar = stringArg(value.envVar)?.trim();
  if (!authorizationUrl || !clientId || !envVar) {
    return { ok: false, message: "MCP oauth auth requires authorizationUrl, clientId, and envVar." };
  }

  return {
    ok: true,
    field: {
      auth: {
        type: "oauth",
        authorizationUrl,
        ...(stringArg(value.tokenUrl)?.trim() ? { tokenUrl: stringArg(value.tokenUrl)?.trim() } : {}),
        clientId,
        ...(arrayOfStringsArg(value.scopes) === undefined ? {} : { scopes: arrayOfStringsArg(value.scopes) }),
        ...(stringArg(value.redirectUri)?.trim() ? { redirectUri: stringArg(value.redirectUri)?.trim() } : {}),
        ...(stringArg(value.resource)?.trim() ? { resource: stringArg(value.resource)?.trim() } : {}),
        envVar,
        ...(stringArg(value.headerName)?.trim() ? { headerName: stringArg(value.headerName)?.trim() } : {}),
      },
    },
  };
}

function parseMcpToolConfigArray(value: unknown): { ok: true; tools: Array<{ name: string; category: McpToolCategory }> } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, tools: [] };
  if (!Array.isArray(value)) return { ok: false, message: "MCP server tools must be an array." };

  const tools: Array<{ name: string; category: McpToolCategory }> = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) return { ok: false, message: `MCP server tools[${index}] must be an object.` };
    const name = stringArg(item.name)?.trim();
    const category = stringArg(item.category);
    if (!name || !isMcpToolCategory(category)) return { ok: false, message: `MCP server tools[${index}] requires name and a valid category.` };
    tools.push({ name, category });
  }
  return { ok: true, tools };
}

function optionalStringRecordField(value: unknown, fieldName: "env" | "headers" | "headersEnv"): { ok: true; field: Record<string, Record<string, string>> } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, field: {} };
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== "string")) {
    return { ok: false, message: `MCP server ${fieldName} must be an object of string values.` };
  }
  return { ok: true, field: { [fieldName]: value as Record<string, string> } };
}

function redactMcpServerConfig(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    ...(server.env === undefined ? {} : { env: Object.fromEntries(Object.keys(server.env).sort().map((key) => [key, "<redacted>"])) }),
    ...(server.headers === undefined ? {} : { headers: Object.fromEntries(Object.keys(server.headers).sort().map((key) => [key, "<redacted>"])) }),
  };
}

function isMcpToolCategory(value: unknown): value is McpToolCategory {
  return typeof value === "string" && ["read", "local_write", "external_write", "public_action", "destructive", "money", "unknown"].includes(value);
}

async function deleteMemoryTool(options: RunAgentToolRequestOptions, args: Record<string, unknown>): Promise<McpToolCallResult> {
  const id = numberArg(args.id);
  const reason = stringArg(args.reason)?.trim();

  if (!id) {
    return { ok: false, status: "fail", message: "internal.delete_memory requires arguments.id." };
  }

  if (!reason) {
    return { ok: false, status: "fail", message: "internal.delete_memory requires arguments.reason." };
  }

  const permission = await reviewMemoryDeletePermission(options, "internal.delete_memory", `memory #${id}`, reason, { id, reason });
  if (permission.decision !== "allow") {
    return { ok: false, status: "fail", message: `Memory delete denied: ${permission.reason}` };
  }

  const store = await SqliteMemoryStore.open(options.paths);
  try {
    const deleted = store.forgetMemory(id);
    return { ok: deleted, status: deleted ? "pass" : "fail", message: deleted ? "Memory deleted." : "Active memory not found.", result: { id, deleted } };
  } finally {
    store.close();
  }
}

async function cleanupMemoriesTool(options: RunAgentToolRequestOptions, args: Record<string, unknown>): Promise<McpToolCallResult> {
  const ids = memoryIdsArg(args.ids);
  const reason = stringArg(args.reason)?.trim();

  if (ids.length === 0) {
    return { ok: false, status: "fail", message: "internal.cleanup_memories requires arguments.ids." };
  }

  if (!reason) {
    return { ok: false, status: "fail", message: "internal.cleanup_memories requires arguments.reason." };
  }

  const permission = await reviewMemoryDeletePermission(options, "internal.cleanup_memories", `${ids.length} memories`, reason, { ids, reason });
  if (permission.decision !== "allow") {
    return { ok: false, status: "fail", message: `Memory cleanup denied: ${permission.reason}` };
  }

  const store = await SqliteMemoryStore.open(options.paths);
  try {
    const deletedIds: number[] = [];
    const missingIds: number[] = [];

    for (const id of ids) {
      if (store.forgetMemory(id)) {
        deletedIds.push(id);
      } else {
        missingIds.push(id);
      }
    }

    return {
      ok: deletedIds.length > 0,
      status: deletedIds.length > 0 ? "pass" : "fail",
      message: `Deleted ${deletedIds.length} memory(s); ${missingIds.length} not found.`,
      result: { deletedIds, missingIds },
    };
  } finally {
    store.close();
  }
}

async function supersedeMemoryTool(options: RunAgentToolRequestOptions, args: Record<string, unknown>): Promise<McpToolCallResult> {
  const oldId = numberArg(args.oldId);
  const newId = numberArg(args.newId);
  const reason = stringArg(args.reason)?.trim();

  if (!oldId || !newId) {
    return { ok: false, status: "fail", message: "internal.supersede_memory requires arguments.oldId and arguments.newId." };
  }

  if (!reason) {
    return { ok: false, status: "fail", message: "internal.supersede_memory requires arguments.reason." };
  }

  const permission = await reviewMemoryDeletePermission(options, "internal.supersede_memory", `memory #${oldId} -> #${newId}`, reason, { oldId, newId, reason });
  if (permission.decision !== "allow") {
    return { ok: false, status: "fail", message: `Memory supersede denied: ${permission.reason}` };
  }

  const store = await SqliteMemoryStore.open(options.paths);
  try {
    const updated = store.supersedeMemory(oldId, newId);
    return { ok: updated !== undefined, status: updated ? "pass" : "fail", message: updated ? "Memory superseded." : "Could not supersede memory. Make sure both ids are active and different.", result: { oldId, newId, superseded: updated !== undefined } };
  } finally {
    store.close();
  }
}

async function reviewMemoryDeletePermission(
  options: RunAgentToolRequestOptions,
  toolName: "internal.delete_memory" | "internal.cleanup_memories" | "internal.supersede_memory",
  target: string,
  reason: string,
  payload: Record<string, unknown>,
): Promise<Awaited<ReturnType<typeof reviewActionPermission>>> {
  const configured = options.config.internalTools?.policies?.[toolName];
  if (configured === "deny") {
    return { decision: "deny", reason: `${toolName} is denied by config.` };
  }
  if (configured === "allow") {
    return { decision: "allow", reason: `${toolName} is allowed by config.` };
  }

  const deletePolicy = options.config.memory?.deletePolicy ?? "ask";
  if (deletePolicy === "deny") {
    return { decision: "deny", reason: "Memory deletes are disabled by config." };
  }
  if (deletePolicy === "allow") {
    return { decision: "allow", reason: "Memory delete policy allows this action." };
  }

  return reviewActionPermission(
    {
      category: "local_write",
      action: toolName,
      target,
      reason,
      trusted: false,
      payloadJson: JSON.stringify({ tool: toolName, arguments: payload }),
    },
    { paths: options.paths, approver: options.approver, policy: { allowTrustedRead: false, allowLocalWrite: false } },
  );
}

async function rememberMemoryTool(config: AppConfig, paths: RuntimePaths, args: Record<string, unknown>): Promise<McpToolCallResult> {
  const content = stringArg(args.content)?.trim();
  const type = stringArg(args.type) ?? "user_fact";

  if (!content) {
    return { ok: false, status: "fail", message: "internal.remember_memory requires arguments.content." };
  }

  if (!isMemoryType(type)) {
    return { ok: false, status: "fail", message: "internal.remember_memory arguments.type is invalid." };
  }

  const store = await SqliteMemoryStore.open(paths);
  try {
    if (store.getMemoryState().paused) {
      return { ok: false, status: "fail", message: "Memory is paused." };
    }

    const policy = evaluateMemoryCandidate({ type, content, explicitConsent: true });
    if (policy.decision === "never" || policy.sensitivity === "secret") {
      return { ok: false, status: "fail", message: policy.reason };
    }

    const writePolicy = config.memory?.writePolicy ?? "ask";
    if (writePolicy === "deny") {
      return { ok: false, status: "fail", message: "Memory writes are disabled by config." };
    }

    if (writePolicy === "allow") {
      const memory = store.addMemory({ type, content, sensitivity: policy.sensitivity, source: "agent-tool", explicitConsent: true, policyReason: policy.reason });
      return { ok: true, status: "pass", message: "Memory stored.", result: { id: memory.id, status: "stored" } };
    }

    const pending = store.addPendingMemory({ type, content, reason: policy.reason, source: "agent-tool", explicitConsent: true });
    return { ok: true, status: "pass", message: "Memory pending approval.", result: { id: pending.id, status: "pending" } };
  } finally {
    store.close();
  }
}

function isMemoryType(value: string): value is MemoryType {
  return ["preference", "communication_preference", "user_fact", "project_context", "durable_decision", "sensitive_personal", "one_off"].includes(value);
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberArg(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function memoryIdsArg(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((item): item is number => Number.isInteger(item) && item > 0))];
}

function memoryAnalysisModeArg(value: unknown): MemoryAnalysisMode | undefined {
  return value === "all" || value === "duplicates" || value === "stale" || value === "conflicts" ? value : undefined;
}

function booleanArg(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function arrayOfStringsArg(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
