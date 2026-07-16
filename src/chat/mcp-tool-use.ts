import { callMcpServerTool, listMcpServerTools, type McpToolCallResult } from "../mcp/connection.js";
import { findConfiguredMcpTool, findMcpServer, listMcpServers } from "../mcp/servers.js";
import type { AppConfig } from "../runtime/config.js";
import { loadEnvFile } from "../runtime/env.js";
import { appendLog } from "../runtime/logger.js";
import type { RuntimePaths } from "../runtime/paths.js";
import type { ChatCompletionOptions, ChatMessage } from "../llm/types.js";
import { reviewActionPermission, type PermissionApprover, type PermissionPolicy } from "../safety/permission-policy.js";
import { evaluateMemoryCandidate, type MemoryType } from "../memory/policy.js";
import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import { applyPatchTool, editLocalFileTool, execLocalTool, listProcessesTool, writeLocalFileTool } from "../tools/local-action-tools.js";
import { analyzeMemoriesTool, inspectMemoryTool, listActiveMemoriesTool, listLocalFilesTool, planMemoryHygieneTool, readGitDiffTool, readGitLogTool, readGitStatusTool, readLocalFileTool, readManyLocalFilesTool, readMarkdownBundleTool, readRecentAppLogsTool, searchLocalFilesTool, searchMemoriesTool, type MemoryAnalysisMode } from "../tools/local-read-tools.js";
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
}

export interface McpToolRequest {
  tool: "mcp.read";
  server: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface InternalToolRequest {
  tool: "internal.read_file" | "internal.read_many_files" | "internal.read_markdown_bundle" | "internal.list_files" | "internal.search_files" | "internal.read_logs" | "internal.read_url" | "internal.git_status" | "internal.git_diff" | "internal.git_log" | "internal.mcp_list_servers" | "internal.mcp_list_tools" | "internal.write_file" | "internal.edit_file" | "internal.apply_patch" | "internal.exec" | "internal.list_processes" | "internal.list_memories" | "internal.search_memories" | "internal.inspect_memory" | "internal.analyze_memories" | "internal.plan_memory_hygiene" | "internal.remember_memory" | "internal.delete_memory" | "internal.cleanup_memories" | "internal.supersede_memory" | "internal.add_cron_schedule" | "internal.list_cron_schedules" | "internal.remove_cron_schedule" | "internal.toggle_cron_schedule";
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
}

const DEFAULT_MAX_AGENT_TOOL_CALLS = 250;

export async function completeWithAgentTools(options: CompleteWithAgentToolsOptions): Promise<string> {
  const toolRunner = options.toolRunner ?? runAgentToolRequest;
  const maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_AGENT_TOOL_CALLS;
  const messages = [...options.messages, { role: "user" as const, content: buildAgentToolDecisionMessage() }];
  let assistantText = await options.chatCompletion(options.config, options.apiKey, { messages });

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
    const label = formatToolActivityLabel(decision.request);
    const startedAt = Date.now();
    await notifyToolActivity(options, { phase: "start", callIndex: toolCallCount + 1, toolName, label });
    let toolResult: McpToolCallResult;
    try {
      toolResult = await toolRunner({ config: options.config, paths: options.paths, request: decision.request, approver: options.approver, policy: options.policy });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      await notifyToolActivity(options, { phase: "finish", callIndex: toolCallCount + 1, toolName, label, ok: false, status: "fail", durationMs });
      throw error;
    }
    const durationMs = Date.now() - startedAt;
    await notifyToolActivity(options, { phase: "finish", callIndex: toolCallCount + 1, toolName, label, ok: toolResult.ok, status: toolResult.status, durationMs });
    messages.push({ role: "user", content: buildAgentToolResultMessage(toolName, toolResult) });
    assistantText = await options.chatCompletion(options.config, options.apiKey, { messages, stream: options.streamFinalResponse, onToken: options.onToken });
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

  return `Available internal tools:${contextSection}\n- internal.read_file {"path":"relative/or/allowed/absolute/path"}\n- internal.read_many_files {"paths":["README.md","docs/ARCHITECTURE.md"],"maxBytesPerFile":24576,"maxTotalBytes":163840}\n- internal.read_markdown_bundle {"path":".","limit":40,"maxBytesPerFile":24576,"maxTotalBytes":163840}\n- internal.list_files {"path":"optional/path","limit":50}\n- internal.search_files {"query":"*.log","path":"optional/path","limit":20}\n- internal.read_logs {"lines":40}\n- internal.read_url {"url":"https://example.com/mcp-docs","maxBytes":131072,"timeoutMs":10000}\n- internal.git_status {"path":"optional/repo/path"}\n- internal.git_diff {"path":"optional/repo/path","staged":false,"maxBytes":98304}\n- internal.git_log {"path":"optional/repo/path","limit":10}\n- internal.mcp_list_servers {}\n- internal.mcp_list_tools {"server":"server-name","connect":true}\n- internal.write_file {"path":"relative/path","content":"text","overwrite":false}\n- internal.edit_file {"path":"relative/path","oldText":"exact text","newText":"replacement","replaceAll":false}\n- internal.apply_patch {"patch":"git apply compatible patch"}\n- internal.exec {"command":"npm","args":["test"],"cwd":".","timeoutMs":30000}\n- internal.list_processes {"limit":20}\n- internal.list_memories {}\n- internal.search_memories {"query":"memory search text"}\n- internal.inspect_memory {"id":1}\n- internal.analyze_memories {"mode":"all|duplicates|stale|conflicts"}\n- internal.plan_memory_hygiene {}\n- internal.remember_memory {"type":"preference|communication_preference|user_fact|project_context|durable_decision|sensitive_personal","content":"durable memory to save"}
- internal.delete_memory {"id":1,"reason":"why this memory is stale, wrong, duplicate, or no longer useful"}
- internal.cleanup_memories {"ids":[1,2,3],"reason":"why these memories should be deleted"}
- internal.supersede_memory {"oldId":1,"newId":2,"reason":"why the old memory is replaced by the new memory"}
- internal.add_cron_schedule {"name":"job name","schedule_type":"interval|cron_expr|once","schedule_value":"30m | 0 8 * * * | 2026-12-25T08:00:00Z","prompt":"what to do when triggered","channel":"optional telegram:<userId>|zalo:<userId> destination for completion report"}
- internal.list_cron_schedules {}
- internal.remove_cron_schedule {"schedule_id":1}
- internal.toggle_cron_schedule {"schedule_id":1,"enabled":true}${mcpSection}\n\nTool selection guide:\n- Answer directly only when the request does not depend on local files, logs, repo contents, git state, HTTP(S) links, configured MCP data, MCP server discovery, or making a requested local change.\n- Approved local memories may already be included in the conversation as system context. Use that memory context directly when it answers the user; do not call memory tools just to rediscover information already shown there.\n- Use memory tools only when the included memory context is missing or insufficient, when the user explicitly asks to search/list/inspect memories, when saving a durable memory, or when cleaning stale/incorrect/duplicate memories: search_memories for a specific query, list_memories for a complete broad recall/list request, inspect_memory before risky governance changes, plan_memory_hygiene before applying broad cleanup, remember_memory for durable writes in any language, supersede_memory when one active memory clearly replaces another, delete_memory for one known stale memory id, cleanup_memories for multiple known stale memory ids. Prefer list_memories before deleting unless the user gave exact ids so cleanup can consider every active memory.\n- Use file tools for repo/local context: read_file for a known path, list_files to inspect a directory, search_files to discover likely paths, read_many_files for a small known set, read_markdown_bundle for repo/docs summaries. If the user asks you to edit a known config or project file, read the file if needed, then use edit_file/write_file/apply_patch; do not merely explain the edit unless the tool is denied or unavailable.\n- Generic list/search requests such as "list files" or internal.list_files with path "." inspect the agent workspace, defaulting to .bestie/workspace. Use an explicit project path such as "src", "docs", or an absolute project root path when the user asks to inspect repository files.\n- Relative read_file/read_many_files/read_markdown_bundle paths resolve from the project root. Relative write/edit/exec paths resolve from the agent workspace to avoid polluting the project root.\n- Absolute paths outside the project root and agent workspace are allowed only when covered by workspace.externalPaths in config.\n- Use read_logs only for recent runtime behavior, failures, diagnostics, or debugging questions.\n- Use read_url when the user gives an HTTP(S) link whose page content is needed, such as MCP setup docs, package pages, or install instructions; it obeys internalTools.policies and may require approval.\n- Use git tools for repository state questions: git_status for changed files, git_diff for current or staged patches, git_log for recent commits.\n- Use internal.mcp_list_servers when the user asks what MCP servers are configured or available. Use internal.mcp_list_tools when the user asks what a configured MCP server can do, or before claiming a remote MCP server has no tools.\n- Use write/edit/apply_patch/exec/process tools when the user asks you to change files, update config, run validation, commit changes, or inspect running processes; these tools obey internalTools.policies and may require approval.\n- Use configured MCP read tools only for external configured data that internal local tools cannot provide. If a server has discovered tools but no configured tool categories, explain that discovery works but tool execution still needs allowlisted categories.\n\nTool-use rule:\n- When asked for a tool decision, reply with exactly one JSON object and no extra text.\n- Use {"answer":"..."} only when no tool is needed by the selection guide.\n- If a listed tool is needed, reply with that executable tool JSON immediately and nothing else. Do not put prose before or after tool JSON.\n- After any empty, denied, or failed result, either try one clearly useful adjacent tool call or answer transparently that the data was not found/available. Do not invent missing facts.\n- Internal examples: {"tool":"internal.mcp_list_servers","arguments":{}} or {"tool":"internal.mcp_list_tools","arguments":{"server":"composio","connect":true}}\n- MCP example: {"tool":"mcp.read","server":"server-name","name":"tool-name","arguments":{}}\n- Do not invent shell command JSON, cmd fields, workdir fields, bash commands, sed, cat, rg, terminal actions, or non-git patch markers. Only the tool schemas above can be executed. internal.apply_patch requires a git apply compatible diff, not *** Begin Patch format.\n- The runtime can execute multiple tool calls in sequence, then show you each result so you can continue or answer the user.`;
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
  return `Tool result for ${toolName}: ${JSON.stringify({ ok: toolResult.ok, status: toolResult.status, message: toolResult.message, result: toolResult.result })}\n${guidance}\nTool decision required. Reply with exactly one JSON object and no extra text: either {"answer":"final answer text"} if the original user request is complete, or the next supported tool request if work remains. Do not describe a future action; execute it with a tool request.`;
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

  return "Ground the next step in this tool result. If the original user request still has required files, edits, commands, or other actions remaining, call the next needed tool instead of answering as if the task is complete. Do not add facts that are not supported by the result or prior conversation.";
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
  return ["internal.read_file", "internal.read_many_files", "internal.read_markdown_bundle", "internal.list_files", "internal.search_files", "internal.read_logs", "internal.read_url", "internal.git_status", "internal.git_diff", "internal.git_log", "internal.mcp_list_servers", "internal.mcp_list_tools", "internal.write_file", "internal.edit_file", "internal.apply_patch", "internal.exec", "internal.list_processes", "internal.list_memories", "internal.search_memories", "internal.inspect_memory", "internal.analyze_memories", "internal.plan_memory_hygiene", "internal.remember_memory", "internal.delete_memory", "internal.cleanup_memories", "internal.supersede_memory", "internal.add_cron_schedule", "internal.list_cron_schedules", "internal.remove_cron_schedule", "internal.toggle_cron_schedule"].includes(value);
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
