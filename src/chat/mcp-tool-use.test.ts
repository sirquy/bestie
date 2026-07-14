import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { buildAgentToolDecisionMessage, buildAgentToolResultMessage, buildMcpToolInstructions, buildMcpToolResultMessage, completeWithAgentTools, parseAgentToolDecisionResult, parseMcpToolRequest, parseMcpToolRequestResult, runAgentToolRequest, runMcpToolRequest } from "./mcp-tool-use.js";

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
  assert.match(instructions, /Approved local memories may already be included/);
  assert.match(instructions, /do not call memory tools just to rediscover/);
  assert.match(instructions, /Use memory tools only when the included memory context is missing or insufficient/);
  assert.match(instructions, /Use file tools for repo\/local context/);
  assert.match(instructions, /Use read_logs only for recent runtime behavior/);
  assert.match(instructions, /internal\.git_status/);
  assert.match(instructions, /internal\.mcp_list_servers/);
  assert.match(instructions, /internal\.mcp_list_tools/);
  assert.match(instructions, /Use git tools for repository state questions/);
  assert.match(instructions, /MCP server discovery/);
  assert.match(instructions, /Do not invent missing facts/);
  assert.match(instructions, /do not merely explain the edit/);
});

test("buildAgentToolResultMessage guides empty and failed internal tool results", () => {
  const empty = buildAgentToolResultMessage("internal.search_memories", { ok: true, status: "pass", message: "ok", result: { query: "concise", memories: [] } });
  const failed = buildAgentToolResultMessage("internal.search_files", { ok: false, status: "fail", message: "Permission denied." });

  assert.match(empty, /Tool decision required/);
  assert.match(empty, /returned no matching data/);
  assert.match(empty, /Do not claim the data exists/);
  assert.match(failed, /did not succeed/);
  assert.match(failed, /Do not invent the missing data/);
});

test("buildToolResultMessage keeps path recovery and grounded answer guidance", () => {
  const missingPath = buildAgentToolResultMessage("internal.read_file", { ok: false, status: "fail", message: "Path does not exist.", result: { path: "missing.md" } });
  const mcpResult = buildMcpToolResultMessage("docs", "read", { ok: true, status: "pass", message: "ok", result: { content: "hello" } });

  assert.match(missingPath, /nearest existing parent directory/);
  assert.match(missingPath, /exactly one JSON object/);
  assert.match(mcpResult, /Ground the next step in this tool result/);
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
});

test("parseMcpToolRequestResult rejects supported tool JSON mixed with prose", () => {
  const result = parseMcpToolRequestResult('Để review code, Miu cần xem qua src trước.\n\n{"tool":"internal.list_files","arguments":{"path":"src","limit":50}}');

  assert.equal(result.kind, "invalid");
  assert.match(result.kind === "invalid" ? result.message : "", /entire assistant message/);
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
  assert.match(message, /call the tool instead of describing the edit/);
});

test("parseAgentToolDecisionResult rejects supported tool JSON mixed with prose", () => {
  const result = parseAgentToolDecisionResult('Đọc hết trước đã:\n\n{"tool":"internal.list_files","arguments":{"path":"src/channels","limit":50}}');

  assert.equal(result.kind, "invalid");
  assert.match(result.kind === "invalid" ? result.message : "", /Tool decisions must be JSON/);
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

test("completeWithAgentTools repairs tool JSON mixed with final prose", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  const responses = [
    '{"tool":"internal.list_files","arguments":{"path":"src","limit":5}}\nĐã list xong nha.',
    '{"tool":"internal.list_files","arguments":{"path":"src","limit":5}}',
    '{"answer":"Final after clean tool call"}',
  ];

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "list src" }],
      chatCompletion: async (_config, _apiKey, options) => {
        if (responses.length === 2) {
          assert.match(String(options.messages.at(-1)?.content ?? ""), /not an executable tool-loop decision|exactly one JSON object/);
        }
        return responses.shift() ?? '{"answer":"Final"}';
      },
      toolRunner: async () => ({ ok: true, status: "pass", message: "listed", result: { entries: [] } }),
    });

    assert.equal(answer, "Final after clean tool call");
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

test("completeWithAgentTools stops after max tool calls", async () => {
  const paths = await createTempPaths();

  try {
    const answer = await completeWithAgentTools({
      config: createConfig(),
      paths,
      apiKey: "test-key",
      messages: [{ role: "user", content: "loop" }],
      maxToolCalls: 2,
      chatCompletion: async () => '{"tool":"internal.list_files","arguments":{"path":"."}}',
      toolRunner: async () => ({ ok: true, status: "pass", message: "listed", result: { entries: [] } }),
    });

    assert.match(answer, /Tool loop stopped after 2 tool calls/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

function createConfig(overrides: Partial<NonNullable<AppConfig["mcp"]>["servers"][number]> = {}): AppConfig {
  return {
    version: 1,
    agent: { name: "Bea", ownerName: "Andy", language: "vi", toneIntensity: 7 },
    llm: { provider: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", model: "test-model", apiKeyEnv: "OPENAI_API_KEY" },
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
