import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { loadConfig, writeConfig, type AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { buildAgentToolDecisionMessage, buildAgentToolResultMessage, buildMcpToolInstructions, buildMcpToolResultMessage, completeWithAgentTools, INTERNAL_TOOL_NAMES, parseAgentToolDecisionResult, parseMcpToolRequest, parseMcpToolRequestResult, runAgentToolRequest, runMcpToolRequest } from "./mcp-tool-use.js";

test("parseMcpToolRequest accepts plain and fenced read requests", () => {
  assert.deepEqual(parseMcpToolRequest('{"tool":"mcp.read","server":"fs","name":"read_file","arguments":{"path":"note.txt"}}'), {
    tool: "mcp.read",
    server: "fs",
    name: "read_file",
    arguments: { path: "note.txt" },
  });

  assert.deepEqual(parseMcpToolRequest('```json\n{"tool":"mcp.read","server":"fs","name":"list","arguments":{}}\n```'), {
    tool: "mcp.read",
    server: "fs",
    name: "list",
    arguments: {},
  });
});

test("buildMcpToolInstructions includes global tool selection guidance", () => {
  const instructions = buildMcpToolInstructions(createConfig()) ?? "";

  assert.match(instructions, /Tool selection guide/);
  assert.match(instructions, /Approved local memories and knowledge graph facts may already be included/);
  assert.match(instructions, /do not call memory or knowledge tools just to rediscover/);
  assert.match(instructions, /Use memory and knowledge tools only when the included context is missing or insufficient/);
  assert.match(instructions, /Prefer memory over knowledge graph for conversational continuity and user preferences/);
  assert.match(instructions, /Prefer knowledge graph for structured relationships/);
  assert.match(instructions, /Memory and knowledge write payload guidance/);
  assert.match(instructions, /one concise standalone memory per call/);
  assert.match(instructions, /Do not store chat transcripts, assistant acknowledgments, tool status/);
  assert.match(instructions, /store compact entities and relation facts with short evidence/);
  assert.match(instructions, /Do not create entities without a useful relation/);
  assert.match(instructions, /confidence below 0\.65/);
  assert.match(instructions, /Prefer scope "core" only for long-lived identity\/preferences/);
  assert.match(instructions, /Never store secrets, tokens, credentials/);
  assert.match(instructions, /internal\.search_knowledge/);
  assert.match(instructions, /internal\.analyze_knowledge/);
  assert.match(instructions, /internal\.plan_knowledge_review/);
  assert.match(instructions, /internal\.remember_knowledge/);
  assert.match(instructions, /User said they are building Bestie/);
  assert.match(instructions, /internal\.merge_knowledge_entities/);
  assert.match(instructions, /internal\.forget_knowledge_entity/);
  assert.match(instructions, /internal\.forget_knowledge_relation/);
  assert.match(instructions, /internal\.update_knowledge_relation/);
  assert.match(instructions, /Use file tools for repo\/local context/);
  assert.match(instructions, /Use read_logs only for recent runtime behavior/);
  assert.match(instructions, /internal\.git_status/);
  assert.match(instructions, /internal\.mcp_list_servers/);
  assert.match(instructions, /internal\.mcp_list_tools/);
  assert.match(instructions, /internal\.analyze_memories/);
  assert.match(instructions, /internal\.plan_memory_rebalance/);
  assert.match(instructions, /internal\.memory_hygiene_trend/);
  assert.match(instructions, /one durable standalone memory, not a transcript or assistant status/);
  assert.match(instructions, /If the user gives an MCP server link/);
  assert.match(instructions, /do the setup yourself through tools/);
  assert.match(instructions, /Do not tell the user to edit config\.json/);
  assert.match(instructions, /restart\/reload Bestie/);
  assert.match(instructions, /extract the real MCP endpoint\/client id/);
  assert.match(instructions, /OAuth metadata authorization_endpoint or config auth\.authorizationUrl is not a clickable user auth URL/);
  assert.match(instructions, /use only the generated login command output URL/);
  assert.match(instructions, /code_challenge/);
  assert.match(instructions, /core\/project\/session scopes need rebalancing/);
  assert.match(instructions, /creating or updating a cron schedule/);
  assert.match(instructions, /internal\.update_cron_schedule/);
  assert.match(instructions, /internal\.trigger_cron_schedule/);
  assert.match(instructions, /Use update_cron_schedule for changing an existing schedule/);
  assert.match(instructions, /Do not trigger a newly created schedule just to prove it exists/);
  assert.match(instructions, /Never store your current reply, a success message, the schedule ID, next_run_at/);
  assert.match(instructions, /Use git tools for repository state questions/);
  assert.match(instructions, /MCP server discovery/);
  assert.match(instructions, /Do not invent missing facts/);
  assert.match(instructions, /After any empty, denied, or failed result, still reply with exactly one JSON object/);
  assert.match(instructions, /do not merely explain the edit/);
  assert.doesNotMatch(instructions, /kling/i);
  assert.doesNotMatch(instructions, /KLING_/);
});

test("parseMcpToolRequest accepts knowledge relation review actions", () => {
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.forget_knowledge_entity","arguments":{"id":4,"reason":"wrong entity"}}'), {
    tool: "internal.forget_knowledge_entity",
    arguments: { id: 4, reason: "wrong entity" },
  });

  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.forget_knowledge_relation","arguments":{"id":4,"reason":"wrong relation"}}'), {
    tool: "internal.forget_knowledge_relation",
    arguments: { id: 4, reason: "wrong relation" },
  });

  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.update_knowledge_relation","arguments":{"id":4,"confidence":0.72,"reason":"reviewed evidence"}}'), {
    tool: "internal.update_knowledge_relation",
    arguments: { id: 4, confidence: 0.72, reason: "reviewed evidence" },
  });
});

test("buildMcpToolInstructions includes runtime channel context", () => {
  const instructions = buildMcpToolInstructions(createConfig(), 'Current channel: telegram. For cron reports, use "telegram:777".') ?? "";

  assert.match(instructions, /Runtime context/);
  assert.match(instructions, /telegram:777/);
  assert.match(instructions, /internal\.add_cron_schedule/);
});

test("buildMcpToolInstructions lists every supported internal tool", () => {
  const instructions = buildMcpToolInstructions(createConfig()) ?? "";

  for (const toolName of INTERNAL_TOOL_NAMES) {
    assert.match(instructions, new RegExp(`${toolName.replaceAll(".", "\\.")} `), `${toolName} should be documented in tool instructions`);
  }
});

test("buildAgentToolResultMessage guides empty and failed internal tool results", () => {
  const empty = buildAgentToolResultMessage("internal.search_memories", { ok: true, status: "pass", message: "ok", result: { query: "concise", memories: [] } });
  const failed = buildAgentToolResultMessage("internal.search_files", { ok: false, status: "fail", message: "Permission denied." });

  assert.match(empty, /Tool decision required/);
  assert.match(empty, /returned no matching data/);
  assert.match(empty, /Do not claim the data exists/);
  assert.match(empty, /one clearly useful adjacent search\/list tool request/);
  assert.match(empty, /do not answer in prose directly/);
  assert.match(failed, /did not succeed/);
  assert.match(failed, /Do not invent the missing data/);
  assert.match(failed, /one clearly useful adjacent tool request/);
  assert.match(failed, /use \{"answer":"\.\.\."\}/);
});

test("buildAgentToolResultMessage gives MCP-specific retry guidance", () => {
  const missingServer = buildAgentToolResultMessage("missing/read_file", { ok: false, status: "fail", message: "MCP server not found: missing" });
  const unlistedTool = buildAgentToolResultMessage("composio/search", { ok: false, status: "fail", message: "MCP tool composio/search is not configured in the local allowlist." });
  const badArgs = buildAgentToolResultMessage("composio/search", { ok: false, status: "fail", message: "MCP server composio failed: invalid arguments for search" });

  assert.match(missingServer, /internal\.mcp_list_servers/);
  assert.match(missingServer, /exact listed server\/tool name/);
  assert.match(unlistedTool, /internal\.mcp_list_tools/);
  assert.match(unlistedTool, /"server":"composio"/);
  assert.match(unlistedTool, /"connect":true/);
  assert.match(badArgs, /inspect the exact tool schema/);
  assert.match(badArgs, /Do not repeat the same failing request unchanged/);
});

test("buildAgentToolResultMessage explains blocked knowledge policy diagnostics", () => {
  const message = buildAgentToolResultMessage("internal.remember_knowledge", {
    ok: false,
    status: "fail",
    message: "Secrets, tokens, passwords, and payment details must never be stored in the knowledge graph.",
    result: { status: "blocked", diagnostics: { blockedBy: ["payment_card_like", "api_key_assignment"] } },
  });

  assert.match(message, /payment card details/);
  assert.match(message, /an API key field/);
  assert.match(message, /no knowledge graph fact was stored/);
  assert.match(message, /do not reveal or repeat the sensitive value/);
  assert.match(message, /sanitized evidence/);
});

test("buildToolResultMessage keeps path recovery and grounded answer guidance", () => {
  const missingPath = buildAgentToolResultMessage("internal.read_file", { ok: false, status: "fail", message: "Path does not exist.", result: { path: "missing.md" } });
  const mcpResult = buildMcpToolResultMessage("docs", "read", { ok: true, status: "pass", message: "ok", result: { content: "hello" } });

  assert.match(missingPath, /nearest existing parent directory/);
  assert.match(missingPath, /exactly one JSON object/);
  assert.match(missingPath, /return \{"answer":"\.\.\."\} explaining the missing path/);
  assert.match(mcpResult, /Ground the next step in this tool result/);
  assert.match(mcpResult, /return \{"answer":"\.\.\."\} now/);
  assert.match(mcpResult, /required files, edits, commands, or other actions remaining/);
});

test("parseMcpToolRequest accepts internal read tool requests", () => {
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.read_file","arguments":{"path":".bestie/logs/app.log"}}'), {
    tool: "internal.read_file",
    arguments: { path: ".bestie/logs/app.log" },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.read_many_files","arguments":{"paths":["README.md","PROJECT.md"]}}'), {
    tool: "internal.read_many_files",
    arguments: { paths: ["README.md", "PROJECT.md"] },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.read_markdown_bundle","arguments":{"path":".","limit":20}}'), {
    tool: "internal.read_markdown_bundle",
    arguments: { path: ".", limit: 20 },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.search_files","arguments":{"query":"*.log","path":"."}}'), {
    tool: "internal.search_files",
    arguments: { query: "*.log", path: "." },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.search_memories","arguments":{"query":"concise","limit":5}}'), {
    tool: "internal.search_memories",
    arguments: { query: "concise", limit: 5 },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.list_memories","arguments":{"limit":5}}'), {
    tool: "internal.list_memories",
    arguments: { limit: 5 },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.inspect_memory","arguments":{"id":1}}'), {
    tool: "internal.inspect_memory",
    arguments: { id: 1 },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.search_knowledge","arguments":{"query":"Bestie","limit":5}}'), {
    tool: "internal.search_knowledge",
    arguments: { query: "Bestie", limit: 5 },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.inspect_entity","arguments":{"id":1}}'), {
    tool: "internal.inspect_entity",
    arguments: { id: 1 },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.analyze_knowledge","arguments":{}}'), {
    tool: "internal.analyze_knowledge",
    arguments: {},
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.plan_knowledge_review","arguments":{"limit":5}}'), {
    tool: "internal.plan_knowledge_review",
    arguments: { limit: 5 },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.remember_knowledge","arguments":{"entities":[{"name":"Bestie","kind":"project"}]}}'), {
    tool: "internal.remember_knowledge",
    arguments: { entities: [{ name: "Bestie", kind: "project" }] },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.merge_knowledge_entities","arguments":{"primaryId":2,"duplicateId":3,"reason":"same project"}}'), {
    tool: "internal.merge_knowledge_entities",
    arguments: { primaryId: 2, duplicateId: 3, reason: "same project" },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.plan_memory_hygiene","arguments":{}}'), {
    tool: "internal.plan_memory_hygiene",
    arguments: {},
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.plan_memory_rebalance","arguments":{}}'), {
    tool: "internal.plan_memory_rebalance",
    arguments: {},
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.memory_hygiene_trend","arguments":{"limit":8}}'), {
    tool: "internal.memory_hygiene_trend",
    arguments: { limit: 8 },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.git_diff","arguments":{"staged":true}}'), {
    tool: "internal.git_diff",
    arguments: { staged: true },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.read_url","arguments":{"url":"https://example.com/mcp"}}'), {
    tool: "internal.read_url",
    arguments: { url: "https://example.com/mcp" },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.exec","arguments":{"command":"node","args":["--version"]}}'), {
    tool: "internal.exec",
    arguments: { command: "node", args: ["--version"] },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.remember_memory","arguments":{"type":"preference","content":"Prefers concise replies"}}'), {
    tool: "internal.remember_memory",
    arguments: { type: "preference", content: "Prefers concise replies" },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.delete_memory","arguments":{"id":1,"reason":"stale duplicate"}}'), {
    tool: "internal.delete_memory",
    arguments: { id: 1, reason: "stale duplicate" },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.cleanup_memories","arguments":{"ids":[1,2],"reason":"duplicate memories"}}'), {
    tool: "internal.cleanup_memories",
    arguments: { ids: [1, 2], reason: "duplicate memories" },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.supersede_memory","arguments":{"oldId":1,"newId":2,"reason":"newer memory replaces it"}}'), {
    tool: "internal.supersede_memory",
    arguments: { oldId: 1, newId: 2, reason: "newer memory replaces it" },
  });
  assert.deepEqual(parseMcpToolRequest('{"tool":"internal.spawn_subagent","arguments":{"task":"inspect docs","name":"docs"}}'), {
    tool: "internal.spawn_subagent",
    arguments: { task: "inspect docs", name: "docs" },
  });
});

test("parseMcpToolRequestResult accepts supported tool JSON mixed with prose", () => {
  const result = parseMcpToolRequestResult('Để review code, Miu cần xem qua src trước.\n\n{"tool":"internal.list_files","arguments":{"path":"src","limit":50}}');

  assert.deepEqual(result, { kind: "valid", request: { tool: "internal.list_files", arguments: { path: "src", limit: 50 } } });
});

test("parseMcpToolRequest rejects chatter and invalid tool requests", () => {
  assert.equal(parseMcpToolRequest("I'll read it later."), undefined);
  assert.equal(parseMcpToolRequest('{"tool":"mcp.write","server":"fs","name":"write","arguments":{}}'), undefined);
  assert.equal(parseMcpToolRequest('{"tool":"mcp.read","server":"fs","name":"read","arguments":[]}'), undefined);
});

test("parseMcpToolRequestResult flags invented shell command JSON as invalid", () => {
  const result = parseMcpToolRequestResult('{"cmd":"sed -n \'1,120p\' .bestie/logs/app.log","workdir":"."}');

  assert.equal(result.kind, "invalid");
  assert.match(result.kind === "invalid" ? result.message : "", /Shell command JSON/);
});

test("parseAgentToolDecisionResult rejects promised tool use without JSON", () => {
  const result = parseAgentToolDecisionResult("Tiếp theo Miu cần gọi tool đọc file đầu tiên. Bắt đầu từ README.md.");

  assert.equal(result.kind, "invalid");
  assert.match(result.kind === "invalid" ? result.message : "", /Tool decisions must be JSON/);
});

test("buildAgentToolDecisionMessage requires completed answers or tool execution", () => {
  const message = buildAgentToolDecisionMessage();

  assert.match(message, /Tool decision required/);
  assert.match(message, /if you can answer without tools/);
  assert.match(message, /Never reply with a plan to call a tool later/);
  assert.match(message, /Never put prose around tool JSON/);
  assert.match(message, /call the tool instead of describing the edit/);
});

test("parseAgentToolDecisionResult gives parse-error retry guidance for malformed tool JSON", () => {
  const result = parseAgentToolDecisionResult('{"tool":"internal.list_files","arguments":{"path":"src",}}');

  assert.equal(result.kind, "invalid");
  assert.match(result.kind === "invalid" ? result.message : "", /could not be parsed/);
  assert.match(result.kind === "invalid" ? result.message : "", /Retry with valid JSON/);
  assert.match(result.kind === "invalid" ? result.message : "", /no trailing commas/);
});

test("parseAgentToolDecisionResult accepts supported tool JSON mixed with prose", () => {
  const result = parseAgentToolDecisionResult('Đọc hết trước đã:\n\n{"tool":"internal.list_files","arguments":{"path":"src/channels","limit":50}}');

  assert.deepEqual(result, { kind: "tool", request: { tool: "internal.list_files", arguments: { path: "src/channels", limit: 50 } } });
});

test("parseMcpToolRequestResult allows normal final answers that mention tools", () => {
  const result = parseMcpToolRequestResult("Mình chưa chạy được shell JSON đó. Cần dùng MCP read tool đã classify nha.");

  assert.equal(result.kind, "none");
});

test("runMcpToolRequest enforces local read allowlist before calling MCP", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  let called = false;

  try {
    const missing = await runMcpToolRequest({
      config: createConfig(),
      paths,
      request: { tool: "mcp.read", server: "fs", name: "missing", arguments: {} },
      callTool: async () => {
        called = true;
        return { ok: true, status: "pass", message: "should not call" };
      },
    });

    assert.equal(missing.ok, false);
    assert.match(missing.message, /not configured/);
    assert.equal(called, false);

    const writeCategory = await runMcpToolRequest({
      config: createConfig({ tools: [{ name: "write_file", category: "local_write" }] }),
      paths,
      request: { tool: "mcp.read", server: "fs", name: "write_file", arguments: {} },
      callTool: async () => {
        called = true;
        return { ok: true, status: "pass", message: "should not call" };
      },
    });

    assert.equal(writeCategory.ok, false);
    assert.match(writeCategory.message, /only read tools/);
    assert.equal(called, false);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpToolRequest calls classified read MCP tools", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });

  try {
    const result = await runMcpToolRequest({
      config: createConfig({ tools: [{ name: "read_file", category: "read" }] }),
      paths,
      request: { tool: "mcp.read", server: "fs", name: "read_file", arguments: { path: "note.txt" } },
      callTool: async (_server, toolName, args) => ({ ok: true, status: "pass", message: `${toolName} ok`, result: args }),
    });

    assert.deepEqual(result, { ok: true, status: "pass", message: "read_file ok", result: { path: "note.txt" } });
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest runs internal read_file without MCP config", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });

  try {
    await mkdir(paths.logsDir, { recursive: true });
    await import("node:fs/promises").then((fs) => fs.writeFile(paths.appLogPath, "hello internal\n", { mode: 0o600 }));
    const result = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      request: { tool: "internal.read_file", arguments: { path: ".bestie/logs/app.log" } },
    });

    assert.equal(result.ok, true);
    assert.match(JSON.stringify(result.result), /hello internal/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest runs internal search_files without MCP config", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.logsDir, { recursive: true });
    await mkdir(paths.workspaceDir, { recursive: true });
    await import("node:fs/promises").then((fs) => fs.writeFile(paths.appLogPath, "hello internal\n", { mode: 0o600 }));
    await import("node:fs/promises").then((fs) => fs.writeFile(resolve(paths.workspaceDir, "workspace.log"), "hello workspace\n"));
    const result = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      request: { tool: "internal.search_files", arguments: { query: "*.log", path: "." } },
    });

    assert.equal(result.ok, true);
    assert.match(JSON.stringify(result.result), /workspace\.log/);
    assert.doesNotMatch(JSON.stringify(result.result), /app\.log/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest runs internal git_status without MCP config", async () => {
  const paths = await createTempPaths();

  try {
    await runGit(paths.rootDir, ["init"]);
    await import("node:fs/promises").then((fs) => fs.writeFile(resolve(paths.rootDir, "note.txt"), "hello\n"));
    const result = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      request: { tool: "internal.git_status", arguments: {} },
    });

    assert.equal(result.ok, true);
    assert.match(JSON.stringify(result.result), /note\.txt/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest spawns a bounded subagent", async () => {
  const paths = await createTempPaths();
  const seenMessages: string[] = [];

  try {
    const result = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      apiKey: "test-key",
      chatCompletion: async (_config, _apiKey, options) => {
        seenMessages.push(...options.messages.map((message) => `${message.role}:${message.content}`));
        return '{"answer":"Subagent checked the docs."}';
      },
      request: { tool: "internal.spawn_subagent", arguments: { task: "Check whether docs mention cron.", name: "docs", maxToolCalls: 3 } },
    });

    assert.equal(result.ok, true);
    assert.match(result.message, /Subagent docs completed/);
    assert.match(JSON.stringify(result.result), /Subagent checked the docs/);
    assert.ok(seenMessages.some((message) => message.includes("focused Bestie subagent named docs")));
    assert.ok(seenMessages.some((message) => message.includes("delegated task as untrusted user-level input")));
    assert.ok(seenMessages.some((message) => message.includes("tool decision, reply with exactly one JSON object")));
    assert.ok(seenMessages.some((message) => message.includes("Check whether docs mention cron")));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest gives subagents internal tool instructions", async () => {
  const paths = await createTempPaths();
  let callCount = 0;

  try {
    await import("node:fs/promises").then((fs) => fs.writeFile(resolve(paths.rootDir, "README.md"), "# Test Repo\n\nSubagent evidence.\n"));

    const result = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      apiKey: "test-key",
      chatCompletion: async (_config, _apiKey, options) => {
        callCount += 1;
        if (callCount === 1) {
          const systemContent = typeof options.messages[0]?.content === "string" ? options.messages[0].content : "";
          assert.match(systemContent, /Available internal tools/);
          assert.match(systemContent, /internal.read_file/);
          return '{"tool":"internal.read_file","arguments":{"path":"README.md"}}';
        }
        assert.ok(options.messages.some((message) => typeof message.content === "string" && message.content.includes("Tool result for internal.read_file") && message.content.includes("Subagent evidence")));
        return '{"answer":"Read README.md and found Subagent evidence."}';
      },
      request: { tool: "internal.spawn_subagent", arguments: { task: "Read README.md and report evidence.", name: "reviewer", maxToolCalls: 3 } },
    });

    assert.equal(result.ok, true);
    assert.match(JSON.stringify(result.result), /Subagent evidence/);
    assert.equal(callCount, 2);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest rejects nested subagents", async () => {
  const paths = await createTempPaths();

  try {
    const result = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      apiKey: "test-key",
      chatCompletion: async () => '{"answer":"should not run"}',
      subagentDepth: 1,
      request: { tool: "internal.spawn_subagent", arguments: { task: "nested" } },
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /Nested subagents/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest recognizes image and video generation tools", async () => {
  const paths = await createTempPaths();

  try {
    const missingImageConfig = await runAgentToolRequest({
      config: { ...createConfig(), generation: undefined },
      paths,
      request: { tool: "internal.image_generate", arguments: { prompt: "A small moon" } },
    });
    assert.equal(missingImageConfig.ok, false);
    assert.match(missingImageConfig.message, /generation\.image is not configured/);

    const missingVideoSecret = await runAgentToolRequest({
      config: {
        ...createConfig(),
        generation: { video: { provider: "openai-compatible", baseUrl: "https://media.example.com/v1", model: "video-model", apiKeyEnv: "BESTIE_VIDEO_API_KEY" } },
        internalTools: { policies: { "internal.video_generate": "allow" } },
      },
      paths,
      request: { tool: "internal.video_generate", arguments: { prompt: "A small wave" } },
    });
    assert.equal(missingVideoSecret.ok, false);
    assert.match(missingVideoSecret.message, /BESTIE_VIDEO_API_KEY is missing/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest runs git_status for an allowed external repo path", async () => {
  const paths = await createTempPaths();
  const externalRepo = await mkdtemp(resolve(tmpdir(), "bestie-external-git-"));

  try {
    await runGit(externalRepo, ["init"]);
    await import("node:fs/promises").then((fs) => fs.writeFile(resolve(externalRepo, "dog.txt"), "woof\n"));
    const result = await runAgentToolRequest({
      config: { ...createConfig(), workspace: { externalPaths: [externalRepo] }, mcp: undefined },
      paths,
      request: { tool: "internal.git_status", arguments: { path: externalRepo } },
    });

    assert.equal(result.ok, true);
    assert.match(JSON.stringify(result.result), /dog\.txt/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
    await rm(externalRepo, { recursive: true, force: true });
  }
});

test("runAgentToolRequest lists configured MCP servers and configured tools", async () => {
  const paths = await createTempPaths();
  const config = createConfig({ tools: [{ name: "read_file", category: "read" }] });

  try {
    const servers = await runAgentToolRequest({
      config,
      paths,
      request: { tool: "internal.mcp_list_servers", arguments: {} },
    });
    assert.equal(servers.ok, true);
    assert.match(JSON.stringify(servers.result), /"name":"fs"/);
    assert.match(JSON.stringify(servers.result), /"transport":"stdio"/);

    const tools = await runAgentToolRequest({
      config,
      paths,
      request: { tool: "internal.mcp_list_tools", arguments: { server: "fs", connect: false } },
    });
    assert.equal(tools.ok, true);
    assert.deepEqual(tools.result, { server: "fs", transport: "stdio", tools: [{ name: "read_file", category: "read" }], discovered: false });
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest discovers MCP OAuth metadata", async () => {
  const paths = await createTempPaths();
  const oauthServer = createServer((request: IncomingMessage, response: ServerResponse) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/resource-metadata") {
      response.end(JSON.stringify({ resource: "https://example.com/mcp", authorization_servers: [oauthOrigin], scopes_supported: ["read", "write"] }));
      return;
    }
    if (request.url === "/.well-known/oauth-authorization-server") {
      response.end(JSON.stringify({ issuer: oauthOrigin, authorization_endpoint: `${oauthOrigin}/authorize`, token_endpoint: `${oauthOrigin}/token`, response_types_supported: ["code"], scopes_supported: ["read", "write"] }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise<void>((resolve) => oauthServer.listen(0, "127.0.0.1", resolve));
  const address = oauthServer.address();
  assert(address && typeof address === "object");
  const oauthOrigin = `http://127.0.0.1:${address.port}`;

  try {
    await mkdir(paths.appDir, { recursive: true });
    const result = await runAgentToolRequest({
      config: createConfig(),
      paths,
      request: { tool: "internal.mcp_discover_oauth", arguments: { url: `${oauthOrigin}/mcp`, resourceMetadataUrl: `${oauthOrigin}/resource-metadata` } },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "pass");
    assert.deepEqual(result.result, {
      authorizationServerUrl: oauthOrigin,
      resource: "https://example.com/mcp",
      scopes: ["read", "write"],
      authorizationUrl: `${oauthOrigin}/authorize`,
      tokenUrl: `${oauthOrigin}/token`,
      tokenEndpointAuthMethods: [],
      resourceMetadataUrl: `${oauthOrigin}/resource-metadata`,
    });
  } finally {
    await new Promise<void>((resolve, reject) => oauthServer.close((error) => (error ? reject(error) : resolve())));
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest prepares and applies MCP server config", async () => {
  const paths = await createTempPaths();
  const baseConfig = { ...createConfig(), mcp: undefined };

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(baseConfig, paths);

    const prepared = await runAgentToolRequest({
      config: baseConfig,
      paths,
      request: {
        tool: "internal.mcp_prepare_server_config",
        arguments: {
          name: "kling",
          transport: "http",
          url: "https://kling.ai/mcp",
          headersEnv: { authorization: "KLING_MCP_AUTHORIZATION" },
          tools: [{ name: "generate_video", category: "external_write" }],
        },
      },
    });

    assert.equal(prepared.ok, true);
    assert.match(JSON.stringify(prepared.result), /KLING_MCP_AUTHORIZATION/);
    assert.doesNotMatch(JSON.stringify(prepared.result), /Bearer secret/);

    const applied = await runAgentToolRequest({
      config: baseConfig,
      paths,
      policy: { allowLocalWrite: true },
      request: {
        tool: "internal.mcp_apply_server_config",
        arguments: {
          server: {
            name: "kling",
            transport: "http",
            url: "https://kling.ai/mcp",
            headersEnv: { authorization: "KLING_MCP_AUTHORIZATION" },
            tools: [{ name: "generate_video", category: "external_write" }],
          },
          mode: "upsert",
        },
      },
    });

    assert.equal(applied.ok, true);
    const updatedConfig = await loadConfig(paths);
    assert.deepEqual(updatedConfig.mcp?.servers, [
      {
        name: "kling",
        enabled: true,
        transport: "http",
        url: "https://kling.ai/mcp",
        headersEnv: { authorization: "KLING_MCP_AUTHORIZATION" },
        tools: [{ name: "generate_video", category: "external_write" }],
      },
    ]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest prepares and applies OAuth streamable HTTP MCP server config", async () => {
  const paths = await createTempPaths();
  const baseConfig = { ...createConfig(), mcp: undefined };

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(baseConfig, paths);

    const prepared = await runAgentToolRequest({
      config: baseConfig,
      paths,
      request: {
        tool: "internal.mcp_prepare_server_config",
        arguments: {
          name: "kling",
          transport: "streamable-http",
          url: "https://kling.ai/mcp",
          auth: {
            type: "oauth",
            authorizationUrl: "https://kling.ai/oauth/authorize",
            clientId: "bestie-agent",
            scopes: ["video.create"],
            redirectUri: "http://127.0.0.1:8989/oauth/callback",
            resource: "https://kling.ai/mcp",
            envVar: "KLING_MCP_AUTHORIZATION",
            headerName: "authorization",
          },
        },
      },
    });

    assert.equal(prepared.ok, true);
    assert.match(JSON.stringify(prepared.result), /streamable-http/);
    assert.match(JSON.stringify(prepared.result), /KLING_MCP_AUTHORIZATION/);

    const applied = await runAgentToolRequest({
      config: baseConfig,
      paths,
      policy: { allowLocalWrite: true },
      request: {
        tool: "internal.mcp_apply_server_config",
        arguments: {
          server: {
            name: "kling",
            transport: "streamable-http",
            url: "https://kling.ai/mcp",
            auth: {
              type: "oauth",
              authorizationUrl: "https://kling.ai/oauth/authorize",
              clientId: "bestie-agent",
              scopes: ["video.create"],
              redirectUri: "http://127.0.0.1:8989/oauth/callback",
              resource: "https://kling.ai/mcp",
              envVar: "KLING_MCP_AUTHORIZATION",
              headerName: "authorization",
            },
          },
          mode: "upsert",
        },
      },
    });

    assert.equal(applied.ok, true);
    const updatedConfig = await loadConfig(paths);
    assert.deepEqual(updatedConfig.mcp?.servers, [
      {
        name: "kling",
        enabled: true,
        transport: "streamable-http",
        url: "https://kling.ai/mcp",
        auth: {
          type: "oauth",
          authorizationUrl: "https://kling.ai/oauth/authorize",
          clientId: "bestie-agent",
          scopes: ["video.create"],
          redirectUri: "http://127.0.0.1:8989/oauth/callback",
          resource: "https://kling.ai/mcp",
          envVar: "KLING_MCP_AUTHORIZATION",
          headerName: "authorization",
        },
      },
    ]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest exposes MCP auth URL then applies returned auth result", async () => {
  const paths = await createTempPaths();
  const baseConfig = { ...createConfig(), mcp: undefined };

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(baseConfig, paths);

    const prepared = await runAgentToolRequest({
      config: baseConfig,
      paths,
      request: {
        tool: "internal.mcp_prepare_server_config",
        arguments: {
          name: "kling",
          transport: "http",
          url: "https://kling.ai/mcp",
          authUrl: "https://kling.ai/mcp/authorize?client=bestie&redirect=urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob",
          authResultEnvVar: "KLING_MCP_AUTHORIZATION",
          authHeaderName: "authorization",
        },
      },
    });

    assert.equal(prepared.ok, true);
    assert.match(JSON.stringify(prepared.result), /"required":true/);
    assert.match(JSON.stringify(prepared.result), /https:\/\/kling\.ai\/mcp\/authorize\?client=bestie/);

    const applied = await runAgentToolRequest({
      config: baseConfig,
      paths,
      policy: { allowLocalWrite: true },
      request: {
        tool: "internal.mcp_apply_server_config",
        arguments: {
          server: { name: "kling", transport: "http", url: "https://kling.ai/mcp" },
          authResult: { envVarName: "KLING_MCP_AUTHORIZATION", headerName: "authorization", value: "Bearer secret-token" },
          mode: "upsert",
        },
      },
    });

    assert.equal(applied.ok, true);
    assert.doesNotMatch(JSON.stringify(applied.result), /secret-token/);
    const updatedConfig = await loadConfig(paths);
    assert.deepEqual(updatedConfig.mcp?.servers, [
      {
        name: "kling",
        enabled: true,
        transport: "http",
        url: "https://kling.ai/mcp",
        headersEnv: { authorization: "KLING_MCP_AUTHORIZATION" },
      },
    ]);
    assert.doesNotMatch(JSON.stringify(updatedConfig), /secret-token/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest rejects guessed incomplete MCP auth URLs", async () => {
  const paths = await createTempPaths();
  const baseConfig = { ...createConfig(), mcp: undefined };

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(baseConfig, paths);

    const prepared = await runAgentToolRequest({
      config: baseConfig,
      paths,
      request: {
        tool: "internal.mcp_prepare_server_config",
        arguments: {
          name: "kling",
          transport: "http",
          url: "https://kling.ai/mcp",
          authUrl: "https://kling.ai/mcp/authorize",
          authResultEnvVar: "KLING_MCP_AUTHORIZATION",
          authHeaderName: "authorization",
        },
      },
    });

    assert.equal(prepared.ok, true);
    assert.match(JSON.stringify(prepared.result), /"required":true/);
    assert.doesNotMatch(JSON.stringify(prepared.result), /"url":"https:\/\/kling\.ai\/mcp\/authorize"/);
    assert.match(JSON.stringify(prepared.result), /incomplete guessed \/authorize endpoint/);
    assert.match(JSON.stringify(prepared.result), /run bestie mcp login/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest always allows MCP config apply after validation", async () => {
  const paths = await createTempPaths();
  const baseConfig: AppConfig = { ...createConfig(), mcp: undefined, internalTools: { policies: { "internal.mcp_apply_server_config": "deny" } } };

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(baseConfig, paths);

    const applied = await runAgentToolRequest({
      config: baseConfig,
      paths,
      policy: { allowLocalWrite: false },
      approver: async () => {
        throw new Error("MCP config apply should not request approval");
      },
      request: {
        tool: "internal.mcp_apply_server_config",
        arguments: {
          server: { name: "kling", transport: "streamable-http", url: "https://kling.ai/mcp" },
          authResult: { envVarName: "KLING_MCP_AUTHORIZATION", headerName: "authorization", value: "Bearer secret-token" },
        },
      },
    });

    assert.equal(applied.ok, true);
    assert.doesNotMatch(JSON.stringify(applied.result), /secret-token/);
    const updatedConfig = await loadConfig(paths);
    assert.deepEqual(updatedConfig.mcp?.servers, [
      {
        name: "kling",
        enabled: true,
        transport: "streamable-http",
        url: "https://kling.ai/mcp",
        headersEnv: { authorization: "KLING_MCP_AUTHORIZATION" },
      },
    ]);
    assert.doesNotMatch(JSON.stringify(updatedConfig), /secret-token/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest runs policy-controlled write and exec tools", async () => {
  const paths = await createTempPaths();

  try {
    const denied = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined, internalTools: { policies: { "internal.write_file": "deny" } } },
      paths,
      request: { tool: "internal.write_file", arguments: { path: "note.txt", content: "hello\n" } },
    });
    assert.equal(denied.ok, false);
    assert.match(denied.message, /denied by config/);

    const written = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined, internalTools: { policies: { "internal.write_file": "allow" } } },
      paths,
      request: { tool: "internal.write_file", arguments: { path: "note.txt", content: "hello\n" } },
    });
    assert.equal(written.ok, true);

    const execResult = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined, internalTools: { policies: { "internal.exec": "allow" } } },
      paths,
      request: { tool: "internal.exec", arguments: { command: process.execPath, args: ["-e", "console.log('ok')"] } },
    });
    assert.equal(execResult.ok, true);
    assert.match(JSON.stringify(execResult.result), /ok/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest runs internal read_many_files without MCP config", async () => {
  const paths = await createTempPaths();

  try {
    await import("node:fs/promises").then((fs) => fs.writeFile(resolve(paths.rootDir, "README.md"), "hello readme\n"));
    await import("node:fs/promises").then((fs) => fs.writeFile(resolve(paths.rootDir, "PROJECT.md"), "hello project\n"));
    const result = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      request: { tool: "internal.read_many_files", arguments: { paths: ["README.md", "PROJECT.md"] } },
    });

    assert.equal(result.ok, true);
    assert.match(JSON.stringify(result.result), /hello readme/);
    assert.match(JSON.stringify(result.result), /hello project/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest runs internal read_markdown_bundle without MCP config", async () => {
  const paths = await createTempPaths();

  try {
    await import("node:fs/promises").then((fs) => fs.writeFile(resolve(paths.rootDir, "README.md"), "hello readme\n"));
    const result = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      request: { tool: "internal.read_markdown_bundle", arguments: { path: "." } },
    });

    assert.equal(result.ok, true);
    assert.match(JSON.stringify(result.result), /README\.md/);
    assert.match(JSON.stringify(result.result), /hello readme/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest follows memory write policy for remember_memory", async () => {
  const askPaths = await createTempPaths();
  const allowPaths = await createTempPaths();
  const denyPaths = await createTempPaths();

  try {
    const askResult = await runAgentToolRequest({
      config: { ...createConfig(), memory: { writePolicy: "ask" }, mcp: undefined },
      paths: askPaths,
      request: { tool: "internal.remember_memory", arguments: { type: "preference", content: "Prefers concise replies" } },
    });
    assert.deepEqual(askResult, { ok: true, status: "pass", message: "Memory pending approval.", result: { id: 1, status: "pending" } });

    const allowResult = await runAgentToolRequest({
      config: { ...createConfig(), memory: { writePolicy: "allow" }, mcp: undefined },
      paths: allowPaths,
      request: { tool: "internal.remember_memory", arguments: { type: "preference", content: "Prefers concise replies" } },
    });
    assert.deepEqual(allowResult, { ok: true, status: "pass", message: "Memory stored.", result: { id: 1, status: "stored" } });

    const denyResult = await runAgentToolRequest({
      config: { ...createConfig(), memory: { writePolicy: "deny" }, mcp: undefined },
      paths: denyPaths,
      request: { tool: "internal.remember_memory", arguments: { type: "preference", content: "Prefers concise replies" } },
    });
    assert.equal(denyResult.ok, false);
    assert.match(denyResult.message, /disabled by config/);
  } finally {
    await rm(askPaths.rootDir, { recursive: true, force: true });
    await rm(allowPaths.rootDir, { recursive: true, force: true });
    await rm(denyPaths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest follows memory write policy for remember_knowledge", async () => {
  const askPaths = await createTempPaths();
  const allowPaths = await createTempPaths();
  const denyPaths = await createTempPaths();
  const payload = {
    entities: [
      { name: "User", kind: "person" },
      { name: "Bestie", kind: "project", aliases: ["Bestie Agent"] },
    ],
    relations: [{ sourceName: "User", sourceKind: "person", type: "works_on", targetName: "Bestie", targetKind: "project", evidence: "User is building Bestie." }],
  };

  try {
    const askResult = await runAgentToolRequest({
      config: { ...createConfig(), memory: { writePolicy: "ask" }, mcp: undefined },
      paths: askPaths,
      request: { tool: "internal.remember_knowledge", arguments: payload },
    });
    assert.deepEqual(askResult, { ok: true, status: "pass", message: "Knowledge graph item pending approval.", result: { id: 1, status: "pending" } });

    const allowResult = await runAgentToolRequest({
      config: { ...createConfig(), memory: { writePolicy: "allow" }, mcp: undefined },
      paths: allowPaths,
      request: { tool: "internal.remember_knowledge", arguments: payload },
    });
    assert.deepEqual(allowResult, { ok: true, status: "pass", message: "Knowledge graph item stored.", result: { status: "stored", entityIds: [1, 2], relationIds: [1] } });

    const denyResult = await runAgentToolRequest({
      config: { ...createConfig(), memory: { writePolicy: "deny" }, mcp: undefined },
      paths: denyPaths,
      request: { tool: "internal.remember_knowledge", arguments: payload },
    });
    assert.equal(denyResult.ok, false);
    assert.match(denyResult.message, /disabled by config/);
  } finally {
    await rm(askPaths.rootDir, { recursive: true, force: true });
    await rm(allowPaths.rootDir, { recursive: true, force: true });
    await rm(denyPaths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest allows legal numeric evidence in remember_knowledge", async () => {
  const paths = await createTempPaths();

  try {
    const result = await runAgentToolRequest({
      config: { ...createConfig(), memory: { writePolicy: "allow" }, mcp: undefined },
      paths,
      request: {
        tool: "internal.remember_knowledge",
        arguments: {
          entities: [
            { name: "Nghị định 168/2024/NĐ-CP", kind: "concept" },
            { name: "Lỗi vượt đèn đỏ", kind: "concept" },
          ],
          relations: [{ sourceName: "Nghị định 168/2024/NĐ-CP", sourceKind: "concept", type: "sets_fine_for", targetName: "Lỗi vượt đèn đỏ", targetKind: "concept", evidence: "Điều 6 khoản 9 quy định mức phạt 18.000.000 - 20.000.000 đồng; văn bản số 168/2024/NĐ-CP có hiệu lực từ 01/01/2025.", confidence: 0.82 }],
        },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.message, "Knowledge graph item stored.");
    assert.deepEqual(result.result, { status: "stored", entityIds: [1, 2], relationIds: [1] });
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest blocks payment card evidence in remember_knowledge", async () => {
  const paths = await createTempPaths();

  try {
    const result = await runAgentToolRequest({
      config: { ...createConfig(), memory: { writePolicy: "allow" }, mcp: undefined },
      paths,
      request: {
        tool: "internal.remember_knowledge",
        arguments: {
          entities: [
            { name: "Payment note", kind: "concept" },
            { name: "User", kind: "person" },
          ],
          relations: [{ sourceName: "User", sourceKind: "person", type: "mentions", targetName: "Payment note", targetKind: "concept", evidence: "Card number 4111 1111 1111 1111 should never be stored." }],
        },
      },
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /payment details must never be stored/i);
    assert.deepEqual(result.result, { status: "blocked", diagnostics: { blockedBy: ["payment_card_like"] } });
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest returns knowledge policy diagnostics without echoing secret values", async () => {
  const paths = await createTempPaths();

  try {
    const result = await runAgentToolRequest({
      config: { ...createConfig(), memory: { writePolicy: "allow" }, mcp: undefined },
      paths,
      request: {
        tool: "internal.remember_knowledge",
        arguments: {
          entities: [{ name: "Integration credential", kind: "concept" }],
          relations: [{ sourceName: "Integration credential", sourceKind: "concept", type: "contains", targetName: "Token", targetKind: "concept", evidence: "api_key: sk-secret1234567890" }],
        },
      },
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.result, { status: "blocked", diagnostics: { blockedBy: ["api_key_assignment", "openai_key"] } });
    assert.doesNotMatch(JSON.stringify(result), /sk-secret1234567890/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest searches and inspects knowledge graph", async () => {
  const paths = await createTempPaths();

  try {
    const store = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      const user = store.upsertKnowledgeEntity({ canonicalName: "User", kind: "person" });
      const bestie = store.upsertKnowledgeEntity({ canonicalName: "Bestie", kind: "project" });
      store.upsertKnowledgeRelation({ sourceEntityId: user.id, relationType: "works_on", targetEntityId: bestie.id, evidence: "User is building Bestie." });
    } finally {
      store.close();
    }

    const search = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      request: { tool: "internal.search_knowledge", arguments: { query: "Bestie", limit: 10 } },
    });
    assert.equal(search.ok, true);
    assert.match(JSON.stringify(search.result), /Bestie/);
    assert.match(JSON.stringify(search.result), /works_on/);

    const inspect = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      request: { tool: "internal.inspect_entity", arguments: { id: 2 } },
    });
    assert.equal(inspect.ok, true);
    assert.match(JSON.stringify(inspect.result), /neighborhood/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest analyzes knowledge graph hygiene", async () => {
  const paths = await createTempPaths();

  try {
    const store = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      const user = store.upsertKnowledgeEntity({ canonicalName: "User", kind: "person" });
      const bestie = store.upsertKnowledgeEntity({ canonicalName: "Bestie", kind: "project", aliases: ["Bestie Agent"] });
      store.upsertKnowledgeEntity({ canonicalName: "bestie-agent", kind: "project" });
      store.upsertKnowledgeRelation({ sourceEntityId: user.id, relationType: "likes", targetEntityId: bestie.id });
      store.upsertKnowledgeRelation({ sourceEntityId: user.id, relationType: "dislikes", targetEntityId: bestie.id });
    } finally {
      store.close();
    }

    const result = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      request: { tool: "internal.analyze_knowledge", arguments: {} },
    });

    assert.equal(result.ok, true);
    assert.match(JSON.stringify(result.result), /mergeCandidates/);
    assert.match(JSON.stringify(result.result), /conflictingRelations/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest plans knowledge graph review suggestions", async () => {
  const paths = await createTempPaths();

  try {
    const store = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      store.upsertKnowledgeEntity({ canonicalName: "Bestie", kind: "project", aliases: ["Bestie Agent"] });
      store.upsertKnowledgeEntity({ canonicalName: "bestie-agent", kind: "project" });
    } finally {
      store.close();
    }

    const result = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      request: { tool: "internal.plan_knowledge_review", arguments: { limit: 1 } },
    });

    assert.equal(result.ok, true);
    assert.match(JSON.stringify(result.result), /merge_entity/);
    assert.match(JSON.stringify(result.result), /bestie memory graph merge entity/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest searches active memories", async () => {
  const paths = await createTempPaths();

  try {
    const store = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      store.addMemory({ type: "preference", content: "Prefers concise replies", importance: 4 });
      store.addMemory({ type: "project_context", content: "Working on Telegram MVP", importance: 5 });
    } finally {
      store.close();
    }

    const result = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      request: { tool: "internal.search_memories", arguments: { query: "concise", limit: 10 } },
    });

    assert.equal(result.ok, true);
    const payload = result.result as { query: string; memories: Array<{ id: number; type: string; content: string; sensitivity: string; importance: number; updatedAt: string }> };
    assert.equal(payload.query, "concise");
    assert.equal(payload.memories.length, 1);
    assert.deepEqual({ ...payload.memories[0], updatedAt: "<timestamp>" }, { id: 1, type: "preference", content: "Prefers concise replies", sensitivity: "normal", importance: 4, updatedAt: "<timestamp>" });
    assert.match(payload.memories[0].updatedAt, /\d{4}-\d{2}-\d{2}/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest lists active memories", async () => {
  const paths = await createTempPaths();

  try {
    const store = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      store.addMemory({ type: "preference", content: "Prefers concise replies", importance: 4 });
      store.addMemory({ type: "project_context", content: "Working on Telegram MVP", importance: 5 });
    } finally {
      store.close();
    }

    const result = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      request: { tool: "internal.list_memories", arguments: { limit: 1 } },
    });

    assert.equal(result.ok, true);
    const payload = result.result as { memories: Array<{ id: number; type: string; content: string; sensitivity: string; importance: number; updatedAt: string }> };
    assert.equal(payload.memories.length, 1);
    assert.deepEqual({ ...payload.memories[0], updatedAt: "<timestamp>" }, { id: 2, type: "project_context", content: "Working on Telegram MVP", sensitivity: "normal", importance: 5, updatedAt: "<timestamp>" });
    assert.match(payload.memories[0].updatedAt, /\d{4}-\d{2}-\d{2}/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest inspects an active memory", async () => {
  const paths = await createTempPaths();

  try {
    const store = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      store.addMemory({ type: "project_context", content: "Inspect via tool", scope: "session", pinned: true });
    } finally {
      store.close();
    }

    const result = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      request: { tool: "internal.inspect_memory", arguments: { id: 1 } },
    });

    assert.equal(result.ok, true);
    const payload = result.result as { memory: { id: number; content: string; scope: string; pinned: boolean; expiresAt?: string } };
    assert.equal(payload.memory.id, 1);
    assert.equal(payload.memory.content, "Inspect via tool");
    assert.equal(payload.memory.scope, "session");
    assert.equal(payload.memory.pinned, true);
    assert.ok(payload.memory.expiresAt);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest analyzes active memories", async () => {
  const paths = await createTempPaths();

  try {
    const store = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      store.addMemory({ type: "project_context", content: "Keep answers concise", importance: 4 });
      store.addMemory({ type: "project_context", content: "Keep answers concise", importance: 2 });
    } finally {
      store.close();
    }

    const result = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      request: { tool: "internal.analyze_memories", arguments: { mode: "duplicates" } },
    });

    assert.equal(result.ok, true);
    const payload = result.result as { duplicateGroups: Array<{ canonicalId: number; duplicateIds: number[] }>; staleMemories: unknown[]; conflictGroups: unknown[] };
    assert.deepEqual(payload.duplicateGroups, [{ canonicalId: 1, duplicateIds: [2], reason: "Same normalized memory content. Core-scope duplicates are review-only." }]);
    assert.deepEqual(payload.staleMemories, []);
    assert.deepEqual(payload.conflictGroups, []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest plans memory hygiene", async () => {
  const paths = await createTempPaths();

  try {
    const store = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      store.addMemory({ type: "project_context", content: "Duplicate hygiene tool", importance: 5 });
      store.addMemory({ type: "project_context", content: "Duplicate hygiene tool", importance: 1 });
      store.addMemory({ type: "project_context", content: "Expired hygiene tool", expiresAt: "2020-01-01T00:00:00.000Z" });
      store.addMemory({ type: "preference", content: "Use voice replies" });
      store.addMemory({ type: "preference", content: "Do not use voice replies" });
    } finally {
      store.close();
    }

    const result = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      request: { tool: "internal.plan_memory_hygiene", arguments: {} },
    });

    assert.equal(result.ok, true);
    const payload = result.result as { deleteIds: number[]; reviewOnlyIds: number[] };
    assert.deepEqual(payload.deleteIds, [2, 3]);
    assert.deepEqual(payload.reviewOnlyIds, [4, 5]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest plans memory rebalance", async () => {
  const paths = await createTempPaths();

  try {
    const store = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      store.addMemory({ type: "project_context", content: "Project scope drift", scope: "core" });
      store.addMemory({ type: "preference", content: "Already core" });
    } finally {
      store.close();
    }

    const result = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      request: { tool: "internal.plan_memory_rebalance", arguments: {} },
    });

    assert.equal(result.ok, true);
    const payload = result.result as { checked: number; nextCommand: string; recommendations: Array<{ id: number; currentScope: string; recommendedScope: string; reviewOnly: boolean }> };
    assert.equal(payload.checked, 2);
    assert.equal(payload.nextCommand, "bestie memory rebalance --apply --yes");
    assert.deepEqual(payload.recommendations, [{ id: 1, type: "project_context", currentScope: "core", recommendedScope: "project", reason: "project_context belongs in project so it can be separated from durable owner preferences.", reviewOnly: false }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest reads memory hygiene trend snapshots", async () => {
  const paths = await createTempPaths();

  try {
    const store = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      store.addMemoryHygieneSnapshot({ score: 73, label: "attention", checked: 9, deleteCandidates: 2, reviewOnly: 1, duplicateGroups: 1, staleMemories: 1, conflictGroups: 0, source: "test:first" });
      store.addMemoryHygieneSnapshot({ score: 86, label: "healthy", checked: 9, deleteCandidates: 0, reviewOnly: 1, duplicateGroups: 0, staleMemories: 0, conflictGroups: 0, source: "test:latest" });
    } finally {
      store.close();
    }

    const result = await runAgentToolRequest({
      config: { ...createConfig(), mcp: undefined },
      paths,
      request: { tool: "internal.memory_hygiene_trend", arguments: { limit: 8 } },
    });

    assert.equal(result.ok, true);
    const payload = result.result as { direction: string; delta: number; latest: { score: number }; baseline: { score: number }; snapshots: unknown[] };
    assert.equal(payload.direction, "up");
    assert.equal(payload.delta, 13);
    assert.equal(payload.latest.score, 86);
    assert.equal(payload.baseline.score, 73);
    assert.equal(payload.snapshots.length, 2);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest deletes an active memory when policy allows", async () => {
  const paths = await createTempPaths();

  try {
    const store = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      store.addMemory({ type: "preference", content: "Prefers obsolete replies", importance: 4 });
    } finally {
      store.close();
    }

    const result = await runAgentToolRequest({
      config: { ...createConfig(), memory: { deletePolicy: "allow" }, mcp: undefined },
      paths,
      request: { tool: "internal.delete_memory", arguments: { id: 1, reason: "obsolete memory" } },
    });

    assert.deepEqual(result, { ok: true, status: "pass", message: "Memory deleted.", result: { id: 1, deleted: true } });

    const verifyStore = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      assert.equal(verifyStore.getActiveMemory(1), undefined);
    } finally {
      verifyStore.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest blocks memory delete when delete policy denies", async () => {
  const paths = await createTempPaths();

  try {
    const store = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      store.addMemory({ type: "preference", content: "Keep this", importance: 4 });
    } finally {
      store.close();
    }

    const result = await runAgentToolRequest({
      config: { ...createConfig(), memory: { deletePolicy: "deny" }, mcp: undefined },
      paths,
      request: { tool: "internal.delete_memory", arguments: { id: 1, reason: "test deny policy" } },
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /Memory deletes are disabled by config/);

    const verifyStore = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      assert.equal(verifyStore.getActiveMemory(1)?.content, "Keep this");
    } finally {
      verifyStore.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest asks before cleanup when delete policy asks", async () => {
  const paths = await createTempPaths();

  try {
    const result = await runAgentToolRequest({
      config: { ...createConfig(), memory: { deletePolicy: "ask" }, mcp: undefined },
      paths,
      request: { tool: "internal.cleanup_memories", arguments: { ids: [1, 2], reason: "cleanup duplicates" } },
      approver: async (request, proposed) => {
        assert.equal(request.action, "internal.cleanup_memories");
        assert.equal(request.category, "local_write");
        assert.equal(request.payloadJson, JSON.stringify({ tool: "internal.cleanup_memories", arguments: { ids: [1, 2], reason: "cleanup duplicates" } }));
        assert.match(proposed.reason, /Local write actions require approval by default/);
        return { approved: false, reason: "recorded approval" };
      },
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /recorded approval/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest cleans multiple memories and reports missing ids", async () => {
  const paths = await createTempPaths();

  try {
    const store = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      store.addMemory({ type: "preference", content: "Duplicate concise preference", importance: 4 });
      store.addMemory({ type: "preference", content: "Duplicate concise preference again", importance: 4 });
      store.addMemory({ type: "project_context", content: "Keep this", importance: 5 });
    } finally {
      store.close();
    }

    const result = await runAgentToolRequest({
      config: { ...createConfig(), memory: { deletePolicy: "allow" }, mcp: undefined },
      paths,
      request: { tool: "internal.cleanup_memories", arguments: { ids: [1, 2, 999, 2], reason: "deduplicate stale memories" } },
    });

    assert.deepEqual(result, { ok: true, status: "pass", message: "Deleted 2 memory(s); 1 not found.", result: { deletedIds: [1, 2], missingIds: [999] } });

    const verifyStore = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      assert.equal(verifyStore.getActiveMemory(1), undefined);
      assert.equal(verifyStore.getActiveMemory(2), undefined);
      assert.equal(verifyStore.getActiveMemory(3)?.content, "Keep this");
    } finally {
      verifyStore.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest supersedes an active memory when policy allows", async () => {
  const paths = await createTempPaths();

  try {
    const store = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      store.addMemory({ type: "project_context", content: "Old project detail" });
      store.addMemory({ type: "project_context", content: "New project detail" });
    } finally {
      store.close();
    }

    const result = await runAgentToolRequest({
      config: { ...createConfig(), memory: { deletePolicy: "allow" }, mcp: undefined },
      paths,
      request: { tool: "internal.supersede_memory", arguments: { oldId: 1, newId: 2, reason: "new project detail replaces old detail" } },
    });

    assert.deepEqual(result, { ok: true, status: "pass", message: "Memory superseded.", result: { oldId: 1, newId: 2, superseded: true } });

    const verifyStore = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      assert.equal(verifyStore.getActiveMemory(1)?.supersededBy, 2);
    } finally {
      verifyStore.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest blocks memory supersede when delete policy denies", async () => {
  const paths = await createTempPaths();

  try {
    const result = await runAgentToolRequest({
      config: { ...createConfig(), memory: { deletePolicy: "deny" }, mcp: undefined },
      paths,
      request: { tool: "internal.supersede_memory", arguments: { oldId: 1, newId: 2, reason: "test deny policy" } },
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /Memory deletes are disabled by config/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest merges knowledge entities when policy allows", async () => {
  const paths = await createTempPaths();

  try {
    const store = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      const user = store.upsertKnowledgeEntity({ canonicalName: "User", kind: "person" });
      const bestie = store.upsertKnowledgeEntity({ canonicalName: "Bestie", kind: "project", aliases: ["Bestie Agent"] });
      const duplicate = store.upsertKnowledgeEntity({ canonicalName: "bestie-agent", kind: "project" });
      store.upsertKnowledgeRelation({ sourceEntityId: user.id, relationType: "works_on", targetEntityId: duplicate.id });
    } finally {
      store.close();
    }

    const result = await runAgentToolRequest({
      config: { ...createConfig(), memory: { deletePolicy: "allow" }, mcp: undefined },
      paths,
      request: { tool: "internal.merge_knowledge_entities", arguments: { primaryId: 2, duplicateId: 3, reason: "same project alias" } },
    });

    assert.equal(result.ok, true);
    assert.equal(result.message, "Knowledge entities merged.");
    assert.match(JSON.stringify(result.result), /bestie-agent/);

    const verifyStore = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      assert.equal(verifyStore.getKnowledgeEntity(3), undefined);
      assert.equal(verifyStore.searchKnowledgeGraph("works_on").relations[0]?.targetEntityId, 2);
    } finally {
      verifyStore.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest updates and forgets knowledge relations when policy allows", async () => {
  const paths = await createTempPaths();

  try {
    const store = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      const user = store.upsertKnowledgeEntity({ canonicalName: "User", kind: "person" });
      const bestie = store.upsertKnowledgeEntity({ canonicalName: "Bestie", kind: "project" });
      store.upsertKnowledgeRelation({ sourceEntityId: user.id, relationType: "works_on", targetEntityId: bestie.id, evidence: "Initial evidence.", confidence: 0.4 });
    } finally {
      store.close();
    }

    const updated = await runAgentToolRequest({
      config: { ...createConfig(), memory: { deletePolicy: "allow" }, mcp: undefined },
      paths,
      request: { tool: "internal.update_knowledge_relation", arguments: { id: 1, evidence: "Reviewed evidence.", confidence: 0.72, scope: "project", sensitivity: "sensitive", reason: "reviewed relation metadata" } },
    });

    assert.equal(updated.ok, true);
    assert.equal(updated.message, "Knowledge relation updated.");
    assert.match(JSON.stringify(updated.result), /Reviewed evidence/);

    const forgot = await runAgentToolRequest({
      config: { ...createConfig(), memory: { deletePolicy: "allow" }, mcp: undefined },
      paths,
      request: { tool: "internal.forget_knowledge_relation", arguments: { id: 1, reason: "wrong relation" } },
    });

    assert.deepEqual(forgot.result, { id: 1, deleted: true });

    const forgotEntity = await runAgentToolRequest({
      config: { ...createConfig(), memory: { deletePolicy: "allow" }, mcp: undefined },
      paths,
      request: { tool: "internal.forget_knowledge_entity", arguments: { id: 1, reason: "wrong entity" } },
    });

    assert.deepEqual(forgotEntity.result, { id: 1, deleted: true });

    const verifyStore = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      assert.deepEqual(verifyStore.listKnowledgeRelations(), []);
      assert.equal(verifyStore.getKnowledgeEntity(1), undefined);
    } finally {
      verifyStore.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest asks before merging knowledge entities when policy asks", async () => {
  const paths = await createTempPaths();

  try {
    const result = await runAgentToolRequest({
      config: { ...createConfig(), memory: { deletePolicy: "ask" }, mcp: undefined },
      paths,
      request: { tool: "internal.merge_knowledge_entities", arguments: { primaryId: 2, duplicateId: 3, reason: "same project alias" } },
      approver: async (request, proposed) => {
        assert.equal(request.action, "internal.merge_knowledge_entities");
        assert.equal(request.category, "local_write");
        assert.equal(request.payloadJson, JSON.stringify({ tool: "internal.merge_knowledge_entities", arguments: { primaryId: 2, duplicateId: 3, reason: "same project alias" } }));
        assert.match(proposed.reason, /Local write actions require approval by default/);
        return { approved: false, reason: "recorded graph merge approval" };
      },
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /recorded graph merge approval/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest asks before updating knowledge relations when policy asks", async () => {
  const paths = await createTempPaths();

  try {
    const result = await runAgentToolRequest({
      config: { ...createConfig(), memory: { deletePolicy: "ask" }, mcp: undefined },
      paths,
      request: { tool: "internal.update_knowledge_relation", arguments: { id: 4, confidence: 0.72, reason: "reviewed evidence" } },
      approver: async (request, proposed) => {
        assert.equal(request.action, "internal.update_knowledge_relation");
        assert.equal(request.category, "local_write");
        assert.equal(request.payloadJson, JSON.stringify({ tool: "internal.update_knowledge_relation", arguments: { id: 4, reason: "reviewed evidence", confidence: 0.72 } }));
        assert.match(proposed.reason, /Local write actions require approval by default/);
        return { approved: false, reason: "recorded relation update approval" };
      },
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /recorded relation update approval/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runAgentToolRequest blocks knowledge entity merge when delete policy denies", async () => {
  const paths = await createTempPaths();

  try {
    const result = await runAgentToolRequest({
      config: { ...createConfig(), memory: { deletePolicy: "deny" }, mcp: undefined },
      paths,
      request: { tool: "internal.merge_knowledge_entities", arguments: { primaryId: 2, duplicateId: 3, reason: "same project alias" } },
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /Knowledge graph write actions are disabled by memory\.deletePolicy/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools lets the model save memory through remember_memory", async () => {
  const paths = await createTempPaths();

  try {
    const answer = await completeWithAgentTools({
      config: { ...createConfig(), memory: { writePolicy: "ask" } },
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "จำไว้ว่าฉันชอบคำตอบสั้น ๆ" }],
      chatCompletion: async (_config, _apiKey, options) => {
        return options.messages.length === 2
          ? '{"tool":"internal.remember_memory","arguments":{"type":"preference","content":"Prefers concise replies"}}'
              : '{"answer":"Memory approval is ready."}';
      },
    });

            assert.equal(answer, "Memory approval is ready.");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools forwards final streaming options after tool calls", async () => {
  const paths = await createTempPaths();
  const chunks: string[] = [];

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "read docs" }],
      streamFinalResponse: true,
      onToken: (token) => chunks.push(token),
      chatCompletion: async (_config, _apiKey, options) => {
        if (options.messages.length === 2) {
          assert.equal(options.stream, undefined);
          assert.equal(options.onToken, undefined);
          return '{"tool":"internal.read_file","arguments":{"path":"README.md"}}';
        }

        assert.equal(options.stream, true);
        assert.equal(typeof options.onToken, "function");
        options.onToken?.("Docs ");
        options.onToken?.("say hello.");
        return '{"answer":"Docs say hello."}';
      },
      toolRunner: async () => ({ ok: true, status: "pass", message: "read", result: { content: "hello" } }),
    });

    assert.equal(answer, "Docs say hello.");
    assert.deepEqual(chunks, ["Docs ", "say hello."]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools does not append raw JSON final answers to caller messages", async () => {
  const paths = await createTempPaths();

  try {
    const callerMessages = [{ role: "user" as const, content: "hello" }];
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: callerMessages,
      chatCompletion: async () => '{"answer":"Xin chao"}',
      toolRunner: async () => {
        throw new Error("should not call tools");
      },
    });

    assert.equal(answer, "Xin chao");
    assert.deepEqual(callerMessages, [{ role: "user", content: "hello" }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools accepts plain final answers after invalid tool JSON repair", async () => {
  const paths = await createTempPaths();
  const requests: unknown[] = [];

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "read logs" }],
      chatCompletion: async (_config, _apiKey, options) => {
        requests.push(options.messages);
        return requests.length === 1
          ? '{"cmd":"sed -n 1,120p .bestie/logs/app.log","workdir":"."}'
          : "Mình chưa chạy được shell JSON đó. Gửi bằng MCP read schema nha.";
      },
      toolRunner: async () => {
        throw new Error("should not call tools");
      },
    });

    assert.equal(answer, "Mình chưa chạy được shell JSON đó. Gửi bằng MCP read schema nha.");
    assert.equal(requests.length, 2);
    assert.match(JSON.stringify(requests[1]), /not an executable tool-loop decision/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools lets the model search memories before answering", async () => {
  const paths = await createTempPaths();

  try {
    const store = await import("../memory/sqlite-store.js").then(({ SqliteMemoryStore }) => SqliteMemoryStore.open(paths));
    try {
      store.addMemory({ type: "preference", content: "Prefers concise replies", importance: 4 });
    } finally {
      store.close();
    }

    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "Mình thích kiểu trả lời nào?" }],
      chatCompletion: async (_config, _apiKey, options) => {
        return options.messages.length === 2
          ? '{"tool":"internal.search_memories","arguments":{"query":"trả lời concise replies","limit":5}}'
          : '{"answer":"Bạn thích câu trả lời ngắn gọn."}';
      },
    });

    assert.equal(answer, "Bạn thích câu trả lời ngắn gọn.");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools supports multiple internal tool calls before final answer", async () => {
  const paths = await createTempPaths();
  const requests: unknown[] = [];
  const toolRequests: unknown[] = [];
  const activities: unknown[] = [];

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "summarize docs" }],
      chatCompletion: async (_config, apiKey, options) => {
        assert.equal(apiKey, "test-key");
        requests.push(options.messages);
        if (requests.length === 1) {
          return '{"tool":"internal.search_files","arguments":{"query":"*.md","path":"docs"}}';
        }
        if (requests.length === 2) {
          return '{"tool":"internal.read_file","arguments":{"path":"docs/README.md"}}';
        }
        return '{"answer":"Docs say hello."}';
      },
      toolRunner: async (options) => {
        toolRequests.push(options.request);
        return options.request.tool === "internal.search_files"
          ? { ok: true, status: "pass", message: "found", result: { matches: [{ path: "docs/README.md", type: "file" }] } }
          : { ok: true, status: "pass", message: "read", result: { content: "hello" } };
      },
      onToolActivity: (activity) => {
        activities.push(activity);
      },
    });

    assert.equal(answer, "Docs say hello.");
    assert.deepEqual(toolRequests, [
      { tool: "internal.search_files", arguments: { query: "*.md", path: "docs" } },
      { tool: "internal.read_file", arguments: { path: "docs/README.md" } },
    ]);
    assert.equal(requests.length, 3);
    assert.match(JSON.stringify(requests[2]), /Tool result for internal.read_file/);
    assert.deepEqual(
      activities.map((activity) => ({ phase: (activity as { phase: string }).phase, label: (activity as { label: string }).label })),
      [
        { phase: "start", label: "*.md in docs" },
        { phase: "finish", label: "*.md in docs" },
        { phase: "start", label: "docs/README.md" },
        { phase: "finish", label: "docs/README.md" },
      ],
    );
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools lets the model spawn a subagent before answering", async () => {
  const paths = await createTempPaths();
  const parentToolResults: string[] = [];

  try {
    const answer = await completeWithAgentTools({
      config: { ...createConfig(), mcp: undefined },
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "Audit docs quickly." }],
      chatCompletion: async (_config, _apiKey, options) => {
        const combined = options.messages.map((message) => message.content).join("\n");
        if (combined.includes("focused Bestie subagent named docs")) {
          return '{"answer":"Docs mention cron and service."}';
        }
        if (combined.includes("Tool result for internal.spawn_subagent")) {
          parentToolResults.push(combined);
          return '{"answer":"Subagent found docs mention cron and service."}';
        }
        return '{"tool":"internal.spawn_subagent","arguments":{"task":"Check docs for cron and service status.","name":"docs","maxToolCalls":3}}';
      },
    });

    assert.equal(answer, "Subagent found docs mention cron and service.");
    assert.equal(parentToolResults.length, 1);
    assert.match(parentToolResults[0], /Docs mention cron and service/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools reloads config after successful tool calls", async () => {
  const paths = await createTempPaths();
  const baseConfig = { ...createConfig(), mcp: { servers: [] } };
  const seenServerCounts: number[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(baseConfig, paths);

    const answer = await completeWithAgentTools({
      config: baseConfig,
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "configure MCP then list it" }],
      chatCompletion: async (_config, _apiKey, options) => {
        if (options.messages.length === 2) return '{"tool":"internal.exec","arguments":{"command":"bestie","args":["mcp","add","kling","--url","https://kling.ai/mcp"]}}';
        if (options.messages.length === 4) return '{"tool":"internal.mcp_list_servers","arguments":{}}';
        return '{"answer":"config refreshed"}';
      },
      toolRunner: async (options) => {
        seenServerCounts.push(options.config.mcp?.servers.length ?? 0);
        if (options.request.tool === "internal.exec") {
          await writeConfig({ ...baseConfig, mcp: { servers: [{ name: "kling", enabled: true, transport: "streamable-http", url: "https://kling.ai/mcp" }] } }, paths);
          return { ok: true, status: "pass", message: "MCP server kling saved." };
        }
        return { ok: true, status: "pass", message: "listed", result: { servers: options.config.mcp?.servers ?? [] } };
      },
    });

    assert.equal(answer, "config refreshed");
    assert.deepEqual(seenServerCounts, [0, 1]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools keeps writing until all requested files are created", async () => {
  const paths = await createTempPaths();
  const requests: unknown[] = [];
  const toolRequests: unknown[] = [];
  const responses = [
    '{"tool":"internal.write_file","arguments":{"path":"1.txt","content":"one\\n","overwrite":false}}',
    '{"tool":"internal.write_file","arguments":{"path":"2.txt","content":"two\\n","overwrite":false}}',
    '{"tool":"internal.write_file","arguments":{"path":"3.txt","content":"three\\n","overwrite":false}}',
    '{"answer":"Đã tạo đủ 3 files ở root dir."}',
  ];

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "tạo cho tao lần lượt 3 files 1.txt, 2.txt, 3.txt với nội dung bất kỳ lưu ở root dir" }],
      chatCompletion: async (_config, _apiKey, options) => {
        requests.push(options.messages);
        if (requests.length === 2) {
          assert.match(String(options.messages.at(-1)?.content ?? ""), /required files, edits, commands, or other actions remaining/);
        }
        return responses.shift() ?? '{"answer":"done"}';
      },
      toolRunner: async (options) => {
        toolRequests.push(options.request);
        return { ok: true, status: "pass", message: "written", result: { path: options.request.arguments.path, bytes: 4 } };
      },
    });

    assert.equal(answer, "Đã tạo đủ 3 files ở root dir.");
    assert.deepEqual(toolRequests, [
      { tool: "internal.write_file", arguments: { path: "1.txt", content: "one\n", overwrite: false } },
      { tool: "internal.write_file", arguments: { path: "2.txt", content: "two\n", overwrite: false } },
      { tool: "internal.write_file", arguments: { path: "3.txt", content: "three\n", overwrite: false } },
    ]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools executes tool JSON mixed with final prose", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  const toolRequests: unknown[] = [];
  const responses = [
    '{"tool":"internal.list_files","arguments":{"path":"src","limit":5}}\nĐã list xong nha.',
    '{"answer":"Final after clean tool call"}',
  ];

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "list src" }],
      chatCompletion: async (_config, _apiKey, options) => {
        if (responses.length === 1) {
          assert.match(String(options.messages.at(-1)?.content ?? ""), /Tool result for internal\.list_files/);
        }
        return responses.shift() ?? '{"answer":"Final"}';
      },
      toolRunner: async (options) => {
        toolRequests.push(options.request);
        return { ok: true, status: "pass", message: "listed", result: { entries: [] } };
      },
    });

    assert.equal(answer, "Final after clean tool call");
    assert.deepEqual(toolRequests, [{ tool: "internal.list_files", arguments: { path: "src", limit: 5 } }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools turns tool runner exceptions into retryable tool results", async () => {
  const paths = await createTempPaths();
  const requests: unknown[] = [];
  const activities: unknown[] = [];

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "read from mcp" }],
      chatCompletion: async (_config, _apiKey, options) => {
        requests.push(options.messages);
        if (requests.length === 1) return '{"tool":"mcp.read","server":"fs","name":"read_file","arguments":{"path":"note.txt"}}';

        const latestMessages = JSON.stringify(options.messages);
        assert.match(latestMessages, /Tool runtime error for fs\/read_file: boom/);
        assert.match(latestMessages, /The MCP call failed/);
        assert.match(latestMessages, /internal\.mcp_list_tools/);
        return '{"tool":"internal.mcp_list_tools","arguments":{"server":"fs","connect":true}}';
      },
      maxToolCalls: 2,
      onToolActivity: (activity) => {
        activities.push(activity);
      },
      toolRunner: async (options) => {
        if (options.request.tool === "mcp.read") throw new Error("boom");
        return { ok: true, status: "pass", message: "listed", result: { tools: [{ name: "read_file" }] } };
      },
    });

    assert.match(answer, /Tool loop stopped after 2 tool calls/);
    assert.deepEqual(
      activities.map((activity) => ({ phase: (activity as { phase: string }).phase, ok: (activity as { ok?: boolean }).ok, status: (activity as { status?: string }).status })),
      [
        { phase: "start", ok: undefined, status: undefined },
        { phase: "finish", ok: false, status: "fail" },
        { phase: "start", ok: undefined, status: undefined },
        { phase: "finish", ok: true, status: "pass" },
      ],
    );
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools repairs config-edit advice into tool execution", async () => {
  const paths = await createTempPaths();
  const toolRequests: unknown[] = [];
  const responses = [
    'Đúng chỗ là .bestie/config.json, trong internalTools.policies thêm dòng này: "internal.read_url": "allow".',
    '{"tool":"internal.read_file","arguments":{"path":".bestie/config.json"}}',
    '{"tool":"internal.edit_file","arguments":{"path":".bestie/config.json","oldText":"      \\\"internal.list_processes\\\": \\\"allow\\\"","newText":"      \\\"internal.list_processes\\\": \\\"allow\\\",\\n      \\\"internal.read_url\\\": \\\"allow\\\""}}',
    '{"answer":"Đã thêm internal.read_url vào config."}',
  ];

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: 'Giúp tao thêm "internal.read_url": "allow" vào internal tools config trong .bestie' }],
      chatCompletion: async (_config, _apiKey, options) => {
        if (responses.length === 3) {
          assert.match(String(options.messages.at(-1)?.content ?? ""), /not an executable tool-loop decision|supported internal\/MCP tool request/);
        }
        return responses.shift() ?? '{"answer":"done"}';
      },
      toolRunner: async (options) => {
        toolRequests.push(options.request);
        return { ok: true, status: "pass", message: "ok", result: {} };
      },
    });

    assert.equal(answer, "Đã thêm internal.read_url vào config.");
    assert.deepEqual(toolRequests, [
      { tool: "internal.read_file", arguments: { path: ".bestie/config.json" } },
      {
        tool: "internal.edit_file",
        arguments: {
          path: ".bestie/config.json",
          oldText: '      "internal.list_processes": "allow"',
          newText: '      "internal.list_processes": "allow",\n      "internal.read_url": "allow"',
        },
      },
    ]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools repair prompt reinforces tool execution for action requests", async () => {
  const paths = await createTempPaths();
  const toolRequests: unknown[] = [];
  const responses = [
    "I can do that next.",
    '{"tool":"internal.write_file","arguments":{"path":"note.txt","content":"hello\\n","overwrite":false}}',
    '{"answer":"Đã tạo note.txt."}',
  ];

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "tạo file note.txt ở root" }],
      chatCompletion: async (_config, _apiKey, options) => {
        if (responses.length === 2) {
          assert.match(String(options.messages.at(-1)?.content ?? ""), /not an executable tool-loop decision/);
          assert.match(String(options.messages.at(-1)?.content ?? ""), /supported internal\/MCP tool request/);
          assert.match(String(options.messages.at(-1)?.content ?? ""), /Do not wrap JSON in prose or markdown fences/);
          assert.match(String(options.messages.at(-1)?.content ?? ""), /return that tool request instead of advice/);
        }
        return responses.shift() ?? '{"answer":"done"}';
      },
      toolRunner: async (options) => {
        toolRequests.push(options.request);
        return { ok: true, status: "pass", message: "written", result: { path: "note.txt" } };
      },
    });

    assert.equal(answer, "Đã tạo note.txt.");
    assert.deepEqual(toolRequests, [{ tool: "internal.write_file", arguments: { path: "note.txt", content: "hello\n", overwrite: false } }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools requires JSON decision after tool results", async () => {
  const paths = await createTempPaths();
  const toolRequests: unknown[] = [];
  const responses = [
    '{"tool":"internal.write_file","arguments":{"path":"1.txt","content":"one\\n","overwrite":false}}',
    "Next action pending.",
    '{"tool":"internal.write_file","arguments":{"path":"2.txt","content":"two\\n","overwrite":false}}',
    '{"answer":"Đã tạo đủ files."}',
  ];

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "tạo 1.txt và 2.txt" }],
      chatCompletion: async (_config, _apiKey, options) => {
        if (responses.length === 2) {
          assert.match(String(options.messages.at(-1)?.content ?? ""), /not an executable tool-loop decision/);
          assert.match(String(options.messages.at(-1)?.content ?? ""), /Do not describe what you will do next/);
        }
        return responses.shift() ?? '{"answer":"done"}';
      },
      toolRunner: async (options) => {
        toolRequests.push(options.request);
        return { ok: true, status: "pass", message: "written", result: { path: options.request.arguments.path } };
      },
    });

    assert.equal(answer, "Đã tạo đủ files.");
    assert.deepEqual(toolRequests, [
      { tool: "internal.write_file", arguments: { path: "1.txt", content: "one\n", overwrite: false } },
      { tool: "internal.write_file", arguments: { path: "2.txt", content: "two\n", overwrite: false } },
    ]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools forwards permission policy and approver to tool runner", async () => {
  const paths = await createTempPaths();
  const policy = { allowTrustedRead: false };
  const approver = async () => ({ approved: true, reason: "Approved in test." });

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "read docs" }],
      chatCompletion: async (_config, _apiKey, options) => {
        return options.messages.length === 2 ? '{"tool":"internal.read_file","arguments":{"path":"README.md"}}' : '{"answer":"done"}';
      },
      policy,
      approver,
      toolRunner: async (options) => {
        assert.equal(options.policy, policy);
        assert.equal(options.approver, approver);
        return { ok: true, status: "pass", message: "read" };
      },
    });

    assert.equal(answer, "done");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools gives recovery guidance for missing internal paths", async () => {
  const paths = await createTempPaths();
  const requests: unknown[] = [];
  const toolRequests: unknown[] = [];

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "review src/runtime/runtime.ts" }],
      chatCompletion: async (_config, _apiKey, options) => {
        requests.push(options.messages);
        if (requests.length === 1) return '{"tool":"internal.read_file","arguments":{"path":"src/runtime/runtime.ts"}}';

        const latestMessages = JSON.stringify(options.messages);
        if (requests.length === 2) {
          assert.match(latestMessages, /Path does not exist/);
          assert.match(latestMessages, /nearest existing parent directory/);
          return '{"tool":"internal.list_files","arguments":{"path":"src/runtime","limit":50}}';
        }

        assert.match(latestMessages, /config\.ts/);
        return '{"answer":"src/runtime/runtime.ts không tồn tại; file gần đúng là src/runtime/config.ts."}';
      },
      toolRunner: async (options) => {
        toolRequests.push(options.request);
        return options.request.tool === "internal.read_file"
          ? { ok: false, status: "fail", message: "Path does not exist.", result: { path: "src/runtime/runtime.ts" } }
          : { ok: true, status: "pass", message: "listed", result: { entries: [{ name: "config.ts", type: "file" }] } };
      },
    });

    assert.equal(answer, "src/runtime/runtime.ts không tồn tại; file gần đúng là src/runtime/config.ts.");
    assert.deepEqual(toolRequests, [
      { tool: "internal.read_file", arguments: { path: "src/runtime/runtime.ts" } },
      { tool: "internal.list_files", arguments: { path: "src/runtime", limit: 50 } },
    ]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools can use current repo git status when runtime root is not a repository", async () => {
  const paths = await createTempPaths();
  const requests: unknown[] = [];

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "review repo" }],
      chatCompletion: async (_config, _apiKey, options) => {
        requests.push(options.messages);
        if (requests.length === 1) {
          return '{"tool":"internal.git_status","arguments":{}}';
        }

        assert.match(JSON.stringify(options.messages), /Tool result for internal\.git_status/);
        assert.match(JSON.stringify(options.messages), /\\"status\\":\\"pass\\"/);
        return '{"answer":"Git status read succeeded."}';
      },
    });

    assert.equal(answer, "Git status read succeeded.");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools supports bundled file reads before final answer", async () => {
  const paths = await createTempPaths();
  const toolRequests: unknown[] = [];

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "summarize docs" }],
      chatCompletion: async (_config, _apiKey, options) => {
        if (options.messages.length === 2) return '{"tool":"internal.search_files","arguments":{"query":"*.md","path":"."}}';
        if (options.messages.length === 4) return '{"tool":"internal.read_many_files","arguments":{"paths":["README.md","PROJECT.md"]}}';
        return '{"answer":"Bundled summary ready."}';
      },
      toolRunner: async (options) => {
        toolRequests.push(options.request);
        return options.request.tool === "internal.search_files"
          ? { ok: true, status: "pass", message: "found", result: { matches: [{ path: "README.md", type: "file" }, { path: "PROJECT.md", type: "file" }] } }
          : { ok: true, status: "pass", message: "read", result: { files: [{ path: "README.md", content: "readme" }, { path: "PROJECT.md", content: "project" }], totalBytes: 13 } };
      },
    });

    assert.equal(answer, "Bundled summary ready.");
    assert.deepEqual(toolRequests, [
      { tool: "internal.search_files", arguments: { query: "*.md", path: "." } },
      { tool: "internal.read_many_files", arguments: { paths: ["README.md", "PROJECT.md"] } },
    ]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools supports markdown bundle reads before final answer", async () => {
  const paths = await createTempPaths();
  const toolRequests: unknown[] = [];

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "summarize all docs" }],
      chatCompletion: async (_config, _apiKey, options) => {
        if (options.messages.length === 2) return '{"tool":"internal.read_markdown_bundle","arguments":{"path":"."}}';
        return '{"answer":"Markdown bundle summary ready."}';
      },
      toolRunner: async (options) => {
        toolRequests.push(options.request);
        return { ok: true, status: "pass", message: "read", result: { manifest: ["README.md"], files: [{ path: "README.md", content: "readme" }], totalBytes: 6, truncatedFiles: [] } };
      },
    });

    assert.equal(answer, "Markdown bundle summary ready.");
    assert.deepEqual(toolRequests, [{ tool: "internal.read_markdown_bundle", arguments: { path: "." } }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools returns JSON decision answers without tool calls", async () => {
  const paths = await createTempPaths();

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "hello" }],
      chatCompletion: async (_config, _apiKey, options) => {
        assert.match(String(options.messages.at(-1)?.content ?? ""), /Tool decision required/);
        return '{"answer":"Xin chao"}';
      },
      toolRunner: async () => {
        throw new Error("should not call tools");
      },
    });

    assert.equal(answer, "Xin chao");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools answers from a repeated successful exec result", async () => {
  const paths = await createTempPaths();
  const toolRequests: unknown[] = [];

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "kiểm tra thời gian hiện tại trên local" }],
      chatCompletion: async () => '{"tool":"internal.exec","arguments":{"command":"date","args":[]}}',
      toolRunner: async (options) => {
        toolRequests.push(options.request);
        return { ok: true, status: "pass", message: "command completed", result: { command: "date", stdout: "Sat Jul 18 09:30:00 +07 2026\n", stderr: "", exitCode: 0 } };
      },
    });

    assert.equal(answer, "Sat Jul 18 09:30:00 +07 2026");
    assert.deepEqual(toolRequests, [{ tool: "internal.exec", arguments: { command: "date", args: [] } }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("completeWithAgentTools stops after max tool calls", async () => {
  const paths = await createTempPaths();
  let callCount = 0;

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "loop" }],
      maxToolCalls: 2,
      chatCompletion: async () => {
        callCount += 1;
        return `{"tool":"internal.list_files","arguments":{"path":"${callCount}"}}`;
      },
      toolRunner: async () => ({ ok: true, status: "pass", message: "listed", result: { entries: [] } }),
    });

    assert.match(answer, /Tool loop stopped after 2 tool calls/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

function createConfig(overrides: Partial<NonNullable<AppConfig["mcp"]>["servers"][number]> = {}): AppConfig {
  return {
    version: 2,
    agent: { name: "Bea", ownerName: "Andy", language: "vi", toneIntensity: 7 },
    llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key" as const,
          baseUrl: "http://127.0.0.1:9/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
    mcp: { servers: [{ name: "fs", enabled: true, command: "node", ...overrides }] },
  };
}

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-mcp-tool-use-test-"));
  const appDir = resolve(rootDir, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");

  return {
    rootDir,
    appDir,
    configPath: resolve(appDir, "config.json"),
    envPath: resolve(appDir, ".env"),
    characterPath: resolve(appDir, "character.json"),
    systemPromptPath: resolve(appDir, "system-prompt.md"),
    logsDir,
    appLogPath: resolve(logsDir, "app.log"),
    dataDir,
    memoryDbPath: resolve(dataDir, "memory.sqlite"),
    workspaceDir: resolve(appDir, "workspace"),
  };
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  const { execFile } = await import("node:child_process");
  await new Promise<void>((resolvePromise, reject) => {
    execFile("git", args, { cwd }, (error) => {
      if (error) {
        reject(error);
      } else {
        resolvePromise();
      }
    });
  });
}
