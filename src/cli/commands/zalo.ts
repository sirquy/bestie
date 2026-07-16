import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stdout as output } from "node:process";

import { ZaloHttpClient, runZaloPollingLoop, type ZaloChatCompletionRunner, type ZaloClient, type ZaloUpdate } from "../../channels/zalo.js";
import { loadConfig, type AppConfig, writeConfig } from "../../runtime/config.js";
import { loadEnvFile, writeEnvFile } from "../../runtime/env.js";
import { UserFacingError } from "../../runtime/errors.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
import { createCliQuestioner } from "../prompt.js";
import { badge, bold, color, dim, title, withColorMode } from "../ui.js";

const DEFAULT_ZALO_TOKEN_ENV = "BESTIE_ZALO_BOT_TOKEN";

type AskLine = (question: string) => Promise<string>;

interface ZaloQuestioner {
  ask: AskLine;
  askHidden: AskLine;
  close: () => void;
}

interface ZaloCommandOptions {
  argv?: string[];
  paths?: RuntimePaths;
  questioner?: ZaloQuestioner;
  clientFactory?: (token: string) => ZaloClient;
  chatCompletion?: ZaloChatCompletionRunner;
  writeLine?: (message: string) => void;
  useColor?: boolean;
}

interface ZaloSetupUi {
  intro: (paths: RuntimePaths) => void;
  section: (title: string, detail?: string) => void;
  success: (message: string) => void;
  info: (message: string) => void;
  savedPath: (label: string, path: string) => void;
  final: () => void;
}

export async function runZaloCommand(optionsOrArgv: string[] | ZaloCommandOptions = process.argv): Promise<void> {
  const options = Array.isArray(optionsOrArgv) ? { argv: optionsOrArgv } : optionsOrArgv;
  const argv = options.argv ?? process.argv;
  const paths = options.paths ?? getRuntimePaths();
  const writeLine = options.writeLine ?? console.log;

  if (argv.includes("setup")) {
    await runZaloSetup({ paths, questioner: options.questioner, writeLine, useColor: options.useColor ?? output.isTTY });
    return;
  }

  const config = await loadConfig(paths);
  const zalo = config.channels?.zalo;

  if (!zalo?.enabled) {
    throw new UserFacingError("Zalo chưa được bật. Hãy chạy `bestie channels zalo setup` trước.", "ZaloNotEnabledError");
  }

  const envValues = await loadEnvFile(paths);
  const token = process.env[zalo.botTokenEnv] ?? envValues[zalo.botTokenEnv];

  if (!token) {
    throw new UserFacingError(`Thiếu biến Zalo bot token ${zalo.botTokenEnv}. Hãy thêm biến này vào .bestie/.env.`, "ZaloMissingTokenError");
  }

  if (!zalo.ownerUserId.trim()) {
    throw new UserFacingError("Thiếu Zalo owner user id. Đặt channels.zalo.ownerUserId trong .bestie/config.json.", "ZaloMissingOwnerError");
  }

  const transcriptPath = getTranscriptPath(argv, paths);
  const appendTranscript = transcriptPath ? createTranscriptAppender(transcriptPath) : undefined;
  const captureShape = argv.includes("--capture-shape");
  const baseClient = options.clientFactory?.(token) ?? new ZaloHttpClient(token, fetch, captureShape && appendTranscript ? { captureGetUpdatesShape: (shape) => appendTranscript("zalo_get_updates_shape", shape) } : undefined);
  const client = appendTranscript ? createTranscriptZaloClient(baseClient, appendTranscript, zalo.ownerUserId) : baseClient;
  writeLine(argv.includes("--once") ? "Zalo đang polling một lần." : "Zalo polling đã bắt đầu. Nhấn Ctrl+C để dừng.");
  if (transcriptPath) {
    writeLine(`Transcript smoke Zalo: ${transcriptPath}`);
    if (captureShape) {
      writeLine("Đã bật ghi nhận shape của Zalo getUpdates.");
    }
  }
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await runZaloPollingLoop({ config, paths, client, once: argv.includes("--once"), shouldStop: () => stopping, chatCompletion: options.chatCompletion });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

async function runZaloSetup(options: { paths: RuntimePaths; questioner?: ZaloQuestioner; writeLine: (message: string) => void; useColor?: boolean }): Promise<void> {
  const questioner = options.questioner ?? createQuestioner();
  const ui = createZaloSetupUi(options.writeLine, options.useColor ?? output.isTTY);

  try {
    ui.intro(options.paths);
    ui.section("Tài khoản", "Kết nối một bot Zalo với runtime cục bộ này.");
    const config = await loadConfig(options.paths);
    const ownerUserId = (await questioner.ask("[1/2] Zalo owner user id được phép chat với Bestie: ")).trim();
    ui.section("Bot token", "Dán token bí mật. Nội dung nhập sẽ được ẩn.");
    const token = await questioner.askHidden("[2/2] Bot token. Dán Zalo Bot Token; nội dung nhập sẽ được ẩn: ");

    if (!ownerUserId) {
      throw new UserFacingError("Bắt buộc phải có Zalo owner user id.", "ZaloMissingOwnerError");
    }

    if (!token.trim()) {
      throw new UserFacingError("Bắt buộc phải có Zalo bot token.", "ZaloMissingTokenError");
    }

    ui.success("Đã thu thập owner Zalo và bot token.");
    ui.section("Lưu cấu hình", "Đang cập nhật config cục bộ và file env chứa secret.");
    await mkdir(options.paths.appDir, { recursive: true });
    await writeConfig(enableZaloConfig(config, ownerUserId), options.paths);
    await writeEnvFile({ ...(await loadEnvFile(options.paths)), [DEFAULT_ZALO_TOKEN_ENV]: token.trim() }, options.paths);

    ui.success("Đã lưu cấu hình Zalo.");
    ui.section("File đã lưu", "Secret được giữ cục bộ và không được in ra màn hình.");
    ui.savedPath("Cấu hình", options.paths.configPath);
    ui.savedPath("Token env", `${DEFAULT_ZALO_TOKEN_ENV} trong ${options.paths.envPath}`);
    ui.info("Zalo chỉ được bật cho owner user id đã cấu hình.");
    ui.final();
  } finally {
    questioner.close();
  }
}

function enableZaloConfig(config: AppConfig, ownerUserId: string): AppConfig {
  return {
    ...config,
    channels: {
      ...config.channels,
      zalo: {
        enabled: true,
        botTokenEnv: DEFAULT_ZALO_TOKEN_ENV,
        ownerUserId,
      },
    },
  };
}

function createZaloSetupUi(writeLine: (message: string) => void, useColor: boolean): ZaloSetupUi {
  const render = withColorMode(useColor);

  return {
    intro: (paths) => {
      writeLine(render(() => title("Thiết lập Zalo")));
      writeLine(render(() => dim("Kết nối bot Zalo với runtime Bestie cục bộ.")));
      writeLine(`${render(() => color("cyan", "Runtime"))} ${paths.appDir}`);
      writeLine(`${render(() => color("cyan", "Riêng tư"))} Bot token được lưu cục bộ trong .bestie/.env và được ẩn khi nhập.`);
      writeLine(render(() => `${dim("Các bước")} Tài khoản -> Lưu cấu hình -> File đã lưu\n`));
    },
    section: (sectionTitle, detail) => writeLine(render(() => `${color("cyan", "\n>")} ${bold(sectionTitle)}${detail ? ` ${dim(detail)}` : ""}`)),
    success: (message) => writeLine(`${render(() => badge("OK", "green"))} ${message}`),
    info: (message) => writeLine(`${render(() => badge("INFO", "yellow"))} ${message}`),
    savedPath: (label, path) => writeLine(`  ${render(() => color("cyan", label.padEnd(10)))} ${path}`),
    final: () => {
      writeLine(`${render(() => badge("DONE", "green"))} Thiết lập Zalo đã hoàn tất.`);
      writeLine(`${render(() => dim("Tiếp theo"))} Chạy \`bestie doctor\`, rồi \`bestie channels zalo --once\`.`);
    },
  };
}

type TranscriptAppender = (event: string, detail: Record<string, unknown>) => Promise<void>;

function getTranscriptPath(argv: string[], paths: RuntimePaths): string | undefined {
  const transcriptIndex = argv.indexOf("--transcript");

  if (transcriptIndex === -1) {
    return undefined;
  }

  const value = argv[transcriptIndex + 1]?.trim();

  if (!value || value.startsWith("--")) {
    throw new UserFacingError("Zalo --transcript cần một đường dẫn file.", "ZaloTranscriptPathError");
  }

  return resolve(paths.rootDir, value);
}

function createTranscriptAppender(transcriptPath: string): TranscriptAppender {
  return async (event, detail) => {
    await mkdir(dirname(transcriptPath), { recursive: true });
    await appendFile(transcriptPath, `${JSON.stringify({ ts: new Date().toISOString(), event, detail })}\n`, { mode: 0o600 });
  };
}

function createTranscriptZaloClient(client: ZaloClient, appendTranscript: TranscriptAppender, ownerUserId: string): ZaloClient {
  return {
    ...(client.getMe ? { getMe: () => client.getMe!() } : {}),
    getUpdates: async (offset, timeoutSeconds) => {
      await appendTranscript("zalo_get_updates_start", { offset, timeoutSeconds });
      const updates = await client.getUpdates(offset, timeoutSeconds);
      await appendTranscript("zalo_get_updates_finish", {
        count: updates.length,
        updates: updates.map((update) => summarizeZaloUpdate(update, ownerUserId)),
      });
      return updates;
    },
    sendMessage: async (chatId, text) => {
      await appendTranscript("zalo_send_message", summarizeZaloOutbound(chatId, text));
      return client.sendMessage(chatId, text);
    },
    sendChatAction: async (chatId, action) => {
      await appendTranscript("zalo_send_chat_action", { chat: hashIdentifier(chatId), action });
      await client.sendChatAction(chatId, action);
    },
  };
}

function summarizeZaloUpdate(update: ZaloUpdate, ownerUserId: string): Record<string, unknown> {
  const message = update.message;
  const text = typeof message?.text === "string" ? message.text : message?.text?.text ?? "";
  const caption = message?.caption ?? "";
  const senderId = summarizeZaloSenderId(message);

  return {
    updateId: update.update_id,
    chat: message?.chat?.id ? hashIdentifier(message.chat.id) : undefined,
    sender: senderId ? hashIdentifier(senderId) : undefined,
    owner: hashIdentifier(ownerUserId),
    fromOwner: senderId === ownerUserId,
    textLength: text.length,
    captionLength: caption.length,
    hasText: text.length > 0,
    hasAttachment: hasZaloAttachmentLikePayload(message),
  };
}

function summarizeZaloSenderId(message: ZaloUpdate["message"] | undefined): string {
  return String(message?.from?.id ?? message?.sender?.id ?? message?.user?.id ?? message?.user_id ?? message?.uid ?? message?.sender_id ?? message?.from_id ?? "");
}

function summarizeZaloOutbound(chatId: string, text: string): Record<string, unknown> {
  const isProgress = isZaloToolProgressText(text);

  return {
    chat: hashIdentifier(chatId),
    kind: isProgress ? "tool_progress" : "reply",
    textLength: text.length,
    progressLabel: isProgress ? text.replace(/^.+? is\s*/, "") : undefined,
  };
}

function isZaloToolProgressText(text: string): boolean {
  return [/^.+? is preparing a memory approval$/, /^.+? is using .+$/].some((pattern) => pattern.test(text));
}

function hasZaloAttachmentLikePayload(message: ZaloUpdate["message"] | undefined): boolean {
  if (!message) {
    return false;
  }

  return ["photo", "document", "voice", "audio", "video", "sticker", "attachments"].some((key) => key in message);
}

function hashIdentifier(value: string | number): string {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function createQuestioner(): ZaloQuestioner {
  return createCliQuestioner();
}