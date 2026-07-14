import { execFileSync } from "node:child_process";
import { constants, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, delimiter, dirname, isAbsolute, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { access, appendFile, chmod, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { TelegramHttpClient, runTelegramPollingLoop, type TelegramAttachmentParseTelemetry, type TelegramAttachmentTranscriber, type TelegramChatCompletionRunner, type TelegramClient, type TelegramSpeechSynthesizer, type TelegramSpeechVoiceConverter, type TelegramUpdate } from "../../channels/telegram.js";
import { createAudioTranscription } from "../../llm/openai-transcription.js";
import { createSpeech } from "../../llm/openai-speech.js";
import type { FetchLike } from "../../llm/openai-compatible.js";
import { loadConfig, type AppConfig, writeConfig } from "../../runtime/config.js";
import { loadEnvFile, writeEnvFile } from "../../runtime/env.js";
import { UserFacingError } from "../../runtime/errors.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { badge, bold, color, dim, keyValue, table, title, withColorMode } from "../ui.js";

const DEFAULT_TELEGRAM_TOKEN_ENV = "BESTIE_TELEGRAM_BOT_TOKEN";
const DEFAULT_ELEVENLABS_API_KEY_ENV = "ELEVENLABS_API_KEY";
const DEFAULT_ELEVENLABS_VOICE_ID = "NOpBlnGInO9m6vDvFkFC";
const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_v3";
const DEFAULT_ELEVENLABS_TRANSCRIPTION_MODEL_ID = "scribe_v2";
const DEFAULT_ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";
const LOCAL_VOICE_WRAPPER_PATH = ".bestie/tools/local-whisper-transcribe.sh";
const LOCAL_WHISPER_COMMAND_PATH = ".bestie/tools/whisper-bin/whisper-cli";
const LOCAL_WHISPER_MODEL_PATH = ".bestie/models/ggml-small.bin";
const LOCAL_WHISPER_MODEL_DIR = ".bestie/models";
const WHISPER_MODEL_CATALOG: Record<string, { fileName: string; url: string; estimatedBytes: number; hint: string }> = {
  tiny: {
    fileName: "ggml-tiny.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    estimatedBytes: 78 * 1024 * 1024,
    hint: "fast, low quality for Vietnamese",
  },
  small: {
    fileName: "ggml-small.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    estimatedBytes: 488 * 1024 * 1024,
    hint: "recommended baseline for Vietnamese",
  },
  medium: {
    fileName: "ggml-medium.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
    estimatedBytes: 1_533 * 1024 * 1024,
    hint: "higher quality, slower and larger",
  },
  "large-v3-turbo": {
    fileName: "ggml-large-v3-turbo.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
    estimatedBytes: 1_620 * 1024 * 1024,
    hint: "best local quality class, slow and large",
  },
};
const LOCAL_VOICE_WRAPPER = `#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: local-whisper-transcribe.sh MODEL_PATH AUDIO_PATH [WHISPER_ARGS...]" >&2
  exit 2
fi

model_path="$1"
audio_path="$2"
shift 2

repo_root="$(cd "$(dirname "\${BASH_SOURCE[0]}")/../.." && pwd)"
whisper_cli="$repo_root/.bestie/tools/whisper-bin/whisper-cli"
tmp_wav="$(mktemp --suffix=.wav)"

cleanup() {
  rm -f "$tmp_wav"
}
trap cleanup EXIT

ffmpeg -hide_banner -loglevel error -y -i "$audio_path" -ar 16000 -ac 1 -c:a pcm_s16le "$tmp_wav"
"$whisper_cli" -m "$model_path" -f "$tmp_wav" -np -nt "$@"
`;

type AskLine = (question: string) => Promise<string>;

interface TelegramQuestioner {
  ask: AskLine;
  askHidden: AskLine;
  close: () => void;
}

interface TelegramCommandOptions {
  argv?: string[];
  paths?: RuntimePaths;
  questioner?: TelegramQuestioner;
  clientFactory?: (token: string) => TelegramClient;
  chatCompletion?: TelegramChatCompletionRunner;
  transcriptionFetchImpl?: FetchLike;
  speechFetchImpl?: FetchLike;
  speechVoiceConverter?: TelegramSpeechVoiceConverter;
  modelDownloadFetchImpl?: typeof fetch;
  writeLine?: (message: string) => void;
  useColor?: boolean;
}

interface TelegramSetupUi {
  intro: (paths: RuntimePaths) => void;
  section: (title: string, detail?: string) => void;
  success: (message: string) => void;
  info: (message: string) => void;
  savedPath: (label: string, path: string) => void;
  final: () => void;
}

export async function runTelegramCommand(optionsOrArgv: string[] | TelegramCommandOptions = process.argv): Promise<void> {
  const options = Array.isArray(optionsOrArgv) ? { argv: optionsOrArgv } : optionsOrArgv;
  const argv = options.argv ?? process.argv;
  const argStart = getTelegramArgStart(argv);
  const paths = options.paths ?? getRuntimePaths();
  const writeLine = options.writeLine ?? console.log;

  if (argv[argStart] === "voice" && argv[argStart + 1] === "setup-local") {
    await runTelegramVoiceLocalSetup({ paths, writeLine, useColor: options.useColor ?? output.isTTY });
    return;
  }

  if (argv[argStart] === "voice" && argv[argStart + 1] === "setup-elevenlabs") {
    await runTelegramVoiceElevenLabsSetup({ paths, questioner: options.questioner, writeLine, useColor: options.useColor ?? output.isTTY });
    return;
  }

  if (argv[argStart] === "voice" && argv[argStart + 1] === "models") {
    await runTelegramVoiceModels({ paths, writeLine, useColor: options.useColor ?? output.isTTY });
    return;
  }

  if (argv[argStart] === "voice" && argv[argStart + 1] === "download-model") {
    await runTelegramVoiceDownloadModel({ argv, modelKeyIndex: argStart + 2, paths, writeLine, useColor: options.useColor ?? output.isTTY, fetchImpl: options.modelDownloadFetchImpl ?? fetch });
    return;
  }

  if (argv.includes("setup")) {
    await runTelegramSetup({ paths, questioner: options.questioner, writeLine, useColor: options.useColor ?? output.isTTY });
    return;
  }

  const config = await loadConfig(paths);
  const telegram = config.channels?.telegram;

  if (!telegram?.enabled) {
    throw new UserFacingError("Telegram is not enabled. Add channels.telegram to .bestie/config.json, then set the bot token in .bestie/.env.", "TelegramNotEnabledError");
  }

  const envValues = await loadEnvFile(paths);
  const token = process.env[telegram.botTokenEnv] ?? envValues[telegram.botTokenEnv];
  const hasToken = Boolean(token);

  if (!hasToken) {
    throw new UserFacingError(`Telegram bot token env ${telegram.botTokenEnv} is missing. Add it to .bestie/.env.`, "TelegramMissingTokenError");
  }

  if (!telegram.ownerUserId.trim()) {
    throw new UserFacingError("Telegram owner user id is missing. Set channels.telegram.ownerUserId in .bestie/config.json.", "TelegramMissingOwnerError");
  }

  const transcriptPath = getTranscriptPath(argv, paths);
  const appendTranscript = transcriptPath ? createTranscriptAppender(transcriptPath) : undefined;
  const baseClient = options.clientFactory?.(token ?? "") ?? new TelegramHttpClient(token ?? "");
  const client = transcriptPath
    ? createTranscriptTelegramClient(baseClient, appendTranscript!, telegram.ownerUserId)
    : baseClient;
  const attachmentTranscriber = createTelegramAttachmentTranscriber(config, paths, options.transcriptionFetchImpl);
  const speechSynthesizer = createTelegramSpeechSynthesizer(config, paths, options.speechFetchImpl);

  writeLine(argv.includes("--once") ? "Telegram polling once." : "Telegram polling started. Press Ctrl+C to stop.");
  if (transcriptPath) {
    writeLine(`Telegram smoke transcript: ${transcriptPath}`);
  }
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await runTelegramPollingLoop({
      config,
      paths,
      client,
      once: argv.includes("--once"),
      shouldStop: () => stopping,
      chatCompletion: options.chatCompletion,
      attachmentTranscriber,
      speechSynthesizer,
      speechVoiceConverter: options.speechVoiceConverter,
      onAttachmentParsed: appendTranscript ? (attachment) => appendTranscript("telegram_attachment_parse", summarizeTelegramAttachmentParse(attachment)) : undefined,
    });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

function getTelegramArgStart(argv: string[]): number {
  return argv[2] === "channels" ? 4 : 3;
}

async function runTelegramVoiceModels(options: { paths: RuntimePaths; writeLine: (message: string) => void; useColor: boolean }): Promise<void> {
  const config = await loadConfig(options.paths);
  const configuredModelPath = config.transcription?.provider === "local-whisper" ? resolveMaybeRelative(options.paths.rootDir, config.transcription.modelPath) : undefined;
  const modelsDir = resolve(options.paths.rootDir, LOCAL_WHISPER_MODEL_DIR);
  const models = await listLocalWhisperModels(modelsDir);
  const render = withColorMode(options.useColor);

  options.writeLine(render(() => title("Telegram Voice Models")));
  options.writeLine(render(() => keyValue("Models dir", modelsDir)));
  if (models.length === 0) {
    options.writeLine(render(() => `${badge("INFO")} No local whisper.cpp .bin models found.`));
    options.writeLine(render(() => keyValue("Expected", ".bestie/models/ggml-small.bin")));
    return;
  }

  options.writeLine("");
  for (const line of render(() => table(
    ["Use", "Model", "Size", "Quality"],
    models.map((model) => [configuredModelPath === model.path ? "*" : "", model.name, formatBytes(model.bytes), describeLocalWhisperModel(model.name, config.agent.language)]),
  ))) {
    options.writeLine(line);
  }

  if (configuredModelPath) {
    options.writeLine(render(() => keyValue("Configured", configuredModelPath)));
  } else {
    options.writeLine(render(() => keyValue("Configured", "none; transcription.provider is not local-whisper.")));
  }
}

async function runTelegramVoiceDownloadModel(options: { argv: string[]; modelKeyIndex: number; paths: RuntimePaths; writeLine: (message: string) => void; useColor: boolean; fetchImpl: typeof fetch }): Promise<void> {
  const modelKey = options.argv[options.modelKeyIndex]?.trim();
  if (!modelKey || modelKey.startsWith("--")) {
    throw new UserFacingError(`Usage: bestie channels telegram voice download-model <${Object.keys(WHISPER_MODEL_CATALOG).join("|")}> [--confirm] [--use] [--force]`, "TelegramVoiceDownloadModelUsageError");
  }

  const model = WHISPER_MODEL_CATALOG[modelKey];
  if (!model) {
    throw new UserFacingError(`Unknown local voice model: ${modelKey}. Available: ${Object.keys(WHISPER_MODEL_CATALOG).join(", ")}.`, "TelegramVoiceDownloadModelUnknownError");
  }

  const confirm = options.argv.includes("--confirm");
  const useAfterDownload = options.argv.includes("--use");
  const force = options.argv.includes("--force");
  const modelPath = resolve(options.paths.rootDir, LOCAL_WHISPER_MODEL_DIR, model.fileName);
  const modelConfigPath = `${LOCAL_WHISPER_MODEL_DIR}/${model.fileName}`;
  const existingBytes = await getFileSize(modelPath);
  const render = withColorMode(options.useColor);

  options.writeLine(render(() => title("Telegram Voice Model")));
  options.writeLine(render(() => keyValue("Model", modelKey)));
  options.writeLine(render(() => keyValue("File", modelConfigPath)));
  options.writeLine(render(() => keyValue("Est. size", formatBytes(model.estimatedBytes))));
  options.writeLine(render(() => keyValue("Quality", model.hint)));
  options.writeLine(render(() => keyValue("Source", model.url)));

  if (!confirm) {
    if (existingBytes !== undefined) {
      options.writeLine(render(() => `${badge("WARN", "yellow")} Existing file: ${formatBytes(existingBytes)}; add --force with --confirm to overwrite.`));
    }
    options.writeLine(render(() => `${badge("INFO")} Dry run only. Add --confirm to download, and optionally --use to update .bestie/config.json.`));
    return;
  }

  if (existingBytes !== undefined && !force) {
    throw new UserFacingError(`Model already exists at ${modelConfigPath} (${formatBytes(existingBytes)}). Use --force to overwrite.`, "TelegramVoiceDownloadModelExistsError");
  }

  await mkdir(dirname(modelPath), { recursive: true });
  const tempPath = `${modelPath}.part`;
  await rm(tempPath, { force: true });

  const response = await options.fetchImpl(model.url);
  if (!response.ok || !response.body) {
    throw new UserFacingError(`Model download failed with HTTP ${response.status}.`, "TelegramVoiceDownloadModelHttpError");
  }

  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tempPath, { mode: 0o600 }));
  const downloadedBytes = await getRequiredFileSize(tempPath);
  if (downloadedBytes <= 0) {
    await rm(tempPath, { force: true });
    throw new UserFacingError("Model download produced an empty file.", "TelegramVoiceDownloadModelEmptyError");
  }

  const contentLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > 0 && downloadedBytes !== contentLength) {
    await rm(tempPath, { force: true });
    throw new UserFacingError(`Model download size mismatch: expected ${formatBytes(contentLength)}, got ${formatBytes(downloadedBytes)}.`, "TelegramVoiceDownloadModelSizeMismatchError");
  }

  await rename(tempPath, modelPath);
  options.writeLine(render(() => `${badge("DONE", "green")} Downloaded: ${modelConfigPath} (${formatBytes(downloadedBytes)})`));

  if (useAfterDownload) {
    const config = await loadConfig(options.paths);
    await writeConfig(enableTelegramVoiceLocalConfig(config, modelConfigPath), options.paths);
    options.writeLine(render(() => keyValue("Configured", modelConfigPath)));
    options.writeLine(render(() => keyValue("Language", getLocalWhisperLanguage(config.agent.language))));
  }
}

async function listLocalWhisperModels(modelsDir: string): Promise<Array<{ name: string; path: string; bytes: number }>> {
  let entries;
  try {
    entries = await readdir(modelsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const models = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".bin")) {
      continue;
    }

    const path = resolve(modelsDir, entry.name);
    const fileStat = await stat(path);
    models.push({ name: entry.name, path, bytes: fileStat.size });
  }

  return models.sort((left, right) => left.name.localeCompare(right.name));
}

function describeLocalWhisperModel(name: string, language: AppConfig["agent"]["language"]): string {
  const normalized = name.toLowerCase();
  if (normalized.includes("tiny")) {
    return language === "vi" || language === "mixed" ? "fast, low quality for Vietnamese" : "fast, low quality";
  }
  if (normalized.includes("small")) {
    return language === "vi" || language === "mixed" ? "recommended baseline for Vietnamese" : "balanced baseline";
  }
  if (normalized.includes("medium")) {
    return "higher quality, slower and larger";
  }
  if (normalized.includes("large")) {
    return "best quality class, slowest and largest";
  }
  return "unknown model size";
}

async function runTelegramVoiceLocalSetup(options: { paths: RuntimePaths; writeLine: (message: string) => void; useColor: boolean }): Promise<void> {
  const whisperCommandPath = resolve(options.paths.rootDir, LOCAL_WHISPER_COMMAND_PATH);
  const modelPath = resolve(options.paths.rootDir, LOCAL_WHISPER_MODEL_PATH);
  const wrapperPath = resolve(options.paths.rootDir, LOCAL_VOICE_WRAPPER_PATH);

  await requireExecutableFile(whisperCommandPath, `Local whisper binary is missing or not executable at ${LOCAL_WHISPER_COMMAND_PATH}.`);
  await requireReadableFile(modelPath, `Local whisper model is missing or unreadable at ${LOCAL_WHISPER_MODEL_PATH}.`);
  if (!(await commandExists("ffmpeg"))) {
    throw new UserFacingError("ffmpeg is required for Telegram Ogg/Opus voice conversion but was not found on PATH.", "TelegramVoiceLocalMissingFfmpegError");
  }

  const config = await loadConfig(options.paths);
  await mkdir(dirname(wrapperPath), { recursive: true });
  await writeFile(wrapperPath, LOCAL_VOICE_WRAPPER, { mode: 0o755 });
  await chmod(wrapperPath, 0o755);
  await writeConfig(enableTelegramVoiceLocalConfig(config), options.paths);
  const transcriptionLanguage = getLocalWhisperLanguage(config.agent.language);
  const render = withColorMode(options.useColor);

  options.writeLine(render(() => title("Telegram Local Voice")));
  options.writeLine(render(() => `${badge("DONE", "green")} Telegram local voice setup saved.`));
  options.writeLine(render(() => keyValue("Wrapper", LOCAL_VOICE_WRAPPER_PATH)));
  options.writeLine(render(() => keyValue("Whisper", LOCAL_WHISPER_COMMAND_PATH)));
  options.writeLine(render(() => keyValue("Model", LOCAL_WHISPER_MODEL_PATH)));
  options.writeLine(render(() => keyValue("Language", transcriptionLanguage)));
  options.writeLine(render(() => keyValue("Retention", "voice/audio files are deleted after processing.")));
  options.writeLine(render(() => `${badge("NEXT")} run \`bestie doctor\`, then send a short Telegram voice message.`));
}

async function runTelegramVoiceElevenLabsSetup(options: { paths: RuntimePaths; questioner?: TelegramQuestioner; writeLine: (message: string) => void; useColor: boolean }): Promise<void> {
  const questioner = options.questioner ?? createQuestioner();
  const render = withColorMode(options.useColor);

  try {
    const config = await loadConfig(options.paths);
    const apiKey = await questioner.askHidden("ElevenLabs API key: ");
    const voiceId = await askWithDefault(questioner.ask, "ElevenLabs voice id", DEFAULT_ELEVENLABS_VOICE_ID);
    const modelId = await askWithDefault(questioner.ask, "ElevenLabs TTS model id", DEFAULT_ELEVENLABS_MODEL_ID);
    const transcriptionModelId = await askWithDefault(questioner.ask, "ElevenLabs STT model id", DEFAULT_ELEVENLABS_TRANSCRIPTION_MODEL_ID);
    const outputFormat = await askWithDefault(questioner.ask, "ElevenLabs output format", DEFAULT_ELEVENLABS_OUTPUT_FORMAT);

    if (!apiKey.trim()) {
      throw new UserFacingError("ElevenLabs API key is required.", "TelegramVoiceElevenLabsMissingApiKeyError");
    }

    await mkdir(options.paths.appDir, { recursive: true });
    await writeConfig(
      enableTelegramVoiceElevenLabsConfig(config, {
        voiceId,
        modelId,
        transcriptionModelId,
        outputFormat,
      }),
      options.paths,
    );
    await writeEnvFile({ ...(await loadEnvFile(options.paths)), [DEFAULT_ELEVENLABS_API_KEY_ENV]: apiKey.trim() }, options.paths);

    options.writeLine(render(() => title("Telegram ElevenLabs Voice")));
    options.writeLine(render(() => `${badge("DONE", "green")} Telegram ElevenLabs voice reply setup saved.`));
    options.writeLine(render(() => keyValue("Provider", "elevenlabs")));
    options.writeLine(render(() => keyValue("API key env", `${DEFAULT_ELEVENLABS_API_KEY_ENV} in ${options.paths.envPath}`)));
    options.writeLine(render(() => keyValue("Voice id", voiceId)));
    options.writeLine(render(() => keyValue("TTS model", modelId)));
    options.writeLine(render(() => keyValue("STT model", transcriptionModelId)));
    options.writeLine(render(() => keyValue("Language", `agent.language (${config.agent.language})`)));
    options.writeLine(render(() => keyValue("Output", outputFormat)));
    options.writeLine(render(() => `${badge("NEXT")} run \`bestie doctor --telegram-speech-test\`, then send a short Telegram voice message.`));
  } finally {
    questioner.close();
  }
}

function createTelegramAttachmentTranscriber(config: AppConfig, paths: RuntimePaths, fetchImpl?: FetchLike): TelegramAttachmentTranscriber | undefined {
  if (config.channels?.telegram?.attachments?.transcriptionPolicy !== "allow" || !config.transcription) {
    return undefined;
  }

  return async (input) => ({
    text: await createAudioTranscription(
      config,
      { bytes: input.bytes, localPath: input.localPath, mimeType: input.mimeType },
      { paths, fetchImpl },
    ),
  });
}

function createTelegramSpeechSynthesizer(config: AppConfig, paths: RuntimePaths, fetchImpl?: FetchLike): TelegramSpeechSynthesizer | undefined {
  if (!config.speech) {
    return undefined;
  }

  return async (text) => createSpeech(config, { text }, { paths, fetchImpl });
}

async function runTelegramSetup(options: { paths: RuntimePaths; questioner?: TelegramQuestioner; writeLine: (message: string) => void; useColor?: boolean }): Promise<void> {
  const questioner = options.questioner ?? createQuestioner();
  const ui = createTelegramSetupUi(options.writeLine, options.useColor ?? output.isTTY);

  try {
    ui.intro(options.paths);

    ui.section("Account", "Connect one Telegram bot to this local runtime.");
    const config = await loadConfig(options.paths);
    const ownerUserId = (await questioner.ask("[1/2] Owner user id Telegram numeric user id allowed to chat with Bestie: ")).trim();
    const token = await questioner.askHidden("[2/2] Bot token Paste the Telegram bot token. It is hidden while typing: ");

    if (!ownerUserId) {
      throw new UserFacingError("Telegram owner user id is required.", "TelegramMissingOwnerError");
    }

    if (!token.trim()) {
      throw new UserFacingError("Telegram bot token is required.", "TelegramMissingTokenError");
    }

    ui.success("Telegram owner and bot token collected.");

    ui.section("Save", "Updating local config and secret env file.");
    await mkdir(options.paths.appDir, { recursive: true });
    await writeConfig(enableTelegramConfig(config, ownerUserId), options.paths);
    await writeEnvFile({ ...(await loadEnvFile(options.paths)), [DEFAULT_TELEGRAM_TOKEN_ENV]: token.trim() }, options.paths);

    ui.success("Telegram setup saved.");
    ui.section("Files", "Secrets stay local and are not printed.");
    ui.savedPath("Config", options.paths.configPath);
    ui.savedPath("Token env", `${DEFAULT_TELEGRAM_TOKEN_ENV} in ${options.paths.envPath}`);
    ui.info("Telegram is enabled for the configured owner user id only.");
    ui.final();
  } finally {
    questioner.close();
  }
}

function createTelegramSetupUi(writeLine: (message: string) => void, useColor: boolean): TelegramSetupUi {
  const render = withColorMode(useColor);

  return {
    intro: (paths) => {
      writeLine(render(() => title("Telegram Setup")));
      writeLine(render(() => dim("Connect a Telegram bot to your local Bestie runtime.")));
      writeLine(`${render(() => color("cyan", "Runtime"))} ${paths.appDir}`);
      writeLine(`${render(() => color("cyan", "Privacy"))} Bot tokens stay local in .bestie/.env and are hidden while typing.`);
      writeLine(render(() => `${dim("Plan")} Account -> Save -> Files\n`));
    },
    section: (sectionTitle, detail) => {
      writeLine(render(() => `${color("cyan", "\n>")} ${bold(sectionTitle)}${detail ? ` ${dim(detail)}` : ""}`));
    },
    success: (message) => writeLine(`${render(() => badge("OK", "green"))} ${message}`),
    info: (message) => writeLine(`${render(() => badge("INFO", "yellow"))} ${message}`),
    savedPath: (label, path) => writeLine(`  ${render(() => color("cyan", label.padEnd(10)))} ${path}`),
    final: () => {
      writeLine(`${render(() => badge("DONE", "green"))} Telegram setup complete.`);
      writeLine(`${render(() => dim("Next"))} Run \`bestie doctor\`, then \`bestie channels telegram --once\`.`);
    },
  };
}

function getTranscriptPath(argv: string[], paths: RuntimePaths): string | undefined {
  const transcriptIndex = argv.indexOf("--transcript");

  if (transcriptIndex === -1) {
    return undefined;
  }

  const value = argv[transcriptIndex + 1]?.trim();

  if (!value || value.startsWith("--")) {
    throw new UserFacingError("Telegram --transcript requires a file path.", "TelegramTranscriptPathError");
  }

  return resolve(paths.rootDir, value);
}

type TranscriptAppender = (event: string, detail: Record<string, unknown>) => Promise<void>;

function createTranscriptAppender(transcriptPath: string): TranscriptAppender {
  return async (event, detail) => {
    await mkdir(dirname(transcriptPath), { recursive: true });
    await appendFile(transcriptPath, `${JSON.stringify({ ts: new Date().toISOString(), event, detail })}\n`, { mode: 0o600 });
  };
}

function createTranscriptTelegramClient(client: TelegramClient, appendTranscript: TranscriptAppender, ownerUserId: string): TelegramClient {
  return {
    getUpdates: async (offset) => {
      await appendTranscript("telegram_get_updates_start", { offset });
      const updates = await client.getUpdates(offset);
      await appendTranscript("telegram_get_updates_finish", {
        count: updates.length,
        updates: updates.map((update) => summarizeTelegramUpdate(update, ownerUserId)),
      });
      return updates;
    },
    ...(client.getFile
      ? {
          getFile: async (fileId) => {
            await appendTranscript("telegram_get_file_start", { file: hashIdentifier(fileId) });
            const file = await client.getFile?.(fileId);
            await appendTranscript("telegram_get_file_finish", { file: hashIdentifier(fileId), hasFilePath: Boolean(file?.filePath), fileSize: file?.fileSize });
            if (!file) {
              throw new Error("Telegram getFile did not return file metadata.");
            }
            return file;
          },
        }
      : {}),
    ...(client.downloadFile
      ? {
          downloadFile: async (filePath) => {
            await appendTranscript("telegram_download_file_start", { filePathHash: hashIdentifier(filePath) });
            const bytes = await client.downloadFile?.(filePath);
            await appendTranscript("telegram_download_file_finish", { filePathHash: hashIdentifier(filePath), bytes: bytes?.byteLength ?? 0 });
            if (!bytes) {
              throw new Error("Telegram downloadFile did not return bytes.");
            }
            return bytes;
          },
        }
      : {}),
    sendMessage: async (chatId, text, options) => {
      await appendTranscript("telegram_send_message", summarizeTelegramOutbound(chatId, text));
      return client.sendMessage(chatId, text, options);
    },
    ...(client.sendAudio
      ? {
          sendAudio: async (chatId, audio, options) => {
            await appendTranscript("telegram_send_audio", { chat: hashIdentifier(chatId), bytes: audio.byteLength, mimeType: options?.mimeType });
            await client.sendAudio?.(chatId, audio, options);
          },
        }
      : {}),
    ...(client.sendVoice
      ? {
          sendVoice: async (chatId, voice, options) => {
            await appendTranscript("telegram_send_voice", { chat: hashIdentifier(chatId), bytes: voice.byteLength, mimeType: options?.mimeType });
            await client.sendVoice?.(chatId, voice, options);
          },
        }
      : {}),
    editMessageText: async (chatId, messageId, text) => {
      await appendTranscript("telegram_edit_message_text", summarizeTelegramOutbound(chatId, text));
      await client.editMessageText(chatId, messageId, text);
    },
    sendChatAction: async (chatId, action) => {
      await appendTranscript("telegram_send_chat_action", { chat: hashIdentifier(chatId), action });
      await client.sendChatAction(chatId, action);
    },
    setMyCommands: async (commands) => {
      await appendTranscript("telegram_set_my_commands", { commands: commands.map((command) => command.command) });
      await client.setMyCommands(commands);
    },
  };
}

function summarizeTelegramAttachmentParse(attachment: TelegramAttachmentParseTelemetry): Record<string, unknown> {
  return {
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    telegramFileSize: attachment.telegramFileSize,
    savedBytes: attachment.savedBytes,
    contentParser: attachment.contentParser,
    hasTextPreview: attachment.hasTextPreview,
    textPreviewTruncated: attachment.textPreviewTruncated,
    hasParseWarning: attachment.hasParseWarning,
    hasVisionInput: attachment.hasVisionInput,
    hasAudioTranscript: attachment.hasAudioTranscript,
    audioTranscriptTruncated: attachment.audioTranscriptTruncated,
    hasTranscriptionWarning: attachment.hasTranscriptionWarning,
  };
}

function summarizeTelegramUpdate(update: TelegramUpdate, ownerUserId: string): Record<string, unknown> {
  const message = update.message;
  const text = message?.text ?? "";
  const caption = message?.caption ?? "";
  const attachmentKind = getTelegramTranscriptAttachmentKind(message);

  return {
    updateId: update.update_id,
    chat: message ? hashIdentifier(message.chat.id) : undefined,
    fromOwner: String(message?.from?.id ?? "") === ownerUserId,
    textLength: text.length,
    captionLength: caption.length,
    hasText: text.length > 0,
    hasAttachment: attachmentKind !== undefined,
    attachmentKind,
  };
}

function getTelegramTranscriptAttachmentKind(message: TelegramUpdate["message"] | undefined): string | undefined {
  if (!message) return undefined;
  if (message.photo?.length) return "photo";
  if (message.document) return "document";
  if (message.voice) return "voice";
  if (message.audio) return "audio";
  if (message.video) return "video";
  if (message.sticker) return "sticker";
  return undefined;
}

function summarizeTelegramOutbound(chatId: number, text: string): Record<string, unknown> {
  const isProgress = isTelegramToolProgressText(text);

  return {
    chat: hashIdentifier(chatId),
    kind: isProgress ? "tool_progress" : "reply",
    textLength: text.length,
    progressLabel: isProgress ? text.replace(/^.+? is\s*/, "") : undefined,
  };
}

export function isTelegramToolProgressText(text: string): boolean {
  return [
    /^.+? is working(?:\s|$)/,
    /^.+? is listing files in(?:\s|$)/,
    /^.+? is reading file(?:\s|$)/,
    /^.+? is reading files(?:\s|$)/,
    /^.+? is collecting Markdown docs from(?:\s|$)/,
    /^.+? is searching files for(?:\s|$)/,
    /^.+? is reading recent logs$/,
    /^.+? is listing saved memories$/,
    /^.+? is searching memories for(?:\s|$)/,
    /^.+? is preparing a memory approval$/,
    /^.+? is using read tool(?:\s|$)/,
  ].some((pattern) => pattern.test(text));
}

function hashIdentifier(value: number | string): string {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function enableTelegramConfig(config: AppConfig, ownerUserId: string): AppConfig {
  return {
    ...config,
    channels: {
      ...config.channels,
      telegram: {
        enabled: true,
        botTokenEnv: DEFAULT_TELEGRAM_TOKEN_ENV,
        ownerUserId,
      },
    },
  };
}

function enableTelegramVoiceLocalConfig(config: AppConfig, modelPath = LOCAL_WHISPER_MODEL_PATH): AppConfig {
  const telegram = config.channels?.telegram;
  const attachments = telegram?.attachments;
  const transcriptionLanguage = getLocalWhisperLanguage(config.agent.language);

  return {
    ...config,
    transcription: {
      provider: "local-whisper",
      command: LOCAL_VOICE_WRAPPER_PATH,
      args: ["{modelPath}", "{audioPath}", "-l", transcriptionLanguage],
      modelPath,
      timeoutMs: 120_000,
    },
    channels: {
      ...config.channels,
      telegram: {
        enabled: telegram?.enabled ?? false,
        botTokenEnv: telegram?.botTokenEnv ?? DEFAULT_TELEGRAM_TOKEN_ENV,
        ownerUserId: telegram?.ownerUserId ?? "",
        attachments: {
          ...attachments,
          downloadPolicy: "allow",
          transcriptionPolicy: "allow",
          transcriptionMaxBytes: attachments?.transcriptionMaxBytes ?? 10_485_760,
          deleteAfterProcessingKinds: mergeUnique([...(attachments?.deleteAfterProcessingKinds ?? []), "voice", "audio"]),
          allowedMimeTypes: mergeUnique([...(attachments?.allowedMimeTypes ?? []), "audio/*"]),
        },
      },
    },
  };
}

function enableTelegramVoiceElevenLabsConfig(
  config: AppConfig,
  speech: { voiceId: string; modelId: string; transcriptionModelId: string; outputFormat: string },
): AppConfig {
  const telegram = config.channels?.telegram;
  const attachments = telegram?.attachments;

  return {
    ...config,
    transcription: {
      provider: "elevenlabs",
      apiKeyEnv: DEFAULT_ELEVENLABS_API_KEY_ENV,
      modelId: speech.transcriptionModelId,
      tagAudioEvents: true,
      diarize: false,
      timeoutMs: config.transcription?.timeoutMs ?? 120_000,
    },
    speech: {
      provider: "elevenlabs",
      apiKeyEnv: DEFAULT_ELEVENLABS_API_KEY_ENV,
      voiceId: speech.voiceId,
      modelId: speech.modelId,
      outputFormat: speech.outputFormat,
      timeoutMs: config.speech?.timeoutMs ?? 60_000,
    },
    channels: {
      ...config.channels,
      telegram: {
        enabled: telegram?.enabled ?? false,
        botTokenEnv: telegram?.botTokenEnv ?? DEFAULT_TELEGRAM_TOKEN_ENV,
        ownerUserId: telegram?.ownerUserId ?? "",
        voiceReplyPolicy: "voice-input-only",
        voiceReplyMaxChars: telegram?.voiceReplyMaxChars ?? 800,
        voiceReplyCooldownMs: telegram?.voiceReplyCooldownMs ?? 30_000,
        attachments: {
          ...attachments,
          downloadPolicy: "allow",
          transcriptionPolicy: "allow",
          transcriptionMaxBytes: attachments?.transcriptionMaxBytes ?? 10_485_760,
          deleteAfterProcessingKinds: mergeUnique([...(attachments?.deleteAfterProcessingKinds ?? []), "voice", "audio"]),
          allowedMimeTypes: mergeUnique([...(attachments?.allowedMimeTypes ?? []), "audio/*"]),
        },
      },
    },
  };
}

async function askWithDefault(ask: AskLine, label: string, defaultValue: string): Promise<string> {
  const answer = (await ask(`${label} [${defaultValue}]: `)).trim();
  return answer || defaultValue;
}

function getLocalWhisperLanguage(language: AppConfig["agent"]["language"]): string {
  if (isAutoLanguage(language)) {
    return "auto";
  }
  return language;
}

function isAutoLanguage(language: string): boolean {
  const normalized = language.toLowerCase();
  return normalized === "mixed" || normalized === "auto";
}

async function getFileSize(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size;
  } catch {
    return undefined;
  }
}

async function getRequiredFileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}

function mergeUnique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

async function requireExecutableFile(path: string, message: string): Promise<void> {
  try {
    await access(path, constants.X_OK);
  } catch {
    throw new UserFacingError(message, "TelegramVoiceLocalMissingExecutableError");
  }
}

async function requireReadableFile(path: string, message: string): Promise<void> {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new UserFacingError(message, "TelegramVoiceLocalMissingModelError");
  }
}

async function commandExists(command: string): Promise<boolean> {
  for (const pathEntry of (process.env.PATH ?? "").split(delimiter)) {
    if (!pathEntry) {
      continue;
    }

    const candidate = isAbsolute(command) ? command : resolve(pathEntry, command);
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      // Keep searching PATH.
    }
  }

  return false;
}

function resolveMaybeRelative(rootDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(rootDir, path);
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

function createQuestioner(): TelegramQuestioner {
  if (!input.isTTY) {
    const lines = readFileSync(0, "utf8").split(/\r?\n/);
    let index = 0;

    return {
      ask: async (question) => {
        output.write(question);
        return lines[index++] ?? "";
      },
      askHidden: async (question) => {
        output.write(question);
        return lines[index++] ?? "";
      },
      close: () => undefined,
    };
  }

  const rl = createInterface({ input, output });

  return {
    ask: (question) => rl.question(question),
    askHidden: async (question) => {
      output.write(question);
      setTerminalEcho(false);
      try {
        return await rl.question("");
      } finally {
        setTerminalEcho(true);
        output.write("\n");
      }
    },
    close: () => rl.close(),
  };
}

function setTerminalEcho(enabled: boolean): void {
  try {
    execFileSync("stty", [enabled ? "echo" : "-echo"], { stdio: ["inherit", "ignore", "ignore"] });
  } catch {
    // If stty is unavailable, continue rather than blocking Telegram setup.
  }
}
