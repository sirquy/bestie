import { chmod } from "node:fs/promises";

import type { ZaloClient, ZaloFileInfo, ZaloSendFileOptions, ZaloSentMessage, ZaloUpdate } from "../zalo.js";
import type { ZaloPersonalCredentials } from "./session.js";

const USER_THREAD_TYPE = 0;

export interface ZaloPersonalApi {
  listener: ZcaListener;
  getUserInfo(userId: string): Promise<{ changed_profiles?: Record<string, { displayName?: string; zaloName?: string }> }>;
  sendMessage(message: string | { msg: string; attachments?: unknown }, threadId: string, type: number): Promise<{ message: { msgId?: number } | null; attachment: Array<{ msgId?: number }> }>;
  sendTypingEvent(threadId: string, type: number): Promise<unknown>;
}

interface ZcaListener {
  on(event: "message" | "error" | "closed", callback: (...args: unknown[]) => void): void;
  off(event: "message" | "error" | "closed", callback: (...args: unknown[]) => void): void;
  start(options: { retryOnClose: boolean }): void;
  stop(): void;
}

interface ZcaConstructor {
  new (options: { logging: boolean; selfListen: boolean }): {
    login(credentials: ZaloPersonalCredentials): Promise<ZaloPersonalApi>;
    loginQR(options: { qrPath: string }, callback: (event: ZaloPersonalQrEvent) => void): Promise<ZaloPersonalApi>;
  };
}

export interface ZaloPersonalZcaModule {
  Zalo: ZcaConstructor;
}

export interface ZaloPersonalQrEvent {
  type: number;
  data: { code?: string; image?: string; cookie?: unknown; imei?: string; userAgent?: string } | null;
  actions?: {
    saveToFile?: (qrPath?: string) => Promise<unknown>;
    retry?: () => unknown;
    abort?: () => unknown;
  } | null;
}

export interface ZaloPersonalInboundMessage {
  threadId: string;
  isSelf: boolean;
  type: number;
  data: {
    msgId?: string;
    cliMsgId?: string;
    uidFrom?: string;
    idTo?: string;
    content?: unknown;
    msgType?: string;
    ts?: string;
  };
}

export interface ZaloPersonalListenerHandlers {
  onMessage: (message: ZaloPersonalInboundMessage) => void;
  onError: (error: unknown) => void;
  onClosed: () => void;
}

export class ZaloPersonalClient implements ZaloClient {
  private readonly attachments = new Map<string, { url: string; bytes?: number }>();

  private constructor(private readonly api: ZaloPersonalApi) {}

  static fromApi(api: ZaloPersonalApi): ZaloPersonalClient {
    return new ZaloPersonalClient(api);
  }

  static async restore(credentials: ZaloPersonalCredentials): Promise<ZaloPersonalClient> {
    const { Zalo } = await loadZca();
    const api = await new Zalo({ logging: false, selfListen: true }).login(credentials);
    return new ZaloPersonalClient(api);
  }

  static async loginWithQr(options: { qrPath: string; onEvent?: (event: ZaloPersonalQrEvent) => void; signal?: AbortSignal }): Promise<{ client: ZaloPersonalClient; credentials: ZaloPersonalCredentials }> {
    return loginZaloPersonalWithQr(options);
  }

  async getUpdates(): Promise<ZaloUpdate[]> {
    return [];
  }

  async getFile(fileId: string): Promise<ZaloFileInfo> {
    const attachment = this.attachments.get(fileId);
    return attachment ? { fileId, filePath: attachment.url, fileSize: attachment.bytes } : { fileId };
  }

  async downloadFile(filePath: string): Promise<Uint8Array> {
    const response = await fetch(filePath, { headers: { accept: "*/*" } });
    if (!response.ok) throw new Error(`Zalo Personal media download returned HTTP ${response.status}.`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async sendMessage(chatId: string, text: string): Promise<ZaloSentMessage> {
    const sent = await this.api.sendMessage(text, chatId, USER_THREAD_TYPE);
    return { messageId: sent.message?.msgId ?? sent.attachment[0]?.msgId };
  }

  async sendPhoto(chatId: string, photo: Uint8Array, options: ZaloSendFileOptions = {}): Promise<ZaloSentMessage> {
    return this.sendAttachment(chatId, photo, options, "bestie-photo.jpg");
  }

  async sendDocument(chatId: string, document: Uint8Array, options: ZaloSendFileOptions = {}): Promise<ZaloSentMessage> {
    return this.sendAttachment(chatId, document, options, "bestie-file.bin");
  }

  async sendChatAction(chatId: string): Promise<void> {
    await this.api.sendTypingEvent(chatId, USER_THREAD_TYPE);
  }

  async getUserDisplayName(userId: string): Promise<string | undefined> {
    const response = await this.api.getUserInfo(userId);
    const profile = response.changed_profiles?.[userId] ?? Object.values(response.changed_profiles ?? {})[0];
    const displayName = profile?.displayName?.trim() || profile?.zaloName?.trim();
    return displayName || undefined;
  }

  startListening(handlers: ZaloPersonalListenerHandlers): () => void {
    const listener = this.api.listener;
    const onMessage = (...args: unknown[]) => handlers.onMessage(args[0] as ZaloPersonalInboundMessage);
    const onError = (...args: unknown[]) => handlers.onError(args[0]);
    const onClosed = () => handlers.onClosed();
    listener.on("message", onMessage);
    listener.on("error", onError);
    listener.on("closed", onClosed);
    listener.start({ retryOnClose: false });

    return () => {
      listener.off("message", onMessage);
      listener.off("error", onError);
      listener.off("closed", onClosed);
      listener.stop();
    };
  }

  toUpdate(message: ZaloPersonalInboundMessage): ZaloUpdate | undefined {
    if (message.isSelf || message.type !== USER_THREAD_TYPE || !message.threadId || !message.data.uidFrom) return undefined;
    const attachment = extractAttachment(message.data.content, message.data.msgType);
    if (attachment) this.attachments.set(attachment.id, { url: attachment.url, bytes: attachment.bytes });
    const text = typeof message.data.content === "string"
      ? message.data.content
      : attachment
        ? ""
        : isStickerMessage(message.data.msgType)
          ? "[User sent a sticker.]"
          : "";
    return {
      update_id: stableUpdateId(message),
      message: {
        message_id: message.data.msgId ?? message.data.cliMsgId,
        from: { id: String(message.data.uidFrom) },
        chat: { id: message.threadId, type: "private" },
        text,
        ...(attachment ? {
          [attachment.kind]: {
            file_id: attachment.id,
            file_path: attachment.url,
            file_name: attachment.name,
            ...(attachment.mimeType === undefined ? {} : { mime_type: attachment.mimeType }),
            ...(attachment.bytes === undefined ? {} : { file_size: attachment.bytes }),
          },
        } : {}),
      },
    };
  }

  private async sendAttachment(chatId: string, bytes: Uint8Array, options: ZaloSendFileOptions, fallbackName: string): Promise<ZaloSentMessage> {
    const fileName = options.fileName?.trim() || fallbackName;
    const sent = await this.api.sendMessage({
      msg: options.caption ?? "",
      attachments: { data: Buffer.from(bytes), filename: fileName as `${string}.${string}`, metadata: { totalSize: bytes.byteLength } },
    }, chatId, USER_THREAD_TYPE);
    return { messageId: sent.message?.msgId ?? sent.attachment[0]?.msgId };
  }
}

export async function loginZaloPersonalWithQr(options: { qrPath: string; onEvent?: (event: ZaloPersonalQrEvent) => void; signal?: AbortSignal; loadModule?: () => Promise<ZaloPersonalZcaModule> }): Promise<{ client: ZaloPersonalClient; credentials: ZaloPersonalCredentials }> {
  let credentials: ZaloPersonalCredentials | undefined;
  let qrWrite: Promise<unknown> | undefined;
  let qrWriteError: unknown;
  let qrDelivered = false;
  let declined = false;
  let abortLogin: (() => unknown) | undefined;
  let abortRequested = options.signal?.aborted === true;
  const queuedEvents: ZaloPersonalQrEvent[] = [];
  const onAbort = () => {
    abortRequested = true;
    abortLogin?.();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const notify = (event: ZaloPersonalQrEvent) => {
    if (qrWrite && !qrDelivered) {
      queuedEvents.push(event);
      return;
    }
    options.onEvent?.(event);
  };
  const { Zalo } = await (options.loadModule ?? loadZca)();
  const zalo = new Zalo({ logging: false, selfListen: true });
  try {
    let api: ZaloPersonalApi;
    try {
      api = await zalo.loginQR({ qrPath: options.qrPath }, (event) => {
      abortLogin = event.actions?.abort;
      if (abortRequested) {
        abortLogin?.();
        return;
      }
      if (event.type === 0 && event.actions?.saveToFile) {
        qrWrite = event.actions.saveToFile(options.qrPath)
          .then(() => chmod(options.qrPath, 0o600))
          .catch((error: unknown) => { qrWriteError = error; })
          .then(() => {
            qrDelivered = true;
            options.onEvent?.(event);
            for (const queuedEvent of queuedEvents.splice(0)) options.onEvent?.(queuedEvent);
          });
        return;
      }
      if (event.type === 4 && event.data?.cookie && event.data.imei && event.data.userAgent) {
        credentials = { cookie: event.data.cookie, imei: event.data.imei, userAgent: event.data.userAgent };
      }
      notify(event);
      if (event.type === 1) {
        try {
          event.actions?.retry?.();
        } catch {}
      }
      if (event.type === 3) {
        declined = true;
        try {
          event.actions?.abort?.();
        } catch {}
      }
      });
    } catch (error) {
      if (declined) throw new Error("Zalo QR login was declined.");
      throw error;
    }
    await qrWrite;
    if (qrWriteError) throw qrWriteError;
    if (declined) throw new Error("Zalo QR login was declined.");
    if (!credentials) throw new Error("Zalo QR login ended before session credentials were received.");
    return { client: ZaloPersonalClient.fromApi(api), credentials };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}

async function loadZca(): Promise<ZaloPersonalZcaModule> {
  return import("zca-js") as Promise<ZaloPersonalZcaModule>;
}

function extractAttachment(content: unknown, msgType: string | undefined): { id: string; url: string; name: string; mimeType?: string; bytes?: number; kind: "photo" | "document" | "video" | "audio" | "sticker" } | undefined {
  if (!content || typeof content !== "object" || Array.isArray(content)) return undefined;
  const record = content as Record<string, unknown>;
  const url = firstString(record, ["href", "url", "fileUrl", "hdUrl", "normalUrl"]);
  if (!url || !/^https:\/\//i.test(url)) return undefined;
  const type = `${msgType ?? ""} ${firstString(record, ["type", "fileType"]) ?? ""}`.toLowerCase();
  const kind = isStickerMessage(type) ? "sticker" : type.includes("image") || type.includes("photo") ? "photo" : type.includes("video") ? "video" : type.includes("audio") || type.includes("voice") ? "audio" : "document";
  const id = firstString(record, ["fileId", "photoId", "id"]) ?? url;
  return { id, url, name: firstString(record, ["title", "fileName", "name"]) ?? `zalo-${kind}`, mimeType: firstString(record, ["mimeType", "contentType"]), bytes: firstNumber(record, ["totalSize", "size", "fileSize"]), kind };
}

function isStickerMessage(msgType: string | undefined): boolean {
  return msgType?.toLowerCase().includes("sticker") === true;
}

function stableUpdateId(message: ZaloPersonalInboundMessage): number {
  const value = `${message.threadId}:${message.data.msgId ?? message.data.cliMsgId ?? message.data.ts ?? ""}`;
  let hash = 0;
  for (const char of value) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}
