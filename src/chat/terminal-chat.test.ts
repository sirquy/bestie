import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { ProviderFallbackError, ProviderTimeoutError } from "../llm/errors.js";
import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { appendLog } from "../runtime/logger.js";
import { buildTerminalSystemPrompt, formatAssistantMessage, formatErrorMessage, formatPrompt, runTerminalChat } from "./terminal-chat.js";

test("terminal chat formatting uses readable labels without TTY color", () => {
  assert.equal(formatPrompt("Andy"), "[YOU] Andy > ");
  assert.equal(formatPrompt(), "[YOU] you > ");
  assert.equal(formatAssistantMessage("Bea", "Xin chao"), "[BOT] Bea > Xin chao");
  assert.equal(formatAssistantMessage(undefined, "Hello"), "[BOT] bestie > Hello");
  assert.equal(formatErrorMessage("Provider unavailable."), "[FAIL] Provider unavailable.");
});

test("buildTerminalSystemPrompt lists configured read-only MCP tools", () => {
  const prompt = buildTerminalSystemPrompt("system prompt", {
    ...createConfig(),
    mcp: {
      servers: [
        { name: "fs", enabled: true, command: "node", tools: [{ name: "read_file", category: "read" }] },
        { name: "writey", enabled: true, command: "node", tools: [{ name: "write_file", category: "local_write" }] },
        { name: "off", enabled: false, command: "node", tools: [{ name: "ignored", category: "read" }] },
      ],
    },
  });

  assert.match(prompt, /Available read-only MCP tools/);
  assert.match(prompt, /fs\/read_file/);
  assert.doesNotMatch(prompt, /writey\/write_file/);
  assert.doesNotMatch(prompt, /ignored/);
  assert.match(prompt, /Tool-use rule/);
  assert.match(prompt, /Do not put prose before or after tool JSON/);
});

test("runTerminalChat uses injected chat client and persists successful turns", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(paths.envPath, "OPENAI_API_KEY=test-key\n", { mode: 0o600 });

  const prompts: string[] = [];
  const output: string[] = [];
  let closed = false;
  let requestMessages: unknown;

  try {
    await runTerminalChat({
      config: createConfig(),
      systemPrompt: "system prompt",
      paths,
      agentName: "Bea",
      ownerName: "Andy",
      questioner: {
        ask: async (prompt) => {
          prompts.push(prompt);
          if (prompts.length === 1) {
            return "/help";
          }

          if (prompts.length === 2) {
            return "/memory pause";
          }

          if (prompts.length === 3) {
            return "hello while paused";
          }

          if (prompts.length === 4) {
            return "remember that I prefer ignored while paused";
          }

          if (prompts.length === 5) {
            return "/memory resume";
          }

          if (prompts.length === 6) {
            return "hello";
          }

          if (prompts.length === 7) {
            return "remember that I prefer concise replies";
          }

          if (prompts.length === 8) {
            return "/memory";
          }

          if (prompts.length === 9) {
            return "/status";
          }

          if (prompts.length === 10) {
            return "/pending";
          }

          return "/exit";
        },
        close: () => {
          closed = true;
        },
      },
      chatCompletion: async (_config, apiKey, options) => {
        assert.equal(apiKey, "test-key");
        requestMessages = options.messages;
        const userMessage = options.messages.filter((message) => message.role === "user").at(-2)?.content;
        if (userMessage === "hello while paused") {
          return '{"answer":"Paused reply"}';
        }

        return userMessage === "hello" ? '{"answer":"Xin chao Andy"}' : '{"answer":"Noted"}';
      },
      writeLine: (message) => output.push(message),
    });

    assert.deepEqual(prompts, ["[YOU] Andy > ", "[YOU] Andy > ", "[YOU] Andy > ", "[YOU] Andy > ", "[YOU] Andy > ", "[YOU] Andy > ", "[YOU] Andy > ", "[YOU] Andy > ", "[YOU] Andy > ", "[YOU] Andy > ", "[YOU] Andy > "]);
    assert.equal(closed, true);
    assert.deepEqual(output, [
      "Bestie chat local terminal session",
      `Runtime ${paths.appDir}`,
      "Model openai-compatible/test-model",
      "[BOT] Bea with [YOU] Andy",
      "Commands /help  /status  /providers  /memory  /pending  /exit",
      "----------------------------",
      "Commands: /help, /status, /providers, /memory, /memory pause, /memory resume, /pending, /exit",
      "Memory paused.",
      "[BOT] Bea > Paused reply",
      "[BOT] Bea > Noted",
      "Memory resumed.",
      "[BOT] Bea > Xin chao Andy",
      "[BOT] Bea > Noted",
      "No active memories.",
      "Status -> memory active; active 0; pending 0",
      "No pending memories.",
      "Bye.",
    ]);
    assert.equal((requestMessages as Array<{ role: string; content: string }>)[0]?.role, "system");
    assert.match((requestMessages as Array<{ role: string; content: string }>)[0]?.content ?? "", /system prompt/);
    assert.match((requestMessages as Array<{ role: string; content: string }>)[0]?.content ?? "", /internal\.read_file/);
    const nonDecisionMessages = (requestMessages as Array<{ role: string; content: string }>).slice(1).filter((message) => !message.content.startsWith("Tool decision required."));
    assert.deepEqual(nonDecisionMessages, [
      { role: "user", content: "hello" },
      { role: "assistant", content: "Xin chao Andy" },
      { role: "user", content: "remember that I prefer concise replies" },
    ]);

    const store = await SqliteMemoryStore.open(paths);
    try {
      assert.deepEqual(store.listRecentMessages().map((message) => `${message.role}:${message.content}`), [
        "user:hello",
        "assistant:Xin chao Andy",
        "user:remember that I prefer concise replies",
        "assistant:Noted",
      ]);
      assert.deepEqual(store.listActiveMemories(), []);
      assert.deepEqual(store.listPendingMemories(), []);
    } finally {
      store.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTerminalChat status includes recent provider fallback health", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  await appendLog(
    {
      event: "chat_request_failure",
      detail: {
        message: "All configured LLM providers failed.",
        fallbackAttempts: [
          { provider: "openai-compatible", model: "primary-model", error: "Provider returned an unusable response: 502 Bad Gateway" },
          { provider: "openai-compatible", model: "fallback-model", error: "Provider request timed out after 60s." },
        ],
      },
    },
    { paths },
  );

  const output: string[] = [];

  try {
    await runTerminalChat({
      config: createConfig(),
      systemPrompt: "system prompt",
      paths,
      agentName: "Bea",
      ownerName: "Andy",
      questioner: {
        ask: async () => (output.some((line) => line.startsWith("Status ->")) ? "/exit" : "/status"),
        close: () => undefined,
      },
      writeLine: (message) => output.push(message),
    });

    assert.match(output.find((line) => line.startsWith("Status ->")) ?? "", /provider fallback failures recent 2/);
    assert.match(output.find((line) => line.startsWith("Status ->")) ?? "", /openai-compatible\/primary-model x1/);
    assert.match(output.find((line) => line.startsWith("Status ->")) ?? "", /openai-compatible\/fallback-model x1/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTerminalChat shows provider diagnostics", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  await appendLog(
    {
      event: "chat_request_failure",
      detail: {
        fallbackAttempts: [
          { provider: "openai-compatible", model: "primary-model", error: "502" },
          { provider: "openai-compatible", model: "fallback-model", error: "timeout" },
        ],
      },
    },
    { paths },
  );

  const output: string[] = [];

  try {
    await runTerminalChat({
      config: createConfig(),
      systemPrompt: "system prompt",
      paths,
      agentName: "Bea",
      ownerName: "Andy",
      questioner: {
        ask: async () => (output.some((line) => line.startsWith("Provider diagnostics ->")) ? "/exit" : "/providers"),
        close: () => undefined,
      },
      writeLine: (message) => output.push(message),
    });

    const diagnostics = output.find((line) => line.startsWith("Provider diagnostics ->")) ?? "";
    assert.match(diagnostics, /recent fallback chains 1/);
    assert.match(diagnostics, /openai-compatible\/primary-model: 502/);
    assert.match(diagnostics, /openai-compatible\/fallback-model: timeout/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTerminalChat stores reasoned memory candidates when enabled", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(paths.envPath, "OPENAI_API_KEY=test-key\n", { mode: 0o600 });

  let calls = 0;

  try {
    await runTerminalChat({
      config: { ...createConfig(), memory: { writePolicy: "allow" } },
      systemPrompt: "system prompt",
      paths,
      agentName: "Bea",
      ownerName: "Andy",
      questioner: {
        ask: async () => (calls >= 2 ? "/exit" : "I prefer concise replies"),
        close: () => undefined,
      },
      chatCompletion: async (_config, _apiKey, options) => {
        calls += 1;
        const systemText = String(options.messages[0]?.content ?? "");
        return systemText.includes("memory reasoning pass")
          ? '{"candidates":[{"type":"communication_preference","content":"User prefers concise replies.","reason":"The user stated a durable reply preference.","confidence":0.9}]}'
          : '{"answer":"Noted."}';
      },
      writeLine: () => undefined,
    });

    const store = await SqliteMemoryStore.open(paths);
    try {
      assert.deepEqual(store.listActiveMemories().map((memory) => `${memory.type}:${memory.content}:${memory.source}`), ["communication_preference:User prefers concise replies.:reasoning:terminal"]);
    } finally {
      store.close();
    }
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTerminalChat includes more than the store default memory count in provider context", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(paths.envPath, "OPENAI_API_KEY=test-key\n", { mode: 0o600 });

  const store = await SqliteMemoryStore.open(paths);
  try {
    for (let index = 1; index <= 25; index += 1) {
      store.addMemory({ type: "preference", content: `memory ${index}`, importance: 1 });
    }
  } finally {
    store.close();
  }

  let requestMessages: Array<{ role: string; content: string }> = [];

  try {
    await runTerminalChat({
      config: createConfig(),
      systemPrompt: "system prompt",
      paths,
      agentName: "Bea",
      ownerName: "Andy",
      questioner: {
        ask: async () => (requestMessages.length > 0 ? "/exit" : "hello"),
        close: () => undefined,
      },
      chatCompletion: async (_config, _apiKey, options) => {
        const systemText = String(options.messages[0]?.content ?? "").toLowerCase();
        if (!systemText.includes("memory reasoning pass")) {
          requestMessages = options.messages as Array<{ role: string; content: string }>;
        }
        return '{"answer":"Xin chao"}';
      },
      writeLine: () => undefined,
    });

    const memoryContext = requestMessages.find((message) => message.role === "system" && message.content.startsWith("Approved local memories"))?.content ?? "";
    assert.match(memoryContext, /memory 25/);
    assert.match(memoryContext, /memory 21/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTerminalChat does not stream raw JSON answer envelopes after tool calls", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(paths.envPath, "OPENAI_API_KEY=test-key\n", { mode: 0o600 });

  const lines: string[] = [];
  const chunks: string[] = [];
  let completionCalls = 0;

  try {
    await runTerminalChat({
      config: createConfig(),
      systemPrompt: "system prompt",
      paths,
      agentName: "Bea",
      ownerName: "Andy",
      questioner: {
        ask: async () => (lines.includes("[BOT] Bea > streamed answer") ? "/exit" : "hello"),
        close: () => undefined,
      },
      chatCompletion: async (_config, _apiKey, options) => {
        completionCalls += 1;
        if (completionCalls === 1) {
          return '{"tool":"internal.read_file","arguments":{"path":"README.md"}}';
        }

        assert.equal(options.stream, false);
        return '{"answer":"streamed answer"}';
      },
      mcpToolRunner: async () => ({ ok: true, status: "pass", message: "ok", result: { content: "hello" } }),
      writeLine: (message) => lines.push(message),
      writeChunk: (message) => chunks.push(message),
    });

    assert.deepEqual(chunks, []);
    assert.ok(lines.includes("[BOT] Bea > streamed answer"));
    assert.ok(lines.every((line) => !line.includes('{"answer"')));
    assert.ok(lines.includes("Bye."));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTerminalChat prints final answer normally when no chunks stream", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(paths.envPath, "OPENAI_API_KEY=test-key\n", { mode: 0o600 });

  const lines: string[] = [];
  const chunks: string[] = [];

  try {
    await runTerminalChat({
      config: createConfig(),
      systemPrompt: "system prompt",
      paths,
      agentName: "Bea",
      ownerName: "Andy",
      questioner: {
        ask: async () => (lines.includes("[BOT] Bea > full answer") ? "/exit" : "hello"),
        close: () => undefined,
      },
      chatCompletion: async () => '{"answer":"full answer"}',
      writeLine: (message) => lines.push(message),
      writeChunk: (message) => chunks.push(message),
    });

    assert.deepEqual(chunks, []);
    assert.ok(lines.includes("[BOT] Bea > full answer"));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTerminalChat executes one MCP read tool request and asks LLM for final answer", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(paths.envPath, "OPENAI_API_KEY=test-key\n", { mode: 0o600 });

  const output: string[] = [];
  const requestMessages: unknown[] = [];
  let mcpToolRequest: unknown;

  try {
    await runTerminalChat({
      config: {
        ...createConfig(),
        mcp: { servers: [{ name: "fs", enabled: true, command: "node", tools: [{ name: "read_file", category: "read" }] }] },
      },
      systemPrompt: "system prompt",
      paths,
      agentName: "Bea",
      ownerName: "Andy",
      questioner: {
        ask: async () => (output.some((line) => line === "[BOT] Bea > file says hello") ? "/exit" : "read the file"),
        close: () => undefined,
      },
      chatCompletion: async (_config, _apiKey, options) => {
        requestMessages.push(options.messages);
        return requestMessages.length === 1 ? '{"tool":"mcp.read","server":"fs","name":"read_file","arguments":{"path":"note.txt"}}' : '{"answer":"file says hello"}';
      },
      mcpToolRunner: async (options) => {
        mcpToolRequest = options.request;
        return { ok: true, status: "pass", message: "read ok", result: { content: "hello" } };
      },
      writeLine: (message) => output.push(message),
    });

    assert.deepEqual(mcpToolRequest, { tool: "mcp.read", server: "fs", name: "read_file", arguments: { path: "note.txt" } });
    assert.equal(requestMessages.length, 2);
    assert.match(JSON.stringify(requestMessages[0]), /fs\/read_file/);
    assert.match(JSON.stringify(requestMessages[1]), /Tool result for fs\/read_file/);
    assert.deepEqual(output, [
      "Bestie chat local terminal session",
      `Runtime ${paths.appDir}`,
      "Model openai-compatible/test-model",
      "[BOT] Bea with [YOU] Andy",
      "Commands /help  /status  /providers  /memory  /pending  /exit",
      "----------------------------",
      "[BOT] Bea > [TOOL] fs/read_file fs/read_file",
      "[BOT] Bea > file says hello",
      "Bye.",
    ]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTerminalChat can execute multiple internal tools in one turn", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(paths.envPath, "OPENAI_API_KEY=test-key\n", { mode: 0o600 });

  const output: string[] = [];
  const toolRequests: unknown[] = [];
  let completionCalls = 0;

  try {
    await runTerminalChat({
      config: createConfig(),
      systemPrompt: "system prompt",
      paths,
      agentName: "Bea",
      ownerName: "Andy",
      questioner: {
        ask: async () => (output.some((line) => line === "[BOT] Bea > Summary ready") ? "/exit" : "summarize docs"),
        close: () => undefined,
      },
      chatCompletion: async () => {
        completionCalls += 1;
        if (completionCalls === 1) return '{"tool":"internal.search_files","arguments":{"query":"*.md","path":"docs"}}';
        if (completionCalls === 2) return '{"tool":"internal.read_file","arguments":{"path":"docs/README.md"}}';
        return "Summary ready";
      },
      mcpToolRunner: async (options) => {
        toolRequests.push(options.request);
        return { ok: true, status: "pass", message: "ok", result: {} };
      },
      writeLine: (message) => output.push(message),
    });

    assert.deepEqual(toolRequests, [
      { tool: "internal.search_files", arguments: { query: "*.md", path: "docs" } },
      { tool: "internal.read_file", arguments: { path: "docs/README.md" } },
    ]);
    assert.ok(output.includes("[BOT] Bea > [TOOL] internal.search_files *.md in docs"));
    assert.ok(output.includes("[BOT] Bea > [TOOL] internal.read_file docs/README.md"));
    assert.ok(output.includes("[BOT] Bea > Summary ready"));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTerminalChat passes terminal permission approval to tool requests", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(paths.envPath, "OPENAI_API_KEY=test-key\n", { mode: 0o600 });

  const prompts: string[] = [];
  const output: string[] = [];
  let completionCalls = 0;

  try {
    await runTerminalChat({
      config: createConfig(),
      systemPrompt: "system prompt",
      paths,
      agentName: "Bea",
      ownerName: "Andy",
      questioner: {
        ask: async (prompt) => {
          prompts.push(prompt);
          return output.some((line) => line === "[BOT] Bea > Done") ? "/exit" : "write a file";
        },
        confirm: async (prompt: string, defaultValue?: boolean) => {
          prompts.push(prompt);
          assert.equal(defaultValue, false);
          return true;
        },
        close: () => undefined,
      },
      chatCompletion: async () => {
        completionCalls += 1;
        return completionCalls === 1 ? '{"tool":"internal.write_file","arguments":{"path":"note.txt","content":"hello"}}' : "Done";
      },
      mcpToolRunner: async (options) => {
        assert.equal(options.request.tool, "internal.write_file");
        assert.ok(options.approver);
        const approval = await options.approver(
          { category: "local_write", action: "internal.write_file", target: "note.txt", reason: "test" },
          { decision: "ask", reason: "Local write actions require approval by default." },
        );
        return { ok: approval.approved, status: approval.approved ? "pass" : "fail", message: approval.reason ?? "", result: {} };
      },
      writeLine: (message) => output.push(message),
    });

    assert.ok(prompts.includes("Allow this action once?"));
    assert.ok(output.includes("Permission required"));
    assert.ok(output.includes("[BOT] Bea > Done"));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTerminalChat shows bundled read activity", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(paths.envPath, "OPENAI_API_KEY=test-key\n", { mode: 0o600 });

  const output: string[] = [];
  let completionCalls = 0;

  try {
    await runTerminalChat({
      config: createConfig(),
      systemPrompt: "system prompt",
      paths,
      agentName: "Bea",
      ownerName: "Andy",
      questioner: {
        ask: async () => (output.some((line) => line === "[BOT] Bea > Bundle done") ? "/exit" : "summarize docs"),
        close: () => undefined,
      },
      chatCompletion: async () => {
        completionCalls += 1;
        return completionCalls === 1 ? '{"tool":"internal.read_many_files","arguments":{"paths":["README.md","PROJECT.md"]}}' : "Bundle done";
      },
      mcpToolRunner: async () => ({ ok: true, status: "pass", message: "ok", result: { files: [] } }),
      writeLine: (message) => output.push(message),
    });

    assert.ok(output.includes("[BOT] Bea > [TOOL] internal.read_many_files 2 files"));
    assert.ok(output.includes("[BOT] Bea > Bundle done"));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTerminalChat shows markdown bundle activity", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(paths.envPath, "OPENAI_API_KEY=test-key\n", { mode: 0o600 });

  const output: string[] = [];
  let completionCalls = 0;

  try {
    await runTerminalChat({
      config: createConfig(),
      systemPrompt: "system prompt",
      paths,
      agentName: "Bea",
      ownerName: "Andy",
      questioner: {
        ask: async () => (output.some((line) => line === "[BOT] Bea > Markdown done") ? "/exit" : "summarize docs"),
        close: () => undefined,
      },
      chatCompletion: async () => {
        completionCalls += 1;
        return completionCalls === 1 ? '{"tool":"internal.read_markdown_bundle","arguments":{"path":"."}}' : "Markdown done";
      },
      mcpToolRunner: async () => ({ ok: true, status: "pass", message: "ok", result: { files: [] } }),
      writeLine: (message) => output.push(message),
    });

    assert.ok(output.includes("[BOT] Bea > [TOOL] internal.read_markdown_bundle ."));
    assert.ok(output.includes("[BOT] Bea > Markdown done"));
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTerminalChat repairs invented shell command JSON instead of printing it", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(paths.envPath, "OPENAI_API_KEY=test-key\n", { mode: 0o600 });

  const output: string[] = [];
  const requestMessages: unknown[] = [];
  let mcpToolCalled = false;

  try {
    await runTerminalChat({
      config: {
        ...createConfig(),
        mcp: { servers: [{ name: "fs", enabled: true, command: "node", tools: [{ name: "read_file", category: "read" }] }] },
      },
      systemPrompt: "system prompt",
      paths,
      agentName: "Bea",
      ownerName: "Andy",
      questioner: {
        ask: async () => (output.some((line) => line === "[BOT] Bea > Mình chưa chạy được shell JSON đó. Gửi bằng MCP read schema nha.") ? "/exit" : "read logs"),
        close: () => undefined,
      },
      chatCompletion: async (_config, _apiKey, options) => {
        requestMessages.push(options.messages);
        return requestMessages.length === 1
          ? '{"cmd":"sed -n \'1,120p\' .bestie/logs/app.log","workdir":"."}'
          : "Mình chưa chạy được shell JSON đó. Gửi bằng MCP read schema nha.";
      },
      mcpToolRunner: async () => {
        mcpToolCalled = true;
        return { ok: true, status: "pass", message: "should not call" };
      },
      writeLine: (message) => output.push(message),
    });

    assert.equal(mcpToolCalled, false);
    assert.equal(requestMessages.length, 2);
    assert.match(JSON.stringify(requestMessages[1]), /not an executable tool-loop decision/);
    assert.deepEqual(output, [
      "Bestie chat local terminal session",
      `Runtime ${paths.appDir}`,
      "Model openai-compatible/test-model",
      "[BOT] Bea with [YOU] Andy",
      "Commands /help  /status  /providers  /memory  /pending  /exit",
      "----------------------------",
      "[BOT] Bea > Mình chưa chạy được shell JSON đó. Gửi bằng MCP read schema nha.",
      "Bye.",
    ]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTerminalChat allows slash commands before API key loading", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });

  const output: string[] = [];
  let closed = false;

  try {
    await runTerminalChat({
      config: createConfig(),
      systemPrompt: "system prompt",
      paths,
      agentName: "Bea",
      ownerName: "Andy",
      questioner: {
        ask: async () => (output.some((line) => line.startsWith("Commands:")) ? "/exit" : "/help"),
        close: () => {
          closed = true;
        },
      },
      chatCompletion: async () => {
        throw new Error("chat completion should not run for slash commands");
      },
      writeLine: (message) => output.push(message),
    });

    assert.equal(closed, true);
    assert.deepEqual(output, [
      "Bestie chat local terminal session",
      `Runtime ${paths.appDir}`,
      "Model openai-compatible/test-model",
      "[BOT] Bea with [YOU] Andy",
      "Commands /help  /status  /providers  /memory  /pending  /exit",
      "----------------------------",
      "Commands: /help, /status, /providers, /memory, /memory pause, /memory resume, /pending, /exit",
      "Bye.",
    ]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTerminalChat reports provider failures without persisting failed turns", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(paths.envPath, "OPENAI_API_KEY=test-key\n", { mode: 0o600 });

  const output: string[] = [];
  let closed = false;

  try {
    await runTerminalChat({
      config: createConfig(),
      systemPrompt: "system prompt",
      paths,
      agentName: "Bea",
      ownerName: "Andy",
      questioner: {
        ask: async (prompt) => {
          assert.equal(prompt, "[YOU] Andy > ");
          return output.some((line) => line.startsWith("[FAIL]")) ? "/exit" : "hello";
        },
        close: () => {
          closed = true;
        },
      },
      chatCompletion: async () => {
        throw new Error("Provider unavailable.");
      },
      writeLine: (message) => output.push(message),
    });

    assert.equal(closed, true);
    assert.deepEqual(output, [
      "Bestie chat local terminal session",
      `Runtime ${paths.appDir}`,
      "Model openai-compatible/test-model",
      "[BOT] Bea with [YOU] Andy",
      "Commands /help  /status  /providers  /memory  /pending  /exit",
      "----------------------------",
      "[FAIL] Provider unavailable.",
      "Bye.",
    ]);

    const store = await SqliteMemoryStore.open(paths);
    try {
      assert.deepEqual(store.listRecentMessages(), []);
      assert.deepEqual(store.listActiveMemories(), []);
    } finally {
      store.close();
    }

    assert.deepEqual(await readLogEvents(paths), [
      { event: "command_start", command: "chat" },
      { event: "chat_request_failure", message: "Provider unavailable." },
    ]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runTerminalChat logs provider fallback attempts", async () => {
  const paths = await createTempPaths();
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(paths.envPath, "OPENAI_API_KEY=test-key\n", { mode: 0o600 });

  const output: string[] = [];

  try {
    await runTerminalChat({
      config: createConfig(),
      systemPrompt: "system prompt",
      paths,
      agentName: "Bea",
      ownerName: "Andy",
      questioner: {
        ask: async () => (output.some((line) => line.startsWith("[FAIL]")) ? "/exit" : "hello"),
        close: () => undefined,
      },
      chatCompletion: async () => {
        const timeoutError = new ProviderTimeoutError(60_000);
        throw new ProviderFallbackError(
          [
            { provider: "openai-compatible", model: "primary-model", error: "Provider returned an unusable response: 502 Bad Gateway" },
            { provider: "openai-compatible", model: "fallback-model", error: timeoutError.message },
          ],
          timeoutError,
        );
      },
      writeLine: (message) => output.push(message),
    });

    const failureLog = (await readLogEvents(paths)).find((event) => event.event === "chat_request_failure");
    assert.deepEqual(failureLog?.fallbackAttempts, [
      { provider: "openai-compatible", model: "primary-model", error: "Provider returned an unusable response: 502 Bad Gateway" },
      { provider: "openai-compatible", model: "fallback-model", error: new ProviderTimeoutError(60_000).message },
    ]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

function createConfig(): AppConfig {
  return {
    version: 1,
    agent: { name: "Bea", ownerName: "Andy", language: "vi", toneIntensity: 7 },
    llm: { provider: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", model: "test-model", apiKeyEnv: "OPENAI_API_KEY" },
  };
}

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-terminal-chat-test-"));
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

async function readLogEvents(paths: RuntimePaths): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(paths.appLogPath, "utf8");

  return text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const entry = JSON.parse(line) as { event: string; detail?: Record<string, unknown> };
      return { event: entry.event, ...entry.detail };
    });
}
