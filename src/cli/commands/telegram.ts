import { createHash } from "node:crypto";
import { basename, delimiter, dirname, isAbsolute, resolve } from "node:path";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { stdout as output } from "node:process";

import { TelegramHttpClient, runTelegramPollingLoop, type TelegramAttachmentParseTelemetry, type TelegramAttachmentTranscriber, type TelegramChatCompletionRunner, type TelegramClient, type TelegramSpeechSynthesizer, type TelegramSpeechVoiceConverter, type TelegramUpdate } from "../../channels/telegram.js";
import { createChannelSpeechSynthesizer, createChannelVoiceTranscriber } from "../../channels/voice.js";
import type { FetchLike } from "../../llm/chat-completion.js";
import { loadConfig, type AppConfig, writeConfig } from "../../runtime/config.js";
import { loadEnvFile, writeEnvFile } from "../../runtime/env.js";
import { UserFacingError } from "../../runtime/errors.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { createCliQuestioner } from "../prompt.js";
import { badge, bold, color, dim, keyValue, table, title, withColorMode } from "../ui.js";

const DEFAULT_TELEGRAM_TOKEN_ENV = "BESTIE_TELEGRAM_BOT_TOKEN";

type AskLine = (question: string) => Promise<string>;

interface TelegramQuestioner {
  ask: AskLine;
  askHidden: AskLine;
  confirm: (question: string, defaultValue?: boolean) => Promise<boolean>;
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

  if (argv.includes("setup")) {
    await runTelegramSetup({ paths, questioner: options.questioner, clientFactory: options.clientFactory, writeLine, useColor: options.useColor ?? output.isTTY });
    return;
  }

  const subcommand = argv[argStart];
  if (subcommand && subcommand !== "whoami" && !subcommand.startsWith("--")) {
    throw new UserFacingError("Cách dùng: bestie channels telegram [setup|whoami|--once]", "TelegramUsageError");
  }

  const config = await loadConfig(paths);
  const telegram = config.channels?.telegram;

  if (!telegram?.enabled) {
    throw new UserFacingError("Telegram chưa được bật. Thêm channels.telegram vào .bestie/config.json, rồi đặt bot token trong .bestie/.env.", "TelegramNotEnabledError");
  }

  const envValues = await loadEnvFile(paths);
  const token = process.env[telegram.botTokenEnv] ?? envValues[telegram.botTokenEnv];
  const hasToken = Boolean(token);

  if (!hasToken) {
    throw new UserFacingError(`Thiếu biến Telegram bot token ${telegram.botTokenEnv}. Hãy thêm biến này vào .bestie/.env.`, "TelegramMissingTokenError");
  }

  if (argv[argStart] === "whoami") {
    const client = options.clientFactory?.(token ?? "") ?? new TelegramHttpClient(token ?? "");
    await runTelegramWhoami({ client, writeLine, useColor: options.useColor ?? output.isTTY });
    return;
  }

  if (!telegram.ownerUserId.trim()) {
    throw new UserFacingError("Thiếu Telegram owner id hoặc username. Đặt channels.telegram.ownerUserId trong .bestie/config.json.", "TelegramMissingOwnerError");
  }

  const transcriptPath = getTranscriptPath(argv, paths);
  const appendTranscript = transcriptPath ? createTranscriptAppender(transcriptPath) : undefined;
  const baseClient = options.clientFactory?.(token ?? "") ?? new TelegramHttpClient(token ?? "");
  const client = transcriptPath
    ? createTranscriptTelegramClient(baseClient, appendTranscript!, telegram.ownerUserId)
    : baseClient;
  const attachmentTranscriber = createTelegramAttachmentTranscriber(config, paths, options.transcriptionFetchImpl);
  const speechSynthesizer = createTelegramSpeechSynthesizer(config, paths, options.speechFetchImpl);

  writeLine(argv.includes("--once") ? "Telegram đang polling một lần." : "Telegram polling đã bắt đầu. Nhấn Ctrl+C để dừng.");
  if (transcriptPath) {
    writeLine(`Transcript smoke Telegram: ${transcriptPath}`);
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

async function runTelegramWhoami(options: { client: TelegramClient; writeLine: (message: string) => void; useColor: boolean }): Promise<void> {
  const sender = await getRecentTelegramOwner(options.client);
  const render = withColorMode(options.useColor);

  options.writeLine(render(() => title("Tra cứu owner Telegram")));

  if (!sender) {
    options.writeLine(render(() => `${badge("INFO", "yellow")} Chưa tìm thấy tin nhắn gần đây từ owner.`));
    options.writeLine(render(() => `${dim("Tiếp theo")} Gửi một tin nhắn bất kỳ cho bot Telegram, rồi chạy lại lệnh này.`));
    return;
  }

  options.writeLine(render(() => keyValue("ID", String(sender.id))));
  if (sender.username) {
    options.writeLine(render(() => keyValue("Username", `@${sender.username}`)));
  }
  options.writeLine(render(() => keyValue("Config", sender.username ? `channels.telegram.ownerUserId = "@${sender.username}" or "${sender.id}"` : `channels.telegram.ownerUserId = "${sender.id}"`)));
}

function getTelegramArgStart(argv: string[]): number {
  return argv[2] === "channels" ? 4 : 3;
}

function createTelegramAttachmentTranscriber(config: AppConfig, paths: RuntimePaths, fetchImpl?: FetchLike): TelegramAttachmentTranscriber | undefined {
  return createChannelVoiceTranscriber({ config, paths, transcriptionPolicy: config.channels?.telegram?.attachments?.transcriptionPolicy, fetchImpl });
}

function createTelegramSpeechSynthesizer(config: AppConfig, paths: RuntimePaths, fetchImpl?: FetchLike): TelegramSpeechSynthesizer | undefined {
  return createChannelSpeechSynthesizer({ config, paths, fetchImpl });
}

async function runTelegramSetup(options: { paths: RuntimePaths; questioner?: TelegramQuestioner; clientFactory?: (token: string) => TelegramClient; writeLine: (message: string) => void; useColor?: boolean }): Promise<void> {
  const questioner = options.questioner ?? createQuestioner();
  const ui = createTelegramSetupUi(options.writeLine, options.useColor ?? output.isTTY);

  try {
    ui.intro(options.paths);

    const config = await loadConfig(options.paths);
    ui.section("Bot token", "Dán token bí mật. Nội dung nhập sẽ được ẩn.");
    const token = await questioner.askHidden("[1/2] Bot token. Dán Telegram bot token; nội dung nhập sẽ được ẩn: ");

    if (!token.trim()) {
      throw new UserFacingError("Bắt buộc phải có Telegram bot token.", "TelegramMissingTokenError");
    }

    ui.success("Đã nhận bot token.");
    ui.section("Xác nhận chủ sở hữu", "Gửi một tin nhắn bất kỳ đến bot Telegram của bạn. Bestie đang chờ để nhận diện tài khoản.");
    const owner = await waitForTelegramOwnerConfirmation({ token: token.trim(), questioner, clientFactory: options.clientFactory, writeLine: options.writeLine });
    ui.success(`Đã xác nhận chủ sở hữu: ${owner.displayName}.`);

    ui.section("Lưu cấu hình", "Đang cập nhật config cục bộ và file env chứa secret.");
    await mkdir(options.paths.appDir, { recursive: true });
    await writeConfig(enableTelegramConfig(config, String(owner.id)), options.paths);
    await writeEnvFile({ ...(await loadEnvFile(options.paths)), [DEFAULT_TELEGRAM_TOKEN_ENV]: token.trim() }, options.paths);

    ui.success("Đã lưu cấu hình Telegram.");
    ui.section("File đã lưu", "Secret được giữ cục bộ và không được in ra màn hình.");
    ui.savedPath("Cấu hình", options.paths.configPath);
    ui.savedPath("Token env", `${DEFAULT_TELEGRAM_TOKEN_ENV} trong ${options.paths.envPath}`);
    ui.info("Telegram chỉ được bật cho owner id hoặc username đã cấu hình.");
    ui.final();
  } finally {
    questioner.close();
  }
}

async function waitForTelegramOwnerConfirmation(options: { token: string; questioner: TelegramQuestioner; clientFactory?: (token: string) => TelegramClient; writeLine: (message: string) => void }): Promise<{ id: number; displayName: string }> {
  const client = options.clientFactory?.(options.token) ?? new TelegramHttpClient(options.token);
  let offset: number | undefined;

  while (true) {
    const updates = await client.getUpdates(offset);

    for (const update of updates) {
      offset = update.update_id + 1;
      const sender = update.message?.from ?? update.callback_query?.from;

      if (!sender || sender.is_bot) {
        continue;
      }

      const displayName = formatTelegramDisplayName(sender);
      options.writeLine(`Đã nhận tin nhắn từ ${displayName} (Telegram ID: ${sender.id}).`);
      if (await options.questioner.confirm(`Đây có phải tài khoản của bạn, ${displayName}?`, true)) {
        return { id: sender.id, displayName };
      }

      options.writeLine("Chưa xác nhận tài khoản này. Hãy gửi một tin nhắn từ đúng tài khoản Telegram của bạn.");
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function formatTelegramDisplayName(sender: { first_name: string; last_name?: string; username?: string }): string {
  const name = [sender.first_name, sender.last_name].filter(Boolean).join(" ").trim();
  return name || (sender.username ? `@${sender.username}` : "Không có tên hiển thị");
}

async function getRecentTelegramOwner(client: TelegramClient): Promise<{ id: number; username?: string } | undefined> {
  const updates = await client.getUpdates(undefined);
  const sender = [...updates].reverse().map((update) => update.message?.from ?? update.callback_query?.from).find((from) => from && !from.is_bot);

  return sender ? { id: sender.id, username: sender.username } : undefined;
}

function createTelegramSetupUi(writeLine: (message: string) => void, useColor: boolean): TelegramSetupUi {
  const render = withColorMode(useColor);

  return {
    intro: (paths) => {
      writeLine(render(() => title("Thiết lập Telegram")));
      writeLine(render(() => dim("Kết nối bot Telegram với runtime Bestie cục bộ.")));
      writeLine(`${render(() => color("cyan", "Runtime"))} ${paths.appDir}`);
      writeLine(`${render(() => color("cyan", "Riêng tư"))} Bot token được lưu cục bộ trong .bestie/.env và được ẩn khi nhập.`);
      writeLine(render(() => `${dim("Các bước")} Bot token -> Xác nhận chủ sở hữu -> Lưu cấu hình -> File đã lưu\n`));
    },
    section: (sectionTitle, detail) => {
      writeLine(render(() => `${color("cyan", "\n>")} ${bold(sectionTitle)}${detail ? ` ${dim(detail)}` : ""}`));
    },
    success: (message) => writeLine(`${render(() => badge("OK", "green"))} ${message}`),
    info: (message) => writeLine(`${render(() => badge("INFO", "yellow"))} ${message}`),
    savedPath: (label, path) => writeLine(`  ${render(() => color("cyan", label.padEnd(10)))} ${path}`),
    final: () => {
      writeLine(`${render(() => badge("DONE", "green"))} Thiết lập Telegram đã hoàn tất.`);
      writeLine(`${render(() => dim("Tiếp theo"))} Chạy \`bestie doctor\`, rồi \`bestie channels telegram --once\`.`);
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
    throw new UserFacingError("Telegram --transcript cần một đường dẫn file.", "TelegramTranscriptPathError");
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

function createQuestioner(): TelegramQuestioner {
  return createCliQuestioner();
}
