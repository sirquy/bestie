import { constants } from "node:fs";
import { createWriteStream } from "node:fs";
import { access, chmod, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { stdout as output } from "node:process";

import { loadConfig, type AppConfig, writeConfig } from "../../runtime/config.js";
import { loadEnvFile, writeEnvFile } from "../../runtime/env.js";
import { UserFacingError } from "../../runtime/errors.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { createCliQuestioner } from "../prompt.js";
import { badge, keyValue, table, title, withColorMode } from "../ui.js";

const DEFAULT_TELEGRAM_TOKEN_ENV = "BESTIE_TELEGRAM_BOT_TOKEN";
const DEFAULT_ELEVENLABS_API_KEY_ENV = "ELEVENLABS_API_KEY";
const DEFAULT_ELEVENLABS_VOICE_ID = "NOpBlnGInO9m6vDvFkFC";
const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_v3";
const DEFAULT_ELEVENLABS_TRANSCRIPTION_MODEL_ID = "scribe_v2";
const DEFAULT_ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";
const DEFAULT_VOICEBOX_BASE_URL = "http://127.0.0.1:17493";
const DEFAULT_VOICEBOX_CLIENT_ID = "bestie";
const DEFAULT_VOICEBOX_ENGINE = "qwen";
const DEFAULT_VOICEBOX_STT_MODEL = "turbo";
const VOICEBOX_SUPPORTED_LANGUAGES = new Set(["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it", "he", "ar", "da", "el", "fi", "hi", "ms", "nl", "no", "pl", "sv", "sw", "tr"]);
const LOCAL_VOICE_WRAPPER_PATH = ".bestie/tools/local-whisper-transcribe.sh";
const LOCAL_WHISPER_COMMAND_PATH = ".bestie/tools/whisper-bin/whisper-cli";
const LOCAL_WHISPER_MODEL_PATH = ".bestie/models/ggml-small.bin";
const LOCAL_WHISPER_MODEL_DIR = ".bestie/models";
const WHISPER_MODEL_CATALOG: Record<string, { fileName: string; url: string; estimatedBytes: number; hint: string }> = {
  tiny: {
    fileName: "ggml-tiny.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    estimatedBytes: 78 * 1024 * 1024,
    hint: "nhanh, chất lượng thấp với tiếng Việt",
  },
  small: {
    fileName: "ggml-small.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    estimatedBytes: 488 * 1024 * 1024,
    hint: "mốc khuyến nghị cho tiếng Việt",
  },
  medium: {
    fileName: "ggml-medium.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
    estimatedBytes: 1_533 * 1024 * 1024,
    hint: "chất lượng cao hơn, chậm hơn và lớn hơn",
  },
  "large-v3-turbo": {
    fileName: "ggml-large-v3-turbo.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
    estimatedBytes: 1_620 * 1024 * 1024,
    hint: "nhóm chất lượng local tốt nhất, chậm và lớn",
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

interface VoiceQuestioner {
  ask: AskLine;
  askHidden: AskLine;
  close: () => void;
}

interface VoiceCommandOptions {
  argv?: string[];
  paths?: RuntimePaths;
  questioner?: VoiceQuestioner;
  modelDownloadFetchImpl?: typeof fetch;
  writeLine?: (message: string) => void;
  useColor?: boolean;
}

export async function runVoiceCommand(optionsOrArgv: string[] | VoiceCommandOptions = process.argv): Promise<void> {
  const options = Array.isArray(optionsOrArgv) ? { argv: optionsOrArgv } : optionsOrArgv;
  const argv = options.argv ?? process.argv;
  const paths = options.paths ?? getRuntimePaths();
  const writeLine = options.writeLine ?? console.log;
  const argStart = getVoiceArgStart(argv);
  const subcommand = argv[argStart] ?? "models";

  if (subcommand === "setup-local") {
    await runVoiceLocalSetup({ paths, writeLine, useColor: options.useColor ?? output.isTTY });
    return;
  }

  if (subcommand === "setup-elevenlabs") {
    await runVoiceElevenLabsSetup({ paths, questioner: options.questioner, writeLine, useColor: options.useColor ?? output.isTTY });
    return;
  }

  if (subcommand === "setup-voicebox") {
    await runVoiceboxSetup({ paths, questioner: options.questioner, writeLine, useColor: options.useColor ?? output.isTTY });
    return;
  }

  if (subcommand === "models") {
    await runVoiceModels({ paths, writeLine, useColor: options.useColor ?? output.isTTY });
    return;
  }

  if (subcommand === "download-model") {
    await runVoiceDownloadModel({ argv, modelKeyIndex: argStart + 1, paths, writeLine, useColor: options.useColor ?? output.isTTY, fetchImpl: options.modelDownloadFetchImpl ?? fetch });
    return;
  }

  throw new UserFacingError("Cách dùng: bestie voice setup-local|setup-elevenlabs|setup-voicebox|models|download-model", "VoiceUsageError");
}

function getVoiceArgStart(argv: string[]): number {
  if (argv[2] === "voice") return 3;
  return 3;
}

async function runVoiceModels(options: { paths: RuntimePaths; writeLine: (message: string) => void; useColor: boolean }): Promise<void> {
  const config = await loadConfig(options.paths);
  const configuredModelPath = config.transcription?.provider === "local-whisper" ? resolveMaybeRelative(options.paths.rootDir, config.transcription.modelPath) : undefined;
  const modelsDir = resolve(options.paths.rootDir, LOCAL_WHISPER_MODEL_DIR);
  const models = await listLocalWhisperModels(modelsDir);
  const render = withColorMode(options.useColor);

  options.writeLine(render(() => title("Model giọng nói Bestie")));
  options.writeLine(render(() => keyValue("Thư mục model", modelsDir)));
  if (models.length === 0) {
    options.writeLine(render(() => `${badge("INFO")} Chưa tìm thấy model whisper.cpp .bin cục bộ.`));
    options.writeLine(render(() => keyValue("Dự kiến", ".bestie/models/ggml-small.bin")));
    return;
  }

  options.writeLine("");
  for (const line of render(() => table(
    ["Dùng", "Model", "Dung lượng", "Chất lượng"],
    models.map((model) => [configuredModelPath === model.path ? "*" : "", model.name, formatBytes(model.bytes), describeLocalWhisperModel(model.name, config.agent.language)]),
  ))) {
    options.writeLine(line);
  }

  if (configuredModelPath) {
    options.writeLine(render(() => keyValue("Đã cấu hình", configuredModelPath)));
  } else {
    options.writeLine(render(() => keyValue("Đã cấu hình", "chưa có; transcription.provider không phải local-whisper.")));
  }
}

async function runVoiceDownloadModel(options: { argv: string[]; modelKeyIndex: number; paths: RuntimePaths; writeLine: (message: string) => void; useColor: boolean; fetchImpl: typeof fetch }): Promise<void> {
  const modelKey = options.argv[options.modelKeyIndex]?.trim();
  if (!modelKey || modelKey.startsWith("--")) {
    throw new UserFacingError(`Cách dùng: bestie voice download-model <${Object.keys(WHISPER_MODEL_CATALOG).join("|")}> [--confirm] [--use] [--force]`, "VoiceDownloadModelUsageError");
  }

  const model = WHISPER_MODEL_CATALOG[modelKey];
  if (!model) {
    throw new UserFacingError(`Model giọng nói local không xác định: ${modelKey}. Hiện có: ${Object.keys(WHISPER_MODEL_CATALOG).join(", ")}.`, "VoiceDownloadModelUnknownError");
  }

  const confirm = options.argv.includes("--confirm");
  const useAfterDownload = options.argv.includes("--use");
  const force = options.argv.includes("--force");
  const modelPath = resolve(options.paths.rootDir, LOCAL_WHISPER_MODEL_DIR, model.fileName);
  const modelConfigPath = `${LOCAL_WHISPER_MODEL_DIR}/${model.fileName}`;
  const existingBytes = await getFileSize(modelPath);
  const render = withColorMode(options.useColor);

  options.writeLine(render(() => title("Model giọng nói Bestie")));
  options.writeLine(render(() => keyValue("Model", modelKey)));
  options.writeLine(render(() => keyValue("File", modelConfigPath)));
  options.writeLine(render(() => keyValue("Dung lượng ước tính", formatBytes(model.estimatedBytes))));
  options.writeLine(render(() => keyValue("Chất lượng", model.hint)));
  options.writeLine(render(() => keyValue("Nguồn", model.url)));

  if (!confirm) {
    if (existingBytes !== undefined) {
      options.writeLine(render(() => `${badge("WARN", "yellow")} File đã tồn tại: ${formatBytes(existingBytes)}; thêm --force cùng --confirm để ghi đè.`));
    }
    options.writeLine(render(() => `${badge("INFO")} Chỉ chạy thử. Thêm --confirm để tải xuống, và có thể thêm --use để cập nhật .bestie/config.json.`));
    return;
  }

  if (existingBytes !== undefined && !force) {
    throw new UserFacingError(`Model đã tồn tại tại ${modelConfigPath} (${formatBytes(existingBytes)}). Dùng --force để ghi đè.`, "VoiceDownloadModelExistsError");
  }

  await mkdir(dirname(modelPath), { recursive: true });
  const tempPath = `${modelPath}.part`;
  await rm(tempPath, { force: true });

  const response = await options.fetchImpl(model.url);
  if (!response.ok || !response.body) {
    throw new UserFacingError(`Tải model thất bại với HTTP ${response.status}.`, "VoiceDownloadModelHttpError");
  }

  await pipeline(Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tempPath, { mode: 0o600 }));
  const downloadedBytes = await getRequiredFileSize(tempPath);
  if (downloadedBytes <= 0) {
    await rm(tempPath, { force: true });
    throw new UserFacingError("Tải model tạo ra file rỗng.", "VoiceDownloadModelEmptyError");
  }

  const contentLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > 0 && downloadedBytes !== contentLength) {
    await rm(tempPath, { force: true });
    throw new UserFacingError(`Dung lượng model tải về không khớp: dự kiến ${formatBytes(contentLength)}, nhận ${formatBytes(downloadedBytes)}.`, "VoiceDownloadModelSizeMismatchError");
  }

  await rename(tempPath, modelPath);
  options.writeLine(render(() => `${badge("DONE", "green")} Đã tải: ${modelConfigPath} (${formatBytes(downloadedBytes)})`));

  if (useAfterDownload) {
    const config = await loadConfig(options.paths);
    await writeConfig(enableVoiceLocalConfig(config, modelConfigPath), options.paths);
    options.writeLine(render(() => keyValue("Đã cấu hình", modelConfigPath)));
    options.writeLine(render(() => keyValue("Ngôn ngữ", getLocalWhisperLanguage(config.agent.language))));
  }
}

async function runVoiceLocalSetup(options: { paths: RuntimePaths; writeLine: (message: string) => void; useColor: boolean }): Promise<void> {
  const whisperCommandPath = resolve(options.paths.rootDir, LOCAL_WHISPER_COMMAND_PATH);
  const modelPath = resolve(options.paths.rootDir, LOCAL_WHISPER_MODEL_PATH);
  const wrapperPath = resolve(options.paths.rootDir, LOCAL_VOICE_WRAPPER_PATH);

  await requireExecutableFile(whisperCommandPath, `Thiếu binary whisper local hoặc file không executable tại ${LOCAL_WHISPER_COMMAND_PATH}.`);
  await requireReadableFile(modelPath, `Thiếu model whisper local hoặc không đọc được tại ${LOCAL_WHISPER_MODEL_PATH}.`);
  if (!(await commandExists("ffmpeg"))) {
    throw new UserFacingError("Cần ffmpeg để chuyển đổi voice nhưng không tìm thấy trong PATH.", "VoiceLocalMissingFfmpegError");
  }

  const config = await loadConfig(options.paths);
  await mkdir(dirname(wrapperPath), { recursive: true });
  await writeFile(wrapperPath, LOCAL_VOICE_WRAPPER, { mode: 0o755 });
  await chmod(wrapperPath, 0o755);
  await writeConfig(enableVoiceLocalConfig(config), options.paths);
  const transcriptionLanguage = getLocalWhisperLanguage(config.agent.language);
  const render = withColorMode(options.useColor);

  options.writeLine(render(() => title("Giọng nói local Bestie")));
  options.writeLine(render(() => `${badge("DONE", "green")} Đã lưu cấu hình giọng nói local.`));
  options.writeLine(render(() => keyValue("Wrapper", LOCAL_VOICE_WRAPPER_PATH)));
  options.writeLine(render(() => keyValue("Whisper", LOCAL_WHISPER_COMMAND_PATH)));
  options.writeLine(render(() => keyValue("Model", LOCAL_WHISPER_MODEL_PATH)));
  options.writeLine(render(() => keyValue("Ngôn ngữ", transcriptionLanguage)));
  options.writeLine(render(() => keyValue("Lưu giữ", "file voice/audio sẽ bị xóa sau khi xử lý.")));
  options.writeLine(render(() => `${badge("NEXT")} chạy \`bestie doctor\`, rồi gửi một voice message ngắn.`));
}

async function runVoiceElevenLabsSetup(options: { paths: RuntimePaths; questioner?: VoiceQuestioner; writeLine: (message: string) => void; useColor: boolean }): Promise<void> {
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
      throw new UserFacingError("Bắt buộc phải có ElevenLabs API key.", "VoiceElevenLabsMissingApiKeyError");
    }

    await mkdir(options.paths.appDir, { recursive: true });
    await writeConfig(
      enableVoiceElevenLabsConfig(config, {
        voiceId,
        modelId,
        transcriptionModelId,
        outputFormat,
      }),
      options.paths,
    );
    await writeEnvFile({ ...(await loadEnvFile(options.paths)), [DEFAULT_ELEVENLABS_API_KEY_ENV]: apiKey.trim() }, options.paths);

    options.writeLine(render(() => title("Giọng nói ElevenLabs cho Bestie")));
    options.writeLine(render(() => `${badge("DONE", "green")} Đã lưu cấu hình giọng nói ElevenLabs.`));
    options.writeLine(render(() => keyValue("Nhà cung cấp", "elevenlabs")));
    options.writeLine(render(() => keyValue("API key env", `${DEFAULT_ELEVENLABS_API_KEY_ENV} in ${options.paths.envPath}`)));
    options.writeLine(render(() => keyValue("Voice id", voiceId)));
    options.writeLine(render(() => keyValue("TTS model", modelId)));
    options.writeLine(render(() => keyValue("STT model", transcriptionModelId)));
    options.writeLine(render(() => keyValue("Ngôn ngữ", `agent.language (${config.agent.language})`)));
    options.writeLine(render(() => keyValue("Đầu ra", outputFormat)));
    options.writeLine(render(() => `${badge("NEXT")} chạy \`bestie doctor --telegram-speech-test\`, rồi gửi một voice message ngắn.`));
  } finally {
    questioner.close();
  }
}

async function runVoiceboxSetup(options: { paths: RuntimePaths; questioner?: VoiceQuestioner; writeLine: (message: string) => void; useColor: boolean }): Promise<void> {
  const questioner = options.questioner ?? createQuestioner();
  const render = withColorMode(options.useColor);

  try {
    const config = await loadConfig(options.paths);
    const baseUrl = normalizeBaseUrl(await askWithDefault(questioner.ask, "Voicebox server URL", config.speech?.provider === "voicebox" ? config.speech.baseUrl : DEFAULT_VOICEBOX_BASE_URL));
    const clientId = await askWithDefault(questioner.ask, "Voicebox client id", config.speech?.provider === "voicebox" ? config.speech.clientId ?? DEFAULT_VOICEBOX_CLIENT_ID : DEFAULT_VOICEBOX_CLIENT_ID);
    const profile = (await questioner.ask("Voice profile name/id (blank = Voicebox default binding): ")).trim();
    const engine = parseVoiceboxEngine(await askWithDefault(questioner.ask, "TTS engine", config.speech?.provider === "voicebox" ? config.speech.engine ?? DEFAULT_VOICEBOX_ENGINE : DEFAULT_VOICEBOX_ENGINE));
    const speechLanguage = await askWithDefault(questioner.ask, "Speech language", getVoiceboxLanguage(config.agent.language));
    const transcriptionModel = parseVoiceboxSttModel(await askWithDefault(questioner.ask, "Whisper STT model", config.transcription?.provider === "voicebox" ? config.transcription.model ?? DEFAULT_VOICEBOX_STT_MODEL : DEFAULT_VOICEBOX_STT_MODEL));
    const transcriptionLanguage = await askWithDefault(questioner.ask, "Transcription language", getVoiceboxLanguage(config.agent.language));
    const personality = await askYesNo(questioner.ask, "Use Voicebox profile personality rewrite by default?", false);

    const nextConfig = enableVoiceboxConfig(config, {
      baseUrl,
      clientId,
      profile,
      engine,
      speechLanguage,
      transcriptionModel,
      transcriptionLanguage,
      personality,
    });

    await writeConfig(nextConfig, options.paths);

    options.writeLine(render(() => title("Voicebox cho Bestie")));
    options.writeLine(render(() => keyValue("Server", baseUrl)));
    options.writeLine(render(() => keyValue("Client id", clientId)));
    options.writeLine(render(() => keyValue("Voice profile", profile || "Voicebox default binding")));
    options.writeLine(render(() => keyValue("TTS engine", engine)));
    options.writeLine(render(() => keyValue("STT model", transcriptionModel)));
    options.writeLine(render(() => keyValue("Personality", personality ? "on" : "off")));
    options.writeLine(render(() => `${badge("OK", "green")} Saved local Voicebox voice config.`));
    options.writeLine(render(() => `${badge("NEXT")} Start Voicebox, choose a voice binding for client id \`${clientId}\` if no profile was entered, then send a short voice message.`));
  } finally {
    questioner.close();
  }
}

function enableVoiceLocalConfig(config: AppConfig, modelPath = LOCAL_WHISPER_MODEL_PATH): AppConfig {
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
      telegram: telegram
        ? {
            ...telegram,
            attachments: enableVoiceAttachmentConfig(attachments),
          }
        : undefined,
    },
  };
}

function enableVoiceElevenLabsConfig(config: AppConfig, speech: { voiceId: string; modelId: string; transcriptionModelId: string; outputFormat: string }): AppConfig {
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
      telegram: telegram
        ? {
            ...telegram,
            voiceReplyPolicy: "voice-input-only",
            voiceReplyMaxChars: telegram.voiceReplyMaxChars ?? 800,
            voiceReplyCooldownMs: telegram.voiceReplyCooldownMs ?? 30_000,
            attachments: enableVoiceAttachmentConfig(attachments),
          }
        : undefined,
    },
  };
}

function enableVoiceboxConfig(config: AppConfig, voicebox: { baseUrl: string; clientId: string; profile: string; engine: "qwen" | "qwen_custom_voice" | "luxtts" | "chatterbox" | "chatterbox_turbo" | "tada" | "kokoro"; speechLanguage: string; transcriptionModel: "base" | "small" | "medium" | "large" | "turbo"; transcriptionLanguage: string; personality: boolean }): AppConfig {
  const telegram = config.channels?.telegram;
  const attachments = telegram?.attachments;

  return {
    ...config,
    transcription: {
      provider: "voicebox",
      baseUrl: voicebox.baseUrl,
      model: voicebox.transcriptionModel,
      language: voicebox.transcriptionLanguage,
      clientId: voicebox.clientId,
      timeoutMs: config.transcription?.timeoutMs ?? 120_000,
    },
    speech: {
      provider: "voicebox",
      baseUrl: voicebox.baseUrl,
      ...(voicebox.profile ? { profile: voicebox.profile } : {}),
      engine: voicebox.engine,
      language: voicebox.speechLanguage,
      clientId: voicebox.clientId,
      personality: voicebox.personality,
      timeoutMs: config.speech?.timeoutMs ?? 180_000,
      pollIntervalMs: 1_000,
    },
    channels: {
      ...config.channels,
      telegram: telegram
        ? {
            ...telegram,
            voiceReplyPolicy: "voice-input-only",
            voiceReplyMaxChars: telegram.voiceReplyMaxChars ?? 800,
            voiceReplyCooldownMs: telegram.voiceReplyCooldownMs ?? 30_000,
            attachments: enableVoiceAttachmentConfig(attachments),
          }
        : undefined,
    },
  };
}

function enableVoiceAttachmentConfig(attachments: NonNullable<NonNullable<NonNullable<AppConfig["channels"]>["telegram"]>["attachments"]> | undefined) {
  return {
    ...attachments,
    downloadPolicy: "allow" as const,
    transcriptionPolicy: "allow" as const,
    transcriptionMaxBytes: attachments?.transcriptionMaxBytes ?? 10_485_760,
    deleteAfterProcessingKinds: mergeUnique([...(attachments?.deleteAfterProcessingKinds ?? []), "voice", "audio"]),
  };
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
    return language === "vi" || language === "mixed" ? "nhanh, chất lượng thấp với tiếng Việt" : "nhanh, chất lượng thấp";
  }
  if (normalized.includes("small")) {
    return language === "vi" || language === "mixed" ? "mốc khuyến nghị cho tiếng Việt" : "mốc cân bằng";
  }
  if (normalized.includes("medium")) {
    return "chất lượng cao hơn, chậm hơn và lớn hơn";
  }
  if (normalized.includes("large")) {
    return "nhóm chất lượng tốt nhất, chậm nhất và lớn nhất";
  }
  return "chưa rõ kích thước model";
}

function parseVoiceboxEngine(value: string): "qwen" | "qwen_custom_voice" | "luxtts" | "chatterbox" | "chatterbox_turbo" | "tada" | "kokoro" {
  if (["qwen", "qwen_custom_voice", "luxtts", "chatterbox", "chatterbox_turbo", "tada", "kokoro"].includes(value)) {
    return value as "qwen" | "qwen_custom_voice" | "luxtts" | "chatterbox" | "chatterbox_turbo" | "tada" | "kokoro";
  }
  throw new UserFacingError("Voicebox TTS engine must be qwen, qwen_custom_voice, luxtts, chatterbox, chatterbox_turbo, tada, or kokoro.", "VoiceboxInvalidEngineError");
}

function parseVoiceboxSttModel(value: string): "base" | "small" | "medium" | "large" | "turbo" {
  if (["base", "small", "medium", "large", "turbo"].includes(value)) {
    return value as "base" | "small" | "medium" | "large" | "turbo";
  }
  throw new UserFacingError("Voicebox STT model must be base, small, medium, large, or turbo.", "VoiceboxInvalidSttModelError");
}

async function askYesNo(ask: AskLine, label: string, defaultValue: boolean): Promise<boolean> {
  const defaultText = defaultValue ? "yes" : "no";
  const answer = (await ask(`${label} [${defaultText}]: `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  return ["y", "yes", "co", "có", "true", "1"].includes(answer);
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new UserFacingError("Voicebox server URL must start with http:// or https://.", "VoiceboxInvalidBaseUrlError");
  }
  return trimmed;
}

function getVoiceboxLanguage(language: AppConfig["agent"]["language"]): string {
  if (isAutoLanguage(language) || !VOICEBOX_SUPPORTED_LANGUAGES.has(language.toLowerCase())) {
    return "en";
  }
  return language.toLowerCase();
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
    throw new UserFacingError(message, "VoiceLocalMissingExecutableError");
  }
}

async function requireReadableFile(path: string, message: string): Promise<void> {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new UserFacingError(message, "VoiceLocalMissingModelError");
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

function createQuestioner(): VoiceQuestioner {
  return createCliQuestioner();
}
