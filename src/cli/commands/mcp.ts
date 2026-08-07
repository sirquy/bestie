import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { discoverOAuthServerInfo, exchangeAuthorization, startAuthorization } from "@modelcontextprotocol/sdk/client/auth.js";
import type { AuthorizationServerMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

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

  if (subcommand !== "list" && subcommand !== "show" && subcommand !== "test" && subcommand !== "tools" && subcommand !== "classify" && subcommand !== "call" && subcommand !== "login" && subcommand !== "add") {
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

  if (subcommand === "add") {
    const result = await addConfiguredMcpServer(config, argv);
    await writeConfig(result.config, paths);
    writeLine(`${badge("ADDED", "green")} MCP server ${result.server.name} saved.`);
    if (result.discoveredOauth) {
      writeLine(`${badge("AUTH", "blue")} OAuth metadata discovered; run \`bestie mcp login ${result.server.name}\` to authorize.`);
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

async function addConfiguredMcpServer(config: AppConfig, argv: string[]): Promise<{ config: AppConfig; server: NonNullable<AppConfig["mcp"]>["servers"][number]; discoveredOauth: boolean }> {
  const name = requireServerName(argv);
  const url = requireFlagValue(argv, "--url", "McpAddMissingUrlError");
  const transport = optionalFlagValue(argv, "--transport") ?? "streamable-http";
  if (transport !== "http" && transport !== "streamable-http") {
    throw new UserFacingError("bestie mcp add --transport must be http or streamable-http for URL-based servers.", "McpAddInvalidTransportError");
  }
  if ((config.mcp?.servers ?? []).some((server) => server.name === name)) {
    throw new UserFacingError(`MCP server already exists: ${name}`, "McpServerAlreadyExistsError");
  }

  const clientId = optionalFlagValue(argv, "--oauth-client-id");
  const envVar = optionalFlagValue(argv, "--auth-env") ?? defaultMcpAuthEnvVarName(name);
  const discoveredOauth = clientId ? await discoverMcpOauthConfig(url, clientId, envVar).catch(() => undefined) : undefined;
  const server = {
    name,
    enabled: true,
    transport,
    url,
    ...(discoveredOauth ? { auth: discoveredOauth } : {}),
  } satisfies NonNullable<AppConfig["mcp"]>["servers"][number];

  return { config: { ...config, mcp: { servers: [...(config.mcp?.servers ?? []), server] } }, server, discoveredOauth: Boolean(discoveredOauth) };
}

async function discoverMcpOauthConfig(url: string, clientId: string, envVar: string): Promise<NonNullable<NonNullable<AppConfig["mcp"]>["servers"][number]["auth"]>> {
  const info = await discoverOAuthServerInfo(url);
  const metadata = info.authorizationServerMetadata;
  if (!metadata) {
    throw new Error("OAuth metadata not found.");
  }
  return {
    type: "oauth",
    authorizationUrl: metadata.authorization_endpoint,
    tokenUrl: metadata.token_endpoint,
    clientId,
    ...(metadata.scopes_supported && metadata.scopes_supported.length > 0 ? { scopes: metadata.scopes_supported } : {}),
    resource: info.resourceMetadata?.resource ?? url,
    envVar,
    headerName: "authorization",
  };
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

  const server = findMcpServer(config, serverName);

  if (!server) {
    return { ok: false, status: "fail", message: `MCP server not found: ${serverName}` };
  }

  const configuredTool = findConfiguredMcpTool(server, toolName);
  if (!configuredTool) {
    return { ok: false, status: "fail", message: `MCP tool ${serverName}/${toolName} is not configured in the local allowlist.` };
  }

  const env = await loadEnvFile(paths);
  const permission = await reviewActionPermission(
    {
      category: configuredTool.category,
      action: `mcp_tool_call:${serverName}/${toolName}`,
      target: `mcp:${serverName}/${toolName}`,
      reason: `Run a ${configuredTool.category} MCP tool call requested from the local CLI.`,
      trusted: configuredTool.category === "read",
      payloadJson: JSON.stringify({ tool: "mcp.call", server: serverName, name: toolName, arguments: parseJsonArgs(argv) }),
    },
    {
      paths,
      approver: options.approver ?? (argv.includes("--ask") ? await createCliPermissionApprover({ writeLine: options.writeLine }) : undefined),
      policy: argv.includes("--ask") ? { ...options.policy, allowTrustedRead: false } : options.policy,
      knownSecrets: [...Object.values(server.env), ...Object.values(server.headersEnv).flatMap((envName) => env[envName] ? [env[envName]] : [])],
    },
  );

  if (permission.decision !== "allow") {
    return { ok: false, status: "fail", message: `MCP tool call denied: ${permission.reason}` };
  }

  return callTool(server, toolName, parseJsonArgs(argv), { env });
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

function requireFlagValue(argv: string[], flag: string, code: string): string {
  const value = optionalFlagValue(argv, flag);
  if (!value) {
    throw new UserFacingError(`${flag} is required.`, code);
  }
  return value;
}

function optionalFlagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1]?.trim() || undefined;
}

function defaultMcpAuthEnvVarName(serverName: string): string {
  const normalized = serverName.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase();
  return `${normalized || "MCP"}_AUTHORIZATION`;
}

async function listConfiguredMcpServerTools(config: Awaited<ReturnType<typeof loadConfig>>, name: string, paths: RuntimePaths, listTools: typeof listMcpServerTools, shouldConnect: boolean): Promise<McpToolListResult> {
  if (!shouldConnect) {
    return { ok: true, status: "warn", message: "MCP tool discovery requires --connect and will only list metadata.", tools: [] };
  }

  const server = findMcpServer(config, name);

  if (!server) {
    return { ok: false, status: "fail", message: `MCP server not found: ${name}`, tools: [] };
  }

  const result = await listTools(server, { env: await loadEnvFile(paths) });
  if (result.ok) {
    await autoClassifyDiscoveredTools(config, server.name, result.tools, paths);
  }
  return result;
}

async function autoClassifyDiscoveredTools(config: AppConfig, serverName: string, tools: McpToolListResult["tools"], paths: RuntimePaths): Promise<void> {
  const servers = config.mcp?.servers ?? [];
  const serverIndex = servers.findIndex((server) => server.name === serverName);
  if (serverIndex === -1) return;

  let changed = false;
  const nextServers = servers.map((server, index) => {
    if (index !== serverIndex) return server;
    const existingTools = server.tools ?? [];
    const nextTools = [...existingTools];
    for (const tool of tools) {
      if (nextTools.some((configured) => configured.name === tool.name)) continue;
      nextTools.push({ name: tool.name, category: classifyDiscoveredMcpTool(tool) });
      changed = true;
    }
    return changed ? { ...server, tools: nextTools } : server;
  });

  if (changed) {
    await writeConfig({ ...config, mcp: { servers: nextServers } }, paths);
  }
}

function classifyDiscoveredMcpTool(tool: McpToolListResult["tools"][number]): McpToolCategory {
  if (tool.annotations?.destructiveHint) return "destructive";
  if (tool.annotations?.readOnlyHint) return "read";
  if (tool.annotations?.openWorldHint) return "external_write";
  return "unknown";
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
    return completeMcpOauthLogin(server, code, paths);
  }

  return startMcpOauthLogin(server, paths);
}

async function startMcpOauthLogin(server: NonNullable<ReturnType<typeof findMcpServer>>, paths: RuntimePaths): Promise<string[]> {
  if (!server.auth) {
    throw new UserFacingError(`MCP server ${server.name} does not have oauth auth configured.`, "McpServerMissingOauthError");
  }

  const state = cryptoRandomUuid();
  const redirectUri = effectiveMcpOauthRedirectUri(server);
  const authorization = await startAuthorization(oauthAuthorizationServerUrl(server), {
    metadata: oauthMetadata(server),
    clientInformation: { client_id: server.auth.clientId },
    redirectUrl: redirectUri,
    scope: server.auth.scopes?.join(" "),
    state,
    ...(server.auth.resource ? { resource: new URL(server.auth.resource) } : {}),
  });

  await mkdir(paths.dataDir, { recursive: true });
  await writeFile(
    oauthSessionPath(paths, server.name),
    JSON.stringify({ server: server.name, state, verifier: authorization.codeVerifier, redirectUri, envVar: server.auth.envVar, createdAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  );

  return [
    `${badge("AUTH", "blue")} Open this URL to authorize MCP server ${server.name}:`,
    authorization.authorizationUrl.toString(),
    `After approval, run: bestie mcp login ${server.name} --code <code>`,
  ];
}

async function completeMcpOauthLogin(server: NonNullable<ReturnType<typeof findMcpServer>>, code: string, paths: RuntimePaths): Promise<string[]> {
  if (!server.auth) {
    throw new UserFacingError(`MCP server ${server.name} does not have oauth auth configured.`, "McpServerMissingOauthError");
  }
  if (!server.auth.tokenUrl) {
    throw new UserFacingError(`MCP server ${server.name} oauth auth requires tokenUrl to exchange an authorization code.`, "McpServerMissingOauthTokenUrlError");
  }

  const session = await readMcpOauthSession(paths, server.name);
  const tokens = await exchangeAuthorization(oauthAuthorizationServerUrl(server), {
    metadata: oauthMetadata(server),
    clientInformation: { client_id: server.auth.clientId },
    authorizationCode: code,
    codeVerifier: session.verifier,
    redirectUri: session.redirectUri,
    ...(server.auth.resource ? { resource: new URL(server.auth.resource) } : {}),
  });
  const env = await loadEnvFile(paths);
  await writeEnvFile({ ...env, [server.auth.envVar]: formatAuthorizationValue(tokens) }, paths);
  return [`${badge("AUTH", "green")} Stored OAuth access token for MCP server ${server.name} in ${server.auth.envVar}.`, `Run \`bestie mcp tools ${server.name} --connect\` to verify discovery.`];
}

async function readMcpOauthSession(paths: RuntimePaths, serverName: string): Promise<{ verifier: string; redirectUri: string }> {
  const raw = await readFile(oauthSessionPath(paths, serverName), "utf8").catch(() => undefined);
  if (!raw) {
    throw new UserFacingError(`No pending OAuth session found for MCP server ${serverName}. Run \`bestie mcp login ${serverName}\` first.`, "McpOauthSessionNotFoundError");
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || typeof parsed.verifier !== "string" || typeof parsed.redirectUri !== "string") {
    throw new UserFacingError(`OAuth session for MCP server ${serverName} is invalid. Run \`bestie mcp login ${serverName}\` again.`, "McpOauthSessionInvalidError");
  }

  return { verifier: parsed.verifier, redirectUri: parsed.redirectUri };
}

function oauthMetadata(server: NonNullable<ReturnType<typeof findMcpServer>>): AuthorizationServerMetadata {
  if (!server.auth) {
    throw new UserFacingError(`MCP server ${server.name} does not have oauth auth configured.`, "McpServerMissingOauthError");
  }

  return {
    issuer: oauthAuthorizationServerUrl(server).toString(),
    authorization_endpoint: server.auth.authorizationUrl,
    token_endpoint: server.auth.tokenUrl ?? new URL("token", oauthAuthorizationServerUrl(server)).toString(),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
  };
}

function oauthAuthorizationServerUrl(server: NonNullable<ReturnType<typeof findMcpServer>>): URL {
  if (!server.auth) {
    throw new UserFacingError(`MCP server ${server.name} does not have oauth auth configured.`, "McpServerMissingOauthError");
  }
  return new URL(server.auth.authorizationUrl).origin ? new URL(new URL(server.auth.authorizationUrl).origin) : new URL(server.auth.authorizationUrl);
}

function effectiveMcpOauthRedirectUri(server: NonNullable<ReturnType<typeof findMcpServer>>): string {
  return server.auth?.redirectUri ?? "http://127.0.0.1:8989/oauth/callback";
}

function formatAuthorizationValue(tokens: OAuthTokens): string {
  return `${tokens.token_type} ${tokens.access_token}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
