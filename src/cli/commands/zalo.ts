import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { ZaloHttpClient, runZaloPollingLoop, type ZaloChatCompletionRunner, type ZaloClient, type ZaloUpdate } from "../../channels/zalo.js";
import { loadConfig, type AppConfig, writeConfig } from "../../runtime/config.js";
import { loadEnvFile, writeEnvFile } from "../../runtime/env.js";
import { UserFacingError } from "../../runtime/errors.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";
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
    throw new UserFacingError("Zalo is not enabled. Run `bestie channels zalo setup` first.", "ZaloNotEnabledError");
  }

  const envValues = await loadEnvFile(paths);
  const token = process.env[zalo.botTokenEnv] ?? envValues[zalo.botTokenEnv];

  if (!token) {
    throw new UserFacingError(`Zalo bot token env ${zalo.botTokenEnv} is missing. Add it to .bestie/.env.`, "ZaloMissingTokenError");
  }

  if (!zalo.ownerUserId.trim()) {
    throw new UserFacingError("Zalo owner user id is missing. Set channels.zalo.ownerUserId in .bestie/config.json.", "ZaloMissingOwnerError");
  }

  const transcriptPath = getTranscriptPath(argv, paths);
  const appendTranscript = transcriptPath ? createTranscriptAppender(transcriptPath) : undefined;
  const captureShape = argv.includes("--capture-shape");
  const baseClient = options.clientFactory?.(token) ?? new ZaloHttpClient(token, fetch, captureShape && appendTranscript ? { captureGetUpdatesShape: (shape) => appendTranscript("zalo_get_updates_shape", shape) } : undefined);
  const client = appendTranscript ? createTranscriptZaloClient(baseClient, appendTranscript, zalo.ownerUserId) : baseClient;
  writeLine(argv.includes("--once") ? "Zalo polling once." : "Zalo polling started. Press Ctrl+C to stop.");
  if (transcriptPath) {
    writeLine(`Zalo smoke transcript: ${transcriptPath}`);
    if (captureShape) {
      writeLine("Zalo getUpdates shape capture enabled.");
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
    ui.section("Account", "Connect one Zalo bot to this local runtime.");
    const config = await loadConfig(options.paths);
    const ownerUserId = (await questioner.ask("[1/2] Owner Zalo user id allowed to chat with Bestie: ")).trim();
    const token = await questioner.askHidden("[2/2] Bot token Paste the Zalo Bot Token. It is hidden while typing: ");

    if (!ownerUserId) {
      throw new UserFacingError("Zalo owner user id is required.", "ZaloMissingOwnerError");
    }

    if (!token.trim()) {
      throw new UserFacingError("Zalo bot token is required.", "ZaloMissingTokenError");
    }

    ui.success("Zalo owner and bot token collected.");
    ui.section("Save", "Updating local config and secret env file.");
    await mkdir(options.paths.appDir, { recursive: true });
    await writeConfig(enableZaloConfig(config, ownerUserId), options.paths);
    await writeEnvFile({ ...(await loadEnvFile(options.paths)), [DEFAULT_ZALO_TOKEN_ENV]: token.trim() }, options.paths);

    ui.success("Zalo setup saved.");
    ui.section("Files", "Secrets stay local and are not printed.");
    ui.savedPath("Config", options.paths.configPath);
    ui.savedPath("Token env", `${DEFAULT_ZALO_TOKEN_ENV} in ${options.paths.envPath}`);
    ui.info("Zalo is enabled for the configured owner user id only.");
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
      writeLine(render(() => title("Zalo Setup")));
      writeLine(render(() => dim("Connect a Zalo bot to your local Bestie runtime.")));
      writeLine(`${render(() => color("cyan", "Runtime"))} ${paths.appDir}`);
      writeLine(`${render(() => color("cyan", "Privacy"))} Bot tokens stay local in .bestie/.env and are hidden while typing.`);
      writeLine(render(() => `${dim("Plan")} Account -> Save -> Files\n`));
    },
    section: (sectionTitle, detail) => writeLine(render(() => `${color("cyan", "\n>")} ${bold(sectionTitle)}${detail ? ` ${dim(detail)}` : ""}`)),
    success: (message) => writeLine(`${render(() => badge("OK", "green"))} ${message}`),
    info: (message) => writeLine(`${render(() => badge("INFO", "yellow"))} ${message}`),
    savedPath: (label, path) => writeLine(`  ${render(() => color("cyan", label.padEnd(10)))} ${path}`),
    final: () => {
      writeLine(`${render(() => badge("DONE", "green"))} Zalo setup complete.`);
      writeLine(`${render(() => dim("Next"))} Run \`bestie doctor\`, then \`bestie channels zalo --once\`.`);
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
    throw new UserFacingError("Zalo --transcript requires a file path.", "ZaloTranscriptPathError");
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
  const rl = createInterface({ input, output });
  return {
    ask: (question) => rl.question(question),
    askHidden: async (question) => rl.question(question),
    close: () => rl.close(),
  };
}