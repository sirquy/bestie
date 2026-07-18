import { randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { callMcpServerTool, listMcpServerTools, testMcpServerConnection, type McpConnectionCheck, type McpToolCallResult, type McpToolListResult } from "../../mcp/connection.js";
import { findConfiguredMcpTool, findMcpServer, listMcpServers, testMcpServerConfig } from "../../mcp/servers.js";
import { loadConfig, writeConfig, type AppConfig, type McpToolCategory } from "../../runtime/config.js";
import { loadEnvFile, writeEnvFile } from "../../runtime/env.js";
import { UserFacingError } from "../../runtime/errors.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { reviewActionPermission, type PermissionApprover, type PermissionPolicy } from "../../safety/permission-policy.js";
import { createCliPermissionApprover } from "../permission-approver.js";
import { badge, keyValue, rule, statusBadge, table, title } from "../ui.js";

interface McpCommandOptions {
  argv?: string[];
  paths?: RuntimePaths;
  testConnection?: typeof testMcpServerConnection;
  listTools?: typeof listMcpServerTools;
  callTool?: typeof callMcpServerTool;
  approver?: PermissionApprover;
  policy?: PermissionPolicy;
  writeLine?: (message: string) => void;
}

export async function runMcpCommand(optionsOrArgv: string[] | McpCommandOptions = process.argv): Promise<void> {
  const options = Array.isArray(optionsOrArgv) ? { argv: optionsOrArgv } : optionsOrArgv;
  const argv = options.argv ?? process.argv;
  const subcommand = argv[3] ?? "list";
  const writeLine = options.writeLine ?? console.log;

  if (subcommand !== "list" && subcommand !== "show" && subcommand !== "test" && subcommand !== "tools" && subcommand !== "classify" && subcommand !== "call" && subcommand !== "login") {
    throw new UserFacingError(`Unknown MCP command: ${subcommand}. Try \`bestie mcp list\`.`, "UnknownMcpCommandError");
  }

  const paths = options.paths ?? getRuntimePaths();
  const config = await loadConfig(paths);

  if (subcommand === "show") {
    const name = requireServerName(argv);
    const server = findMcpServer(config, name);

    if (!server) {
      throw new UserFacingError(`MCP server not found: ${name}`, "McpServerNotFoundError");
    }

    writeLine(title(`MCP Server: ${server.name}`));
    writeLine(rule());
    writeLine(keyValue("Status", server.enabled ? badge("ENABLED", "green") : badge("DISABLED", "gray")));
    writeLine(keyValue("Transport", server.transport));
    if (server.transport === "http") {
      writeLine(keyValue("URL", server.url ?? "missing"));
      writeLine(keyValue("Header env", Object.values(server.headersEnv).length === 0 ? "none" : Object.values(server.headersEnv).join(",")));
    } else {
      writeLine(keyValue("Command", server.command ?? "missing"));
      writeLine(keyValue("Args", server.args.length === 0 ? "none" : server.args.join(" ")));
    }
    writeLine(keyValue("Env keys", server.envKeys.length === 0 ? "none" : server.envKeys.join(",")));
    writeLine(keyValue("Tools", server.tools.length === 0 ? "none" : server.tools.map((tool) => `${tool.name}(${tool.category})`).join(",")));
    return;
  }

  if (subcommand === "test") {
    const name = requireServerName(argv);
    const check = argv.includes("--connect") ? await testConfiguredMcpServerConnection(config, name, paths, options.testConnection ?? testMcpServerConnection) : testMcpServerConfig(config, name);
    writeLine(`${statusBadge(check.status)} ${check.message}`);
    return;
  }

  if (subcommand === "tools") {
    const result = await listConfiguredMcpServerTools(config, requireServerName(argv), paths, options.listTools ?? listMcpServerTools, argv.includes("--connect"));
    writeLine(`${statusBadge(result.status)} ${result.message}`);
    for (const tool of result.tools) {
      writeLine(`- ${tool.name}${tool.description ? `: ${tool.description}` : ""}`);
    }
    return;
  }

  if (subcommand === "call") {
    const result = await callConfiguredMcpServerTool(config, argv, paths, options.callTool ?? callMcpServerTool, {
      approver: options.approver,
      policy: options.policy,
      writeLine,
    });
    writeLine(`${result.status.toUpperCase()}: ${result.message}`);
    if (result.result !== undefined) {
      writeLine(JSON.stringify(result.result, null, 2));
    }
    return;
  }

  if (subcommand === "login") {
    const result = await loginConfiguredMcpServer(config, argv, paths);
    for (const line of result) {
      writeLine(line);
    }
    return;
  }

  if (subcommand === "classify") {
    const result = classifyMcpTool(config, argv);
    await writeConfig(result.config, paths);
    writeLine(`${badge("CLASSIFIED", "green")} MCP tool ${result.serverName}/${result.toolName} classified as ${result.category}.`);
    return;
  }

  const servers = listMcpServers(config);

  if (servers.length === 0) {
    writeLine(`${badge("INFO", "blue")} No MCP servers configured.`);
    return;
  }

  const rows: string[][] = [];

  for (const server of servers) {
    const target = server.transport === "http" ? server.url ?? "missing" : `${server.command ?? "missing"}${server.args.length === 0 ? "" : ` ${server.args.join(" ")}`}`;
    const secretKeys = [...server.envKeys, ...Object.values(server.headersEnv).sort()];
    rows.push([server.name, server.enabled ? badge("ENABLED", "green") : badge("DISABLED", "gray"), server.transport, target, secretKeys.length === 0 ? "none" : secretKeys.join(",")]);
  }

  writeLine(title("MCP Servers"));
  writeLine(rule());
  for (const line of table(["Name", "Status", "Transport", "Target", "Env keys"], rows)) {
    writeLine(line);
  }
}

function classifyMcpTool(config: AppConfig, argv: string[]): { config: AppConfig; serverName: string; toolName: string; category: McpToolCategory } {
  const serverName = requireServerName(argv);
  const toolName = argv[5]?.trim();

  if (!toolName) {
    throw new UserFacingError("MCP tool name is required.", "McpMissingToolNameError");
  }

  const category = parseToolCategory(argv);
  const servers = config.mcp?.servers ?? [];
  const serverIndex = servers.findIndex((server) => server.name === serverName);

  if (serverIndex === -1) {
    throw new UserFacingError(`MCP server not found: ${serverName}`, "McpServerNotFoundError");
  }

  const nextServers = servers.map((server, index) => {
    if (index !== serverIndex) {
      return server;
    }

    const tools = server.tools ?? [];
    const existingIndex = tools.findIndex((tool) => tool.name === toolName);
    const nextTool = { name: toolName, category };
    const nextTools = existingIndex === -1 ? [...tools, nextTool] : tools.map((tool, toolIndex) => (toolIndex === existingIndex ? nextTool : tool));

    return { ...server, tools: nextTools };
  });

  return { config: { ...config, mcp: { servers: nextServers } }, serverName, toolName, category };
}

function parseToolCategory(argv: string[]): McpToolCategory {
  const index = argv.indexOf("--category");
  const category = argv[index + 1]?.trim();

  if (!category) {
    throw new UserFacingError("--category is required for MCP tool classification.", "McpMissingToolCategoryError");
  }

  if (!isMcpToolCategory(category)) {
    throw new UserFacingError("--category must be read, local_write, external_write, public_action, destructive, money, or unknown.", "McpInvalidToolCategoryError");
  }

  return category;
}

function isMcpToolCategory(value: string): value is McpToolCategory {
  return ["read", "local_write", "external_write", "public_action", "destructive", "money", "unknown"].includes(value);
}

async function callConfiguredMcpServerTool(
  config: Awaited<ReturnType<typeof loadConfig>>,
  argv: string[],
  paths: RuntimePaths,
  callTool: typeof callMcpServerTool,
  options: Pick<McpCommandOptions, "approver" | "policy" | "writeLine">,
): Promise<McpToolCallResult> {
  const serverName = requireServerName(argv);
  const toolName = argv[5]?.trim();

  if (!toolName) {
    throw new UserFacingError("MCP tool name is required.", "McpMissingToolNameError");
  }

  if (!argv.includes("--read")) {
    return { ok: false, status: "warn", message: "MCP tool calls require --read for the current read-only MVP." };
  }

  const server = findMcpServer(config, serverName);

  if (!server) {
    return { ok: false, status: "fail", message: `MCP server not found: ${serverName}` };
  }

  const configuredTool = findConfiguredMcpTool(server, toolName);
  if (!configuredTool) {
    return { ok: false, status: "fail", message: `MCP tool ${serverName}/${toolName} is not configured in the local allowlist.` };
  }

  if (configuredTool.category !== "read") {
    return { ok: false, status: "fail", message: `MCP tool ${serverName}/${toolName} is categorized as ${configuredTool.category}, but only read tools can be called in this MVP.` };
  }

  const permission = await reviewActionPermission(
    {
      category: configuredTool.category,
      action: `mcp_tool_call:${serverName}/${toolName}`,
      target: `mcp:${serverName}/${toolName}`,
      reason: "Run a read-only MCP tool call requested from the local CLI.",
      trusted: true,
    },
    {
      paths,
      approver: options.approver ?? (argv.includes("--ask") ? await createCliPermissionApprover({ writeLine: options.writeLine }) : undefined),
      policy: argv.includes("--ask") ? { ...options.policy, allowTrustedRead: false } : options.policy,
      knownSecrets: Object.values(server.env),
    },
  );

  if (permission.decision !== "allow") {
    return { ok: false, status: "fail", message: `MCP tool call denied: ${permission.reason}` };
  }

  return callTool(server, toolName, parseJsonArgs(argv), { env: await loadEnvFile(paths) });
}

function parseJsonArgs(argv: string[]): Record<string, unknown> {
  const index = argv.indexOf("--json");

  if (index === -1) {
    return {};
  }

  const rawValue = argv[index + 1];
  if (!rawValue) {
    throw new UserFacingError("--json requires an object value.", "McpInvalidToolArgsError");
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not object");
    }

    return parsed as Record<string, unknown>;
  } catch {
    throw new UserFacingError("--json must be valid JSON object syntax.", "McpInvalidToolArgsError");
  }
}

async function listConfiguredMcpServerTools(config: Awaited<ReturnType<typeof loadConfig>>, name: string, paths: RuntimePaths, listTools: typeof listMcpServerTools, shouldConnect: boolean): Promise<McpToolListResult> {
  if (!shouldConnect) {
    return { ok: true, status: "warn", message: "MCP tool discovery requires --connect and will only list metadata.", tools: [] };
  }

  const server = findMcpServer(config, name);

  if (!server) {
    return { ok: false, status: "fail", message: `MCP server not found: ${name}`, tools: [] };
  }

  return listTools(server, { env: await loadEnvFile(paths) });
}

async function loginConfiguredMcpServer(config: Awaited<ReturnType<typeof loadConfig>>, argv: string[], paths: RuntimePaths): Promise<string[]> {
  const name = requireServerName(argv);
  const server = findMcpServer(config, name);
  if (!server) {
    throw new UserFacingError(`MCP server not found: ${name}`, "McpServerNotFoundError");
  }
  if (!server.auth || server.auth.type !== "oauth") {
    throw new UserFacingError(`MCP server ${name} does not have oauth auth configured.`, "McpServerMissingOauthError");
  }

  const codeIndex = argv.indexOf("--code");
  const code = codeIndex === -1 ? undefined : argv[codeIndex + 1]?.trim();
  if (codeIndex !== -1) {
    if (!code) {
      throw new UserFacingError("--code requires an authorization code value.", "McpMissingOauthCodeError");
    }
    return completeMcpOauthLogin(server.name, server.auth.envVar, code, paths);
  }

  return startMcpOauthLogin(server, paths);
}

async function startMcpOauthLogin(server: NonNullable<ReturnType<typeof findMcpServer>>, paths: RuntimePaths): Promise<string[]> {
  if (!server.auth) {
    throw new UserFacingError(`MCP server ${server.name} does not have oauth auth configured.`, "McpServerMissingOauthError");
  }

  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const state = cryptoRandomUuid();
  const authUrl = new URL(server.auth.authorizationUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", server.auth.clientId);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  if (server.auth.redirectUri) authUrl.searchParams.set("redirect_uri", server.auth.redirectUri);
  if (server.auth.scopes && server.auth.scopes.length > 0) authUrl.searchParams.set("scope", server.auth.scopes.join(" "));
  if (server.auth.resource) authUrl.searchParams.set("resource", server.auth.resource);

  await mkdir(paths.dataDir, { recursive: true });
  await writeFile(oauthSessionPath(paths, server.name), JSON.stringify({ server: server.name, state, verifier, envVar: server.auth.envVar, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });

  return [
    `${badge("AUTH", "blue")} Open this URL to authorize MCP server ${server.name}:`,
    authUrl.toString(),
    `After approval, run: bestie mcp login ${server.name} --code <code>`,
  ];
}

async function completeMcpOauthLogin(serverName: string, envVar: string, code: string, paths: RuntimePaths): Promise<string[]> {
  await readFile(oauthSessionPath(paths, serverName), "utf8").catch(() => undefined);
  const env = await loadEnvFile(paths);
  await writeEnvFile({ ...env, [envVar]: `oauth-code:${code}` }, paths);
  return [`${badge("AUTH", "green")} Stored OAuth result for MCP server ${serverName} in ${envVar}.`, `Run \`bestie mcp tools ${serverName} --connect\` to verify discovery.`];
}

function oauthSessionPath(paths: RuntimePaths, serverName: string): string {
  return resolve(paths.dataDir, `mcp-oauth-${serverName.replace(/[^a-z0-9._-]+/gi, "_")}.json`);
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function cryptoRandomUuid(): string {
  return `${base64Url(randomBytes(4))}-${base64Url(randomBytes(2))}-${base64Url(randomBytes(2))}-${base64Url(randomBytes(2))}-${base64Url(randomBytes(6))}`;
}

async function testConfiguredMcpServerConnection(config: Awaited<ReturnType<typeof loadConfig>>, name: string, paths: RuntimePaths, testConnection: typeof testMcpServerConnection): Promise<McpConnectionCheck> {
  const server = findMcpServer(config, name);

  if (!server) {
    return { ok: false, status: "fail", message: `MCP server not found: ${name}` };
  }

  return testConnection(server, { env: await loadEnvFile(paths) });
}

function requireServerName(argv: string[]): string {
  const name = argv[4]?.trim();

  if (!name) {
    throw new UserFacingError("MCP server name is required.", "McpMissingServerNameError");
  }

  return name;
}