import { constants } from "node:fs";
import { basename, delimiter, isAbsolute, join, relative, resolve } from "node:path";
import { chmod, cp, readdir, stat, writeFile } from "node:fs/promises";
import { access, mkdir, readFile } from "node:fs/promises";

import { DEFAULT_LLM_TIMEOUT_MS, configExists, loadConfig, type AppConfig } from "./config.js";
import { loadEnvFile } from "./env.js";
import { InvalidConfigError } from "./errors.js";
import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import { listMcpServers, type McpServerSummary } from "../mcp/servers.js";
import { getRuntimePaths, type RuntimePaths } from "./paths.js";
import { TelegramHttpClient, convertSpeechToTelegramVoice } from "../channels/telegram.js";
import { ZaloHttpClient, type ZaloUser } from "../channels/zalo.js";
import { createSpeech } from "../llm/openai-speech.js";
import { formatProviderFallbackHealth } from "../llm/fallbacks.js";

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  message: string;
  fix?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  issueCount: number;
  fixes: DoctorFix[];
}

export interface DoctorFix {
  name: string;
  status: "fixed" | "skipped" | "failed";
  message: string;
}

export interface DoctorOptions {
  fix?: boolean;
  platform?: NodeJS.Platform;
  connectTelegram?: boolean;
  connectZalo?: boolean;
  testTelegramSpeech?: boolean;
  telegramIdentityChecker?: TelegramIdentityChecker;
  zaloIdentityChecker?: ZaloIdentityChecker;
  telegramSpeechTester?: TelegramSpeechTester;
  telegramWorkspaceWarnBytes?: number;
}

export type TelegramIdentityChecker = (token: string) => Promise<TelegramBotIdentity>;
export type ZaloIdentityChecker = (token: string) => Promise<ZaloBotIdentity>;
export type TelegramSpeechTester = (config: AppConfig, paths: RuntimePaths) => Promise<{ bytes: number; mimeType: string }>;

export interface TelegramBotIdentity {
  id: number;
  username?: string;
}

export interface ZaloBotIdentity {
  id: string;
  username?: string;
  firstName?: string;
}

const MIN_RECOMMENDED_LLM_TIMEOUT_MS = 10_000;
const MAX_RECOMMENDED_LLM_TIMEOUT_MS = 120_000;
const TELEGRAM_WORKSPACE_WARN_BYTES = 500 * 1024 * 1024;
const LEGACY_APP_DIR_NAME = ".ai-bestie";

export async function runDoctor(paths: RuntimePaths = getRuntimePaths(), options: DoctorOptions = {}): Promise<DoctorReport> {
  const platform = options.platform ?? process.platform;
  const fixes = options.fix ? await runDoctorFixes(paths, platform) : [];
  const checks: DoctorCheck[] = [];

  checks.push(checkNodeVersion());
  checks.push(checkRuntimePaths(paths));
  checks.push(await checkLegacyRuntimeDirectory(paths));

  const hasConfig = await configExists(paths);
  checks.push({
    name: "Config file",
    status: hasConfig ? "pass" : "fail",
    message: hasConfig ? `Config file found at ${paths.configPath}` : `Config file missing at ${paths.configPath}`,
    fix: hasConfig ? undefined : "Run `bestie onboard` to create local config.",
  });

  let apiKeyEnv: string | undefined;
  let telegramConfig: { enabled: boolean; botTokenEnv: string; ownerUserId: string } | undefined;
  let zaloConfig: { enabled: boolean; botTokenEnv: string; ownerUserId: string } | undefined;
  let configForChecks: AppConfig | undefined;
  let mcpServers: McpServerSummary[] | undefined;
  if (hasConfig) {
    try {
      const config = await loadConfig(paths);
      configForChecks = config;
      apiKeyEnv = config.llm.apiKeyEnv;
      telegramConfig = config.channels?.telegram;
      zaloConfig = config.channels?.zalo;
      mcpServers = listMcpServers(config);
      checks.push({ name: "Config parse", status: "pass", message: "Config parses successfully." });
      checks.push(checkLlmTimeout(config.llm.timeoutMs));
    } catch (error) {
      checks.push({
        name: "Config parse",
        status: "fail",
        message: error instanceof InvalidConfigError ? error.message : "Config could not be loaded.",
        fix: "Review .bestie/config.json or rerun `bestie onboard`.",
      });
    }
  }

  const envExists = await fileExists(paths.envPath);
  checks.push({
    name: ".env file",
    status: envExists ? "pass" : "fail",
    message: envExists ? `.env file found at ${paths.envPath}` : `.env file missing at ${paths.envPath}`,
    fix: envExists ? undefined : "Run `bestie onboard` to save provider secrets locally.",
  });

  if (envExists) {
    checks.push(await checkEnvFilePermissions(paths, platform));
  }

  if (apiKeyEnv) {
    const envValues = await loadEnvFile(paths);
    const hasSecret = Boolean(process.env[apiKeyEnv] ?? envValues[apiKeyEnv]);
    checks.push({
      name: "LLM API key",
      status: hasSecret ? "pass" : "fail",
      message: hasSecret ? `API key env ${apiKeyEnv} is present.` : `API key env ${apiKeyEnv} is missing.`,
      fix: hasSecret ? undefined : `Add ${apiKeyEnv} to ${paths.envPath} or rerun \`bestie onboard\`.`,
    });
  }

  if (telegramConfig?.enabled) {
    const envValues = await loadEnvFile(paths);
    const telegramCheck = checkTelegramConfig(telegramConfig, envValues);
    checks.push(telegramCheck);
    checks.push(await checkTelegramWorkspaceUsage(paths, options.telegramWorkspaceWarnBytes ?? TELEGRAM_WORKSPACE_WARN_BYTES));

    if (options.connectTelegram && telegramCheck.status === "pass") {
      const token = process.env[telegramConfig.botTokenEnv] ?? envValues[telegramConfig.botTokenEnv];
      checks.push(await checkTelegramBotIdentity(token, options.telegramIdentityChecker ?? getTelegramBotIdentity));
    }
  }

  if (zaloConfig?.enabled) {
    const envValues = await loadEnvFile(paths);
    const zaloCheck = checkZaloConfig(zaloConfig, envValues);
    checks.push(zaloCheck);

    if (options.connectZalo && zaloCheck.status === "pass") {
      const token = process.env[zaloConfig.botTokenEnv] ?? envValues[zaloConfig.botTokenEnv];
      checks.push(await checkZaloBotIdentity(token, options.zaloIdentityChecker ?? getZaloBotIdentity));
    }
  }

  if (configForChecks?.channels?.telegram?.attachments?.transcriptionPolicy === "allow") {
    checks.push(...await checkTranscriptionConfig(configForChecks, paths));
  }

  if (configForChecks?.channels?.telegram?.voiceReplyPolicy === "voice-input-only") {
    checks.push(...await checkTelegramSpeechConfig(configForChecks, paths, options));
  }

  if (mcpServers !== undefined && mcpServers.length > 0) {
    checks.push(checkMcpServers(mcpServers));
  }

  checks.push(await checkNonEmptyFile("Character prompt", paths.systemPromptPath, "Run `bestie onboard` to regenerate system-prompt.md."));
  checks.push(await checkWritableLogDir(paths));

  if (await fileExists(paths.appLogPath)) {
    checks.push(await checkLogFilePermissions(paths, platform));
  }

  checks.push(await checkProviderFallbackHealth(paths));

  checks.push(await checkMemoryDatabase(paths));

  checks.push(await checkCronHealth(paths));

  const normalizedChecks = checks.map(normalizeDoctorCheck);
  return { checks: normalizedChecks, issueCount: normalizedChecks.filter((check) => check.status === "fail").length, fixes };
}

function normalizeDoctorCheck(check: DoctorCheck): DoctorCheck {
  if (check.fix === undefined) {
    const { fix: _fix, ...normalizedCheck } = check;
    return normalizedCheck;
  }

  return check;
}

async function checkProviderFallbackHealth(paths: RuntimePaths): Promise<DoctorCheck> {
  const health = await formatProviderFallbackHealth(paths);
  if (!health) {
    return { name: "Provider fallback health", status: "pass", message: "No recent provider fallback failures found in local logs." };
  }

  return {
    name: "Provider fallback health",
    status: "warn",
    message: `Recent provider instability detected: ${health}.`,
    fix: "Review .bestie/logs/app.log, increase provider timeout if needed, or adjust the configured fallback provider chain.",
  };
}

async function checkTranscriptionConfig(config: AppConfig, paths: RuntimePaths): Promise<DoctorCheck[]> {
  if (!config.transcription) {
    return [{
      name: "Transcription provider",
      status: "fail",
      message: "Telegram audio transcription is allowed, but no top-level transcription provider is configured.",
      fix: "Add a top-level transcription provider to .bestie/config.json or set channels.telegram.attachments.transcriptionPolicy to deny.",
    }];
  }

  if (config.transcription.provider === "openai-compatible") {
    const envValues = await loadEnvFile(paths);
    const hasSecret = Boolean(process.env[config.transcription.apiKeyEnv] ?? envValues[config.transcription.apiKeyEnv]);
    return [{
      name: "Transcription provider",
      status: hasSecret ? "pass" : "fail",
      message: hasSecret ? `OpenAI-compatible transcription API key env ${config.transcription.apiKeyEnv} is present.` : `OpenAI-compatible transcription API key env ${config.transcription.apiKeyEnv} is missing.`,
      fix: hasSecret ? undefined : `Add ${config.transcription.apiKeyEnv} to ${paths.envPath} or use a local-whisper transcription provider.`,
    }];
  }

  if (config.transcription.provider === "elevenlabs") {
    const envValues = await loadEnvFile(paths);
    const hasSecret = Boolean(process.env[config.transcription.apiKeyEnv] ?? envValues[config.transcription.apiKeyEnv]);
    return [{
      name: "Transcription provider",
      status: hasSecret ? "pass" : "fail",
      message: hasSecret ? `ElevenLabs transcription API key env ${config.transcription.apiKeyEnv} is present.` : `ElevenLabs transcription API key env ${config.transcription.apiKeyEnv} is missing.`,
      fix: hasSecret ? undefined : `Add ${config.transcription.apiKeyEnv} to ${paths.envPath} or use a local-whisper transcription provider.`,
    }];
  }

  const checks: DoctorCheck[] = [];
  const commandPath = await resolveCommandPath(config.transcription.command, paths);
  const modelPath = resolveMaybeRelative(paths.rootDir, config.transcription.modelPath);

  checks.push(await checkExecutablePath("Local transcription command", commandPath, config.transcription.command, "Set transcription.command to an installed whisper-cli or wrapper script."));
  checks.push(await checkReadableFile("Local transcription model", modelPath, "Download a whisper.cpp model and set transcription.modelPath to it."));

  if (await commandUsesFfmpeg(commandPath)) {
    const ffmpegPath = await resolveCommandPath("ffmpeg", paths);
    checks.push(await checkExecutablePath("Local transcription ffmpeg", ffmpegPath, "ffmpeg", "Install ffmpeg or use a local transcription command that can read Telegram Ogg/Opus voice files directly."));
  }

  if ((config.agent.language === "vi" || config.agent.language === "mixed") && basename(modelPath).toLowerCase().includes("tiny")) {
    checks.push({
      name: "Local transcription model quality",
      status: "warn",
      message: "Configured local transcription model appears to be tiny; Vietnamese voice transcription quality may be poor.",
      fix: "Use ggml-small.bin or a larger multilingual whisper.cpp model for Vietnamese voice messages.",
    });
  } else {
    checks.push({ name: "Local transcription model quality", status: "pass", message: "Local transcription model choice does not look like the tiny model." });
  }

  return checks;
}

async function checkTelegramSpeechConfig(config: AppConfig, paths: RuntimePaths, options: DoctorOptions): Promise<DoctorCheck[]> {
  if (!config.speech) {
    return [{
      name: "Telegram speech provider",
      status: "fail",
      message: "Telegram voice replies are enabled, but no top-level speech provider is configured.",
      fix: "Add a top-level speech provider to .bestie/config.json or set channels.telegram.voiceReplyPolicy to deny.",
    }];
  }

  const checks: DoctorCheck[] = [];
  const envValues = await loadEnvFile(paths);
  const hasSecret = Boolean(process.env[config.speech.apiKeyEnv] ?? envValues[config.speech.apiKeyEnv]);
  checks.push({
    name: "Telegram speech provider",
    status: hasSecret ? "pass" : "fail",
    message: hasSecret ? `${formatSpeechProviderName(config.speech.provider)} speech API key env ${config.speech.apiKeyEnv} is present.` : `${formatSpeechProviderName(config.speech.provider)} speech API key env ${config.speech.apiKeyEnv} is missing.`,
    fix: hasSecret ? undefined : `Add ${config.speech.apiKeyEnv} to ${paths.envPath} or set channels.telegram.voiceReplyPolicy to deny.`,
  });

  const ffmpegPath = await resolveCommandPath("ffmpeg", paths);
  const ffmpegCheck = await checkExecutablePath("Telegram speech ffmpeg", ffmpegPath, "ffmpeg", "Install ffmpeg so speech replies can be converted to Telegram Ogg/Opus voice notes.");
  checks.push(ffmpegCheck);

  if (options.testTelegramSpeech && hasSecret && ffmpegCheck.status === "pass") {
    checks.push(await checkTelegramSpeechRoundTrip(config, paths, options.telegramSpeechTester ?? testTelegramSpeechRoundTrip));
  }

  return checks;
}

function formatSpeechProviderName(provider: NonNullable<AppConfig["speech"]>["provider"]): string {
  return provider === "elevenlabs" ? "ElevenLabs" : "OpenAI-compatible";
}

async function checkTelegramSpeechRoundTrip(config: AppConfig, paths: RuntimePaths, tester: TelegramSpeechTester): Promise<DoctorCheck> {
  try {
    const result = await tester(config, paths);
    return {
      name: "Telegram speech test",
      status: "pass",
      message: `Generated and converted a local Telegram voice sample (${formatBytes(result.bytes)}, ${result.mimeType}).`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown speech test error.";
    return {
      name: "Telegram speech test",
      status: "fail",
      message: `Speech test failed: ${message}`,
      fix: "Check the speech provider endpoint, API key, model, and ffmpeg installation.",
    };
  }
}

async function testTelegramSpeechRoundTrip(config: AppConfig, paths: RuntimePaths): Promise<{ bytes: number; mimeType: string }> {
  const speech = await createSpeech(config, { text: "xin chao" }, { paths });
  const voice = await convertSpeechToTelegramVoice(speech, { paths });
  if (voice.mimeType !== "audio/ogg" || voice.bytes.byteLength < 4 || new TextDecoder().decode(voice.bytes.slice(0, 4)) !== "OggS") {
    throw new Error("converted speech is not a valid Ogg voice sample.");
  }
  return { bytes: voice.bytes.byteLength, mimeType: voice.mimeType };
}

async function checkTelegramWorkspaceUsage(paths: RuntimePaths, warnBytes: number): Promise<DoctorCheck> {
  const telegramWorkspace = resolve(paths.workspaceDir, "telegram");
  const usage = await getDirectoryUsage(telegramWorkspace);

  if (usage.files === 0) {
    return { name: "Telegram attachment storage", status: "pass", message: "No retained Telegram attachment files found." };
  }

  if (usage.bytes > warnBytes) {
    return {
      name: "Telegram attachment storage",
      status: "warn",
      message: `Telegram attachments are using ${formatBytes(usage.bytes)} across ${usage.files} retained file(s).`,
      fix: "Preview cleanup with `bestie tools attachments cleanup --older-than 7d --kinds voice,audio`; add `--confirm` to delete matched files.",
    };
  }

  return { name: "Telegram attachment storage", status: "pass", message: `Telegram attachments are using ${formatBytes(usage.bytes)} across ${usage.files} retained file(s).` };
}

async function getDirectoryUsage(path: string): Promise<{ files: number; bytes: number }> {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { files: 0, bytes: 0 };
    }

    return { files: 0, bytes: 0 };
  }

  let files = 0;
  let bytes = 0;
  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      const nested = await getDirectoryUsage(entryPath);
      files += nested.files;
      bytes += nested.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += (await stat(entryPath)).size;
    }
  }

  return { files, bytes };
}

async function checkExecutablePath(name: string, resolvedPath: string | undefined, configuredValue: string, fix: string): Promise<DoctorCheck> {
  if (!resolvedPath) {
    return { name, status: "fail", message: `${configuredValue} was not found on PATH.`, fix };
  }

  try {
    await access(resolvedPath, constants.X_OK);
    return { name, status: "pass", message: `${name} is executable at ${resolvedPath}.` };
  } catch {
    return { name, status: "fail", message: `${name} is not executable at ${resolvedPath}.`, fix };
  }
}

async function checkReadableFile(name: string, path: string, fix: string): Promise<DoctorCheck> {
  try {
    const fileStat = await stat(path);
    if (!fileStat.isFile()) {
      return { name, status: "fail", message: `${path} exists but is not a file.`, fix };
    }

    await access(path, constants.R_OK);
    return { name, status: "pass", message: `${name} is readable at ${path} (${formatBytes(fileStat.size)}).` };
  } catch {
    return { name, status: "fail", message: `${name} is missing or unreadable at ${path}.`, fix };
  }
}

async function resolveCommandPath(command: string, paths: RuntimePaths): Promise<string | undefined> {
  if (command.includes("/") || command.includes("\\")) {
    return resolveMaybeRelative(paths.rootDir, command);
  }

  for (const pathEntry of (process.env.PATH ?? "").split(delimiter)) {
    if (!pathEntry) {
      continue;
    }

    const candidate = resolve(pathEntry, command);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep searching PATH.
    }
  }

  return undefined;
}

function resolveMaybeRelative(rootDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(rootDir, path);
}

async function commandUsesFfmpeg(commandPath: string | undefined): Promise<boolean> {
  if (!commandPath) {
    return false;
  }

  if (basename(commandPath).toLowerCase().includes("ffmpeg")) {
    return true;
  }

  try {
    const contents = await readFile(commandPath, "utf8");
    return /\bffmpeg\b/.test(contents);
  } catch {
    return false;
  }
}

async function runDoctorFixes(paths: RuntimePaths, platform = process.platform): Promise<DoctorFix[]> {
  const fixes: DoctorFix[] = [];

  fixes.push(await migrateLegacyRuntimeDirectory(paths));
  fixes.push(await ensureDirectory(paths.appDir, "App directory"));
  fixes.push(await ensureDirectory(paths.logsDir, "Log directory"));
  fixes.push(await ensureDirectory(paths.dataDir, "Data directory"));
  fixes.push(await restrictFilePermissions(paths.envPath, ".env permissions", platform));
  fixes.push(await restrictFilePermissions(paths.appLogPath, "Log file permissions", platform));
  fixes.push(await initializeMemoryDatabase(paths));

  return fixes;
}

async function migrateLegacyRuntimeDirectory(paths: RuntimePaths): Promise<DoctorFix> {
  const legacyAppDir = getLegacyAppDir(paths);

  if (!(await fileExists(legacyAppDir))) {
    return { name: "Legacy runtime migration", status: "skipped", message: `${legacyAppDir} does not exist.` };
  }

  if (await fileExists(paths.appDir)) {
    return { name: "Legacy runtime migration", status: "skipped", message: `${paths.appDir} already exists; leaving ${legacyAppDir} untouched.` };
  }

  try {
    await cp(legacyAppDir, paths.appDir, { recursive: true, errorOnExist: true });
    await rewriteLegacyRuntimeNames(paths);
    return { name: "Legacy runtime migration", status: "fixed", message: `Copied ${legacyAppDir} to ${paths.appDir} and updated legacy Bestie env names.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown migration error.";
    return { name: "Legacy runtime migration", status: "failed", message: `Could not migrate ${legacyAppDir}: ${message}` };
  }
}

async function rewriteLegacyRuntimeNames(paths: RuntimePaths): Promise<void> {
  await rewriteFileIfExists(paths.configPath, rewriteLegacyBestieNames);
  await rewriteFileIfExists(paths.envPath, rewriteLegacyBestieNames);
}

async function rewriteFileIfExists(path: string, rewrite: (contents: string) => string): Promise<void> {
  if (!(await fileExists(path))) {
    return;
  }

  const contents = await readFile(path, "utf8");
  const rewritten = rewrite(contents);

  if (rewritten !== contents) {
    await writeFile(path, rewritten, { mode: 0o600 });
  }
}

function rewriteLegacyBestieNames(contents: string): string {
  return contents.replaceAll("AI_BESTIE", "BESTIE").replaceAll(".ai-bestie", ".bestie").replaceAll("ai-bestie", "bestie");
}

async function ensureDirectory(path: string, name: string): Promise<DoctorFix> {
  try {
    if ((await stat(path)).isDirectory()) {
      return { name, status: "skipped", message: `${path} already exists.` };
    }

    return { name, status: "failed", message: `${path} exists but is not a directory.` };
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT")) {
      const message = error instanceof Error ? error.message : "Unknown directory error.";
      return { name, status: "failed", message: `Could not inspect ${path}: ${message}` };
    }

    try {
      await mkdir(path, { recursive: true });
      return { name, status: "fixed", message: `Ensured ${path} exists.` };
    } catch (mkdirError) {
      const message = mkdirError instanceof Error ? mkdirError.message : "Unknown directory error.";
      return { name, status: "failed", message: `Could not create ${path}: ${message}` };
    }
  }
}

async function restrictFilePermissions(path: string, name: string, platform = process.platform): Promise<DoctorFix> {
  if (!(await fileExists(path))) {
    return { name, status: "skipped", message: `${path} does not exist.` };
  }

  if (platform === "win32") {
    return { name, status: "skipped", message: `${path} uses Windows ACLs; POSIX chmod is not applied.` };
  }

  try {
    const currentMode = (await stat(path)).mode & 0o777;

    if ((currentMode & 0o077) === 0) {
      return { name, status: "skipped", message: `${path} is already owner-only.` };
    }

    await chmod(path, 0o600);
    return { name, status: "fixed", message: `Restricted ${path} to owner read/write.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown chmod error.";
    return { name, status: "failed", message: `Could not restrict ${path}: ${message}` };
  }
}

async function initializeMemoryDatabase(paths: RuntimePaths): Promise<DoctorFix> {
  let store: SqliteMemoryStore | undefined;

  try {
    store = await SqliteMemoryStore.open(paths);
    return { name: "Memory database", status: "fixed", message: `Initialized or migrated ${paths.memoryDbPath}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown SQLite error.";
    return { name: "Memory database", status: "failed", message: `Could not initialize ${paths.memoryDbPath}: ${message}` };
  } finally {
    store?.close();
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function checkTelegramBotIdentity(token: string, checker: TelegramIdentityChecker): Promise<DoctorCheck> {
  try {
    const identity = await checker(token);
    const label = identity.username ? `@${identity.username}` : `id ${identity.id}`;
    return {
      name: "Telegram bot identity",
      status: "pass",
      message: `Telegram bot is reachable as ${label}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Telegram identity error.";
    return {
      name: "Telegram bot identity",
      status: "fail",
      message: `Telegram bot identity check failed: ${message}`,
      fix: "Verify the Telegram bot token in .bestie/.env, then rerun `bestie doctor --telegram-connect`.",
    };
  }
}

async function getTelegramBotIdentity(token: string): Promise<TelegramBotIdentity> {
  const me = await new TelegramHttpClient(token).getMe();
  return { id: me.id, username: me.username };
}

async function checkZaloBotIdentity(token: string, checker: ZaloIdentityChecker): Promise<DoctorCheck> {
  try {
    const identity = await checker(token);
    const label = identity.username ? `@${identity.username}` : identity.firstName ? `${identity.firstName} (${identity.id})` : `id ${identity.id}`;
    return {
      name: "Zalo bot identity",
      status: "pass",
      message: `Zalo bot is reachable as ${label}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Zalo identity error.";
    return {
      name: "Zalo bot identity",
      status: "fail",
      message: `Zalo bot identity check failed: ${message}`,
      fix: "Verify the Zalo bot token in .bestie/.env, then rerun `bestie doctor --zalo-connect`.",
    };
  }
}

async function getZaloBotIdentity(token: string): Promise<ZaloBotIdentity> {
  const me: ZaloUser = await new ZaloHttpClient(token).getMe();
  return { id: me.id, username: me.username, firstName: me.first_name };
}

function checkMcpServers(servers: McpServerSummary[]): DoctorCheck {
  const disabled = servers.filter((server) => !server.enabled);
  const serversWithoutTools = servers.filter((server) => server.enabled && server.tools.length === 0);
  const toolCount = servers.reduce((count, server) => count + server.tools.length, 0);

  if (serversWithoutTools.length > 0) {
    return {
      name: "MCP servers",
      status: "warn",
      message: `${servers.length} MCP server config(s) found; missing tool classification: ${serversWithoutTools.map((server) => server.name).join(", ")}.`,
      fix: "Add mcp.servers[].tools entries with category read/local_write/external_write/public_action/destructive/money/unknown before calling tools.",
    };
  }

  if (disabled.length > 0) {
    return {
      name: "MCP servers",
      status: "warn",
      message: `${servers.length} MCP server config(s) found; ${toolCount} tool classification(s); disabled: ${disabled.map((server) => server.name).join(", ")}. Connection tests are not active yet.`,
      fix: "Use `bestie mcp show <name>` and `bestie mcp test <name>` to inspect config-only status.",
    };
  }

  return {
    name: "MCP servers",
    status: "pass",
    message: `${servers.length} MCP server config(s) found with ${toolCount} tool classification(s). Connection tests are not active yet.`,
  };
}

function checkTelegramConfig(telegramConfig: { enabled: boolean; botTokenEnv: string; ownerUserId: string }, envValues: Record<string, string>): DoctorCheck {
  if (!telegramConfig.ownerUserId.trim()) {
    return {
      name: "Telegram channel",
      status: "fail",
      message: "Telegram is enabled, but owner id or username is missing.",
      fix: "Set channels.telegram.ownerUserId to a numeric Telegram id, username, or @username before starting Telegram.",
    };
  }

  const hasToken = Boolean(process.env[telegramConfig.botTokenEnv] ?? envValues[telegramConfig.botTokenEnv]);
  return {
    name: "Telegram channel",
    status: hasToken ? "pass" : "fail",
    message: hasToken ? "Telegram bot token env is present." : `Telegram bot token env ${telegramConfig.botTokenEnv} is missing.`,
    fix: hasToken ? undefined : `Add ${telegramConfig.botTokenEnv} to .bestie/.env before starting Telegram.`,
  };
}

function checkZaloConfig(zaloConfig: { enabled: boolean; botTokenEnv: string; ownerUserId: string }, envValues: Record<string, string>): DoctorCheck {
  if (!zaloConfig.ownerUserId.trim()) {
    return {
      name: "Zalo channel",
      status: "fail",
      message: "Zalo is enabled, but owner user id is missing.",
      fix: "Set channels.zalo.ownerUserId in .bestie/config.json before starting Zalo.",
    };
  }

  const hasToken = Boolean(process.env[zaloConfig.botTokenEnv] ?? envValues[zaloConfig.botTokenEnv]);
  return {
    name: "Zalo channel",
    status: hasToken ? "pass" : "fail",
    message: hasToken ? "Zalo bot token env is present." : `Zalo bot token env ${zaloConfig.botTokenEnv} is missing.`,
    fix: hasToken ? undefined : `Add ${zaloConfig.botTokenEnv} to .bestie/.env before starting Zalo.`,
  };
}

function checkLlmTimeout(timeoutMs: number | undefined): DoctorCheck {
  if (timeoutMs === undefined) {
    return {
      name: "LLM timeout",
      status: "warn",
      message: `LLM request timeout is not configured. Using default ${DEFAULT_LLM_TIMEOUT_MS}ms.`,
      fix: `Add "timeoutMs": ${DEFAULT_LLM_TIMEOUT_MS} under llm in .bestie/config.json.`,
    };
  }

  if (timeoutMs < MIN_RECOMMENDED_LLM_TIMEOUT_MS) {
    return {
      name: "LLM timeout",
      status: "warn",
      message: `LLM request timeout is very low (${timeoutMs}ms). Slow providers may fail before they can respond.`,
      fix: `Set llm.timeoutMs to ${DEFAULT_LLM_TIMEOUT_MS} or higher in .bestie/config.json.`,
    };
  }

  if (timeoutMs > MAX_RECOMMENDED_LLM_TIMEOUT_MS) {
    return {
      name: "LLM timeout",
      status: "warn",
      message: `LLM request timeout is very high (${timeoutMs}ms). Chat may appear stuck for a long time when a provider hangs.`,
      fix: `Use a value near ${DEFAULT_LLM_TIMEOUT_MS} unless this provider consistently needs longer.`,
    };
  }

  return { name: "LLM timeout", status: "pass", message: `LLM request timeout is ${timeoutMs}ms.` };
}

function checkRuntimePaths(paths: RuntimePaths): DoctorCheck {
  const expectedPaths = [
    paths.configPath,
    paths.envPath,
    paths.characterPath,
    paths.systemPromptPath,
    paths.logsDir,
    paths.appLogPath,
    paths.dataDir,
    paths.memoryDbPath,
  ];
  const escapingPaths = expectedPaths.filter((path) => !isPathInside(paths.appDir, path));

  if (escapingPaths.length > 0) {
    return {
      name: "Runtime paths",
      status: "fail",
      message: `Runtime paths must stay inside ${paths.appDir}. Escaping paths: ${escapingPaths.join(", ")}.`,
      fix: "Use the repo-local .bestie directory or rerun onboarding from the project root.",
    };
  }

  return { name: "Runtime paths", status: "pass", message: `Runtime paths are contained in ${paths.appDir}.` };
}

async function checkLegacyRuntimeDirectory(paths: RuntimePaths): Promise<DoctorCheck> {
  const legacyAppDir = getLegacyAppDir(paths);

  if (!(await fileExists(legacyAppDir))) {
    return { name: "Legacy runtime directory", status: "pass", message: `No legacy ${LEGACY_APP_DIR_NAME} directory found.` };
  }

  if (await fileExists(paths.appDir)) {
    return {
      name: "Legacy runtime directory",
      status: "warn",
      message: `Legacy ${LEGACY_APP_DIR_NAME} directory still exists at ${legacyAppDir}; active runtime uses ${paths.appDir}.`,
      fix: `After verifying ${paths.appDir}, archive or remove ${legacyAppDir} manually.`,
    };
  }

  return {
    name: "Legacy runtime directory",
    status: "warn",
    message: `Legacy ${LEGACY_APP_DIR_NAME} directory found at ${legacyAppDir}, but ${paths.appDir} is missing.`,
    fix: "Run `bestie doctor --fix` to copy legacy local state into .bestie and rewrite legacy env names.",
  };
}

function getLegacyAppDir(paths: RuntimePaths): string {
  return resolve(paths.rootDir, LEGACY_APP_DIR_NAME);
}

function isPathInside(parent: string, child: string): boolean {
  const childRelativePath = relative(parent, child);

  return childRelativePath.length === 0 || (!childRelativePath.startsWith("..") && !childRelativePath.startsWith("/"));
}

function checkNodeVersion(): DoctorCheck {
  const majorVersion = Number(process.versions.node.split(".")[0]);
  const isSupported = Number.isInteger(majorVersion) && majorVersion >= 20;

  return {
    name: "Node.js",
    status: isSupported ? "pass" : "fail",
    message: `Node.js ${process.versions.node} ${isSupported ? "is supported" : "is too old"}.`,
    fix: isSupported ? undefined : "Install Node.js 20 or newer.",
  };
}

async function checkEnvFilePermissions(paths: RuntimePaths, platform = process.platform): Promise<DoctorCheck> {
  if (platform === "win32") {
    return {
      name: ".env permissions",
      status: "pass",
      message: ".env file exists; Windows ACLs are managed by the operating system.",
    };
  }

  try {
    const mode = (await stat(paths.envPath)).mode & 0o777;
    const isPrivate = (mode & 0o077) === 0;

    return {
      name: ".env permissions",
      status: isPrivate ? "pass" : "fail",
      message: isPrivate ? ".env is only readable by the owner." : `.env permissions are too broad (${mode.toString(8)}).`,
      fix: isPrivate ? undefined : `Run \`chmod 600 ${paths.envPath}\` to restrict local secrets to the owner.`,
    };
  } catch {
    return {
      name: ".env permissions",
      status: "fail",
      message: `.env permissions could not be inspected at ${paths.envPath}.`,
      fix: "Check .env file permissions manually.",
    };
  }
}

async function checkNonEmptyFile(name: string, path: string, fix: string): Promise<DoctorCheck> {
  try {
    const contents = await readFile(path, "utf8");
    const isNonEmpty = contents.trim().length > 0;

    return {
      name,
      status: isNonEmpty ? "pass" : "fail",
      message: isNonEmpty ? `${name} found.` : `${name} is empty at ${path}.`,
      fix: isNonEmpty ? undefined : fix,
    };
  } catch {
    return {
      name,
      status: "fail",
      message: `${name} missing at ${path}.`,
      fix,
    };
  }
}

async function checkWritableLogDir(paths: RuntimePaths): Promise<DoctorCheck> {
  try {
    await mkdir(paths.logsDir, { recursive: true });
    await access(paths.logsDir, constants.W_OK);
    return { name: "Log directory", status: "pass", message: `Log directory is writable at ${paths.logsDir}.` };
  } catch {
    return {
      name: "Log directory",
      status: "fail",
      message: `Log directory is not writable at ${paths.logsDir}.`,
      fix: "Check directory permissions or rerun onboarding from a writable project folder.",
    };
  }
}

async function checkLogFilePermissions(paths: RuntimePaths, platform = process.platform): Promise<DoctorCheck> {
  if (platform === "win32") {
    return {
      name: "Log file permissions",
      status: "pass",
      message: "Log file exists; Windows ACLs are managed by the operating system.",
    };
  }

  try {
    const mode = (await stat(paths.appLogPath)).mode & 0o777;
    const isPrivate = (mode & 0o077) === 0;

    return {
      name: "Log file permissions",
      status: isPrivate ? "pass" : "fail",
      message: isPrivate ? "Log file is only readable by the owner." : `Log file permissions are too broad (${mode.toString(8)}).`,
      fix: isPrivate ? undefined : `Run \`chmod 600 ${paths.appLogPath}\` to restrict local logs to the owner.`,
    };
  } catch {
    return {
      name: "Log file permissions",
      status: "fail",
      message: `Log file permissions could not be inspected at ${paths.appLogPath}.`,
      fix: "Check log file permissions manually.",
    };
  }
}

async function checkMemoryDatabase(paths: RuntimePaths): Promise<DoctorCheck> {
  let store: SqliteMemoryStore | undefined;

  try {
    store = await SqliteMemoryStore.open(paths);
    const missingColumns = getMissingMemoryColumns(store);

    if (missingColumns.length > 0) {
      return {
        name: "Memory database",
        status: "fail",
        message: `Memory database is missing expected columns: ${missingColumns.join(", ")}.`,
        fix: "Back up .bestie/data/memory.sqlite, then rerun `bestie doctor` to retry migrations.",
      };
    }

    return { name: "Memory database", status: "pass", message: `Memory database schema is ready at ${paths.memoryDbPath}.` };
  } catch {
    return {
      name: "Memory database",
      status: "fail",
      message: `Memory database is not writable at ${paths.memoryDbPath}.`,
      fix: "Check .bestie/data permissions or rerun from a writable project folder.",
    };
  } finally {
    store?.close();
  }
}

function getMissingMemoryColumns(store: SqliteMemoryStore): string[] {
  const requiredColumns = {
    memories: ["id", "type", "content", "sensitivity", "importance", "status", "source_message_id", "source", "explicit_consent", "policy_reason", "created_at", "updated_at"],
    messages: ["id", "channel", "user_id", "role", "content", "created_at"],
    pending_memories: ["id", "type", "content", "reason", "source", "explicit_consent", "created_at"],
    memory_state: ["key", "value", "updated_at"],
  } as const;

  return Object.entries(requiredColumns).flatMap(([table, columns]) => {
    const actualColumns = new Set(store.getTableColumns(table as keyof typeof requiredColumns));

    return columns.filter((column) => !actualColumns.has(column)).map((column) => `${table}.${column}`);
  });
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const CRON_MAX_RECOMMENDED_JOBS = 20;

async function checkCronHealth(paths: RuntimePaths): Promise<DoctorCheck> {
  let store: SqliteMemoryStore | undefined;

  try {
    store = await SqliteMemoryStore.open(paths);
    const activeCount = store.countActiveCronSchedules();

    if (activeCount > CRON_MAX_RECOMMENDED_JOBS) {
      return {
        name: "Cron schedules",
        status: "warn",
        message: `${activeCount} active cron schedules (recommended max: ${CRON_MAX_RECOMMENDED_JOBS}).`,
        fix: "Review `bestie cron list` and remove unused schedules to avoid excessive LLM calls.",
      };
    }

    if (activeCount > 0) {
      const schedules = store.listEnabledCronSchedules();
      const overdue = schedules.filter((s) => s.nextRunAt !== "" && new Date(s.nextRunAt) < new Date(Date.now() - 60_000));

      if (overdue.length > 0) {
        return {
          name: "Cron schedules",
          status: "warn",
          message: `${overdue.length} cron schedule(s) are overdue: ${overdue.map((s) => s.name).join(", ")}.`,
          fix: "Ensure the daemon is running (`bestie daemon start`) to process cron jobs.",
        };
      }
    }

    return { name: "Cron schedules", status: "pass", message: `${activeCount} active cron schedule(s).` };
  } catch {
    return { name: "Cron schedules", status: "pass", message: "No cron schedules configured." };
  } finally {
    store?.close();
  }
}
