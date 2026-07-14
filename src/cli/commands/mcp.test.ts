import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { writeConfig, type AppConfig } from "../../runtime/config.js";
import type { RuntimePaths } from "../../runtime/paths.js";
import { runMcpCommand } from "./mcp.js";

const config: AppConfig = {
  version: 1,
  agent: { name: "Miu", ownerName: "Boss", language: "vi", toneIntensity: 7 },
  llm: { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "model", apiKeyEnv: "OPENAI_API_KEY" },
};

test("runMcpCommand lists configured MCP servers without env values", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "fs", enabled: true, command: "node", args: ["server.js"], env: { SECRET_TOKEN: "hidden" } }] } }, paths);

    await runMcpCommand({ argv: ["node", "bestie", "mcp", "list"], paths, writeLine: (line) => lines.push(line) });

    assert.match(lines.join("\n"), /MCP Servers/);
    assert.match(lines.join("\n"), /fs\s+\[ENABLED\]\s+stdio\s+node server\.js\s+SECRET_TOKEN/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand lists remote MCP servers with header env keys", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "composio", enabled: true, transport: "http", url: "https://connect.composio.dev/mcp", headersEnv: { "x-consumer-api-key": "COMPOSIO_CONSUMER_API_KEY" } }] } }, paths);

    await runMcpCommand({ argv: ["node", "bestie", "mcp", "list"], paths, writeLine: (line) => lines.push(line) });

    assert.match(lines.join("\n"), /MCP Servers/);
    assert.match(lines.join("\n"), /composio\s+\[ENABLED\]\s+http\s+https:\/\/connect\.composio\.dev\/mcp\s+COMPOSIO_CONSUMER_API_KEY/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand shows one configured MCP server without env values", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "fs", enabled: true, command: "node", args: ["server.js"], env: { SECRET_TOKEN: "hidden" }, tools: [{ name: "read_file", category: "read" }] }] } }, paths);

    await runMcpCommand({ argv: ["node", "bestie", "mcp", "show", "fs"], paths, writeLine: (line) => lines.push(line) });

    assert.deepEqual(lines, ["MCP Server: fs", "----------------------------------------------------------------", "Status         [ENABLED]", "Transport      stdio", "Command        node", "Args           server.js", "Env keys       SECRET_TOKEN", "Tools          read_file(read)"]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand shows one remote MCP server without secret values", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "composio", enabled: true, transport: "http", url: "https://connect.composio.dev/mcp", headersEnv: { "x-consumer-api-key": "COMPOSIO_CONSUMER_API_KEY" } }] } }, paths);

    await runMcpCommand({ argv: ["node", "bestie", "mcp", "show", "composio"], paths, writeLine: (line) => lines.push(line) });

    assert.deepEqual(lines, ["MCP Server: composio", "----------------------------------------------------------------", "Status         [ENABLED]", "Transport      http", "URL            https://connect.composio.dev/mcp", "Header env     COMPOSIO_CONSUMER_API_KEY", "Env keys       none", "Tools          none"]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand shows no classified tools when none are configured", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "fs", enabled: true, command: "node" }] } }, paths);

    await runMcpCommand({ argv: ["node", "bestie", "mcp", "show", "fs"], paths, writeLine: (line) => lines.push(line) });

    assert.equal(lines.at(-1), "Tools          none");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand tests one configured MCP server without starting it", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "fs", enabled: false, command: "node" }] } }, paths);

    await runMcpCommand({ argv: ["node", "bestie", "mcp", "test", "fs"], paths, writeLine: (line) => lines.push(line) });

    assert.deepEqual(lines, ["[WARN] MCP server fs is configured but disabled."]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand can run an explicit MCP connection check", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];
  const testedServers: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "fs", enabled: true, command: "node", env: { SECRET_TOKEN: "hidden" } }] } }, paths);

    await runMcpCommand({
      argv: ["node", "bestie", "mcp", "test", "fs", "--connect"],
      paths,
      testConnection: async (server) => {
        testedServers.push(server.name);
        return { ok: true, status: "pass", message: `MCP server ${server.name} responded to initialize.` };
      },
      writeLine: (line) => lines.push(line),
    });

    assert.deepEqual(testedServers, ["fs"]);
    assert.deepEqual(lines, ["[PASS] MCP server fs responded to initialize."]);
    assert.doesNotMatch(JSON.stringify(lines), /hidden/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand can list MCP tool metadata with an explicit connection", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "fs", enabled: true, command: "node", env: { SECRET_TOKEN: "hidden" } }] } }, paths);

    await runMcpCommand({
      argv: ["node", "bestie", "mcp", "tools", "fs", "--connect"],
      paths,
      listTools: async (server) => ({ ok: true, status: "pass", message: `MCP server ${server.name} returned 1 tool(s).`, tools: [{ name: "read_file", description: "Read a local file" }] }),
      writeLine: (line) => lines.push(line),
    });

    assert.deepEqual(lines, ["[PASS] MCP server fs returned 1 tool(s).", "- read_file: Read a local file"]);
    assert.doesNotMatch(JSON.stringify(lines), /hidden/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand passes .env values to remote MCP tool discovery", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "composio", enabled: true, transport: "http", url: "https://connect.composio.dev/mcp", headersEnv: { "x-consumer-api-key": "COMPOSIO_CONSUMER_API_KEY" } }] } }, paths);
    await import("node:fs/promises").then((fs) => fs.writeFile(paths.envPath, 'COMPOSIO_CONSUMER_API_KEY="secret-from-env-file"\n', { mode: 0o600 }));

    await runMcpCommand({
      argv: ["node", "bestie", "mcp", "tools", "composio", "--connect"],
      paths,
      listTools: async (_server, options) => {
        assert(options);
        assert.equal(options.env?.COMPOSIO_CONSUMER_API_KEY, "secret-from-env-file");
        return { ok: true, status: "pass", message: "MCP server composio returned 0 tool(s).", tools: [] };
      },
      writeLine: (line) => lines.push(line),
    });

    assert.deepEqual(lines, ["[PASS] MCP server composio returned 0 tool(s)."]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand requires --connect for MCP tool metadata", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "fs", enabled: true, command: "node" }] } }, paths);

    await runMcpCommand({ argv: ["node", "bestie", "mcp", "tools", "fs"], paths, writeLine: (line) => lines.push(line) });

    assert.deepEqual(lines, ["[WARN] MCP tool discovery requires --connect and will only list metadata."]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand calls an MCP tool through the read permission gate", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "fs", enabled: true, command: "node", env: { SECRET_TOKEN: "hidden-secret-value" }, tools: [{ name: "read_file", category: "read" }] }] } }, paths);

    await runMcpCommand({
      argv: ["node", "bestie", "mcp", "call", "fs", "read_file", "--read", "--json", "{\"path\":\"README.md\"}"],
      paths,
      callTool: async (server, toolName, args) => ({ ok: true, status: "pass", message: `MCP tool ${server.name}/${toolName} returned a result.`, result: { args } }),
      writeLine: (line) => lines.push(line),
    });

    assert.deepEqual(lines, ["PASS: MCP tool fs/read_file returned a result.", JSON.stringify({ args: { path: "README.md" } }, null, 2)]);
    const logText = await readFile(paths.appLogPath, "utf8");
    assert.match(logText, /mcp_tool_call:fs\/read_file/);
    assert.doesNotMatch(logText, /hidden-secret-value/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand refuses MCP tool calls without read scope", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "fs", enabled: true, command: "node", tools: [{ name: "read_file", category: "read" }] }] } }, paths);

    await runMcpCommand({ argv: ["node", "bestie", "mcp", "call", "fs", "read_file"], paths, writeLine: (line) => lines.push(line) });

    assert.deepEqual(lines, ["WARN: MCP tool calls require --read for the current read-only MVP."]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand denies MCP tool calls when read policy is disabled", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "fs", enabled: true, command: "node", tools: [{ name: "read_file", category: "read" }] }] } }, paths);

    await runMcpCommand({
      argv: ["node", "bestie", "mcp", "call", "fs", "read_file", "--read"],
      paths,
      policy: { allowTrustedRead: false },
      callTool: async () => {
        throw new Error("should not call MCP tool when denied");
      },
      writeLine: (line) => lines.push(line),
    });

    assert.match(lines[0] ?? "", /^FAIL: MCP tool call denied:/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand can approve MCP calls through an approver", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "fs", enabled: true, command: "node", tools: [{ name: "read_file", category: "read" }] }] } }, paths);

    await runMcpCommand({
      argv: ["node", "bestie", "mcp", "call", "fs", "read_file", "--read"],
      paths,
      policy: { allowTrustedRead: false },
      approver: async () => ({ approved: true, reason: "Approved in test." }),
      callTool: async (server, toolName) => ({ ok: true, status: "pass", message: `MCP tool ${server.name}/${toolName} returned a result.`, result: { ok: true } }),
      writeLine: (line) => lines.push(line),
    });

    assert.deepEqual(lines, ["PASS: MCP tool fs/read_file returned a result.", JSON.stringify({ ok: true }, null, 2)]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand supports --ask for read MCP calls", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];
  let asked = false;

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "fs", enabled: true, command: "node", tools: [{ name: "read_file", category: "read" }] }] } }, paths);

    await runMcpCommand({
      argv: ["node", "bestie", "mcp", "call", "fs", "read_file", "--read", "--ask"],
      paths,
      approver: async () => {
        asked = true;
        return { approved: true, reason: "Approved with --ask." };
      },
      callTool: async (server, toolName) => ({ ok: true, status: "pass", message: `MCP tool ${server.name}/${toolName} returned a result.`, result: { ok: true } }),
      writeLine: (line) => lines.push(line),
    });

    assert.equal(asked, true);
    assert.deepEqual(lines, ["PASS: MCP tool fs/read_file returned a result.", JSON.stringify({ ok: true }, null, 2)]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand respects denied MCP call approval", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "fs", enabled: true, command: "node", tools: [{ name: "read_file", category: "read" }] }] } }, paths);

    await runMcpCommand({
      argv: ["node", "bestie", "mcp", "call", "fs", "read_file", "--read"],
      paths,
      policy: { allowTrustedRead: false },
      approver: async () => ({ approved: false, reason: "Denied in test." }),
      callTool: async () => {
        throw new Error("should not call MCP tool when denied");
      },
      writeLine: (line) => lines.push(line),
    });

    assert.deepEqual(lines, ["FAIL: MCP tool call denied: Denied in test."]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand refuses MCP tool calls without local tool classification", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "fs", enabled: true, command: "node" }] } }, paths);

    await runMcpCommand({ argv: ["node", "bestie", "mcp", "call", "fs", "read_file", "--read"], paths, writeLine: (line) => lines.push(line) });

    assert.deepEqual(lines, ["FAIL: MCP tool fs/read_file is not configured in the local allowlist."]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand refuses non-read MCP tool categories in read-only MVP", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "fs", enabled: true, command: "node", tools: [{ name: "write_file", category: "local_write" }] }] } }, paths);

    await runMcpCommand({ argv: ["node", "bestie", "mcp", "call", "fs", "write_file", "--read"], paths, writeLine: (line) => lines.push(line) });

    assert.deepEqual(lines, ["FAIL: MCP tool fs/write_file is categorized as local_write, but only read tools can be called in this MVP."]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand classifies an MCP tool in config without starting the server", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "fs", enabled: true, command: "node", env: { SECRET_TOKEN: "hidden" } }] } }, paths);

    await runMcpCommand({ argv: ["node", "bestie", "mcp", "classify", "fs", "read_file", "--category", "read"], paths, writeLine: (line) => lines.push(line) });

    const updated = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    assert.deepEqual(lines, ["[CLASSIFIED] MCP tool fs/read_file classified as read."]);
    assert.deepEqual(updated.mcp?.servers[0].tools, [{ name: "read_file", category: "read" }]);
    assert.equal(updated.mcp?.servers[0].env?.SECRET_TOKEN, "hidden");
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand updates an existing MCP tool classification", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "fs", enabled: true, command: "node", tools: [{ name: "read_file", category: "unknown" }] }] } }, paths);

    await runMcpCommand({ argv: ["node", "bestie", "mcp", "classify", "fs", "read_file", "--category", "read"], paths, writeLine: () => undefined });

    const updated = JSON.parse(await readFile(paths.configPath, "utf8")) as AppConfig;
    assert.deepEqual(updated.mcp?.servers[0].tools, [{ name: "read_file", category: "read" }]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand rejects invalid MCP tool classification categories", async () => {
  const paths = await createTempPaths();

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig({ ...config, mcp: { servers: [{ name: "fs", enabled: true, command: "node" }] } }, paths);

    await assert.rejects(
      runMcpCommand({ argv: ["node", "bestie", "mcp", "classify", "fs", "read_file", "--category", "teleport"], paths, writeLine: () => undefined }),
      /--category must be read/,
    );
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runMcpCommand reports no configured servers", async () => {
  const paths = await createTempPaths();
  const lines: string[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeConfig(config, paths);

    await runMcpCommand({ argv: ["node", "bestie", "mcp", "list"], paths, writeLine: (line) => lines.push(line) });

    assert.deepEqual(lines, ["[INFO] No MCP servers configured."]);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-mcp-command-test-"));
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