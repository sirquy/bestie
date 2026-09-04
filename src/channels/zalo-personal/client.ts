import { chmod } from "node:fs/promises";

import type { ZaloClient, ZaloFileInfo, ZaloSendFileOptions, ZaloSendMessageOptions, ZaloSentMessage, ZaloUpdate } from "../zalo.js";
import { isZaloPersonalOperation, type ZaloPersonalOperation } from "./capabilities.js";
import type { ZaloPersonalCredentials } from "./session.js";

const USER_THREAD_TYPE = 0;
const GROUP_THREAD_TYPE = 1;
type ZaloPersonalThreadType = typeof USER_THREAD_TYPE | typeof GROUP_THREAD_TYPE;

export interface ZaloPersonalApi {
  listener: ZcaListener;
  getUserInfo(userId: string): Promise<{ changed_profiles?: Record<string, { displayName?: string; zaloName?: string }> }>;
  sendMessage(message: string | { msg: string; attachments?: unknown; quote?: unknown }, threadId: string, type: number): Promise<{ message: { msgId?: number } | null; attachment: Array<{ msgId?: number }> }>;
  sendTypingEvent(threadId: string, type: number, destType?: number): Promise<unknown>;
  [operation: string]: unknown;
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
    mentions?: unknown;
    mention?: unknown;
    msgType?: string;
    ts?: string;
    [key: string]: unknown;
  };
}

export function isZaloPersonalGroupMessage(message: ZaloPersonalInboundMessage): boolean {
  return message.type === GROUP_THREAD_TYPE;
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

  async sendMessage(chatId: string, text: string, options: ZaloSendMessageOptions = {}): Promise<ZaloSentMessage> {
    const message = options.quote === undefined ? text : { msg: text, quote: options.quote };
    const sent = await this.api.sendMessage(message, chatId, options.threadType ?? USER_THREAD_TYPE);
    return { messageId: sent.message?.msgId ?? sent.attachment[0]?.msgId };
  }

  async sendPhoto(chatId: string, photo: Uint8Array, options: ZaloSendFileOptions = {}): Promise<ZaloSentMessage> {
    return this.sendAttachment(chatId, photo, options, "bestie-photo.jpg");
  }

  async sendDocument(chatId: string, document: Uint8Array, options: ZaloSendFileOptions = {}): Promise<ZaloSentMessage> {
    return this.sendAttachment(chatId, document, options, "bestie-file.bin");
  }

  async sendChatAction(chatId: string, _action?: "typing", threadType?: ZaloPersonalThreadType): Promise<void> {
    const resolvedThreadType = threadType ?? USER_THREAD_TYPE;
    await this.api.sendTypingEvent(chatId, resolvedThreadType, resolvedThreadType === GROUP_THREAD_TYPE ? undefined : 3);
  }

  async getUserDisplayName(userId: string): Promise<string | undefined> {
    const response = await this.api.getUserInfo(userId);
    const profile = response.changed_profiles?.[userId] ?? Object.values(response.changed_profiles ?? {})[0];
    const displayName = profile?.displayName?.trim() || profile?.zaloName?.trim();
    return displayName || undefined;
  }

  async execute(operation: ZaloPersonalOperation, args: unknown[] = []): Promise<unknown> {
    if (!isZaloPersonalOperation(operation)) throw new Error(`Unsupported Zalo Personal operation: ${operation}.`);
    const candidate = this.api[operation];
    if (typeof candidate !== "function") throw new Error(`The installed zca-js client does not provide ${operation}.`);
    return Promise.resolve((candidate as (...parameters: unknown[]) => unknown).apply(this.api, args));
  }

  async acceptFriendRequest(friendId: string): Promise<unknown> { return this.execute("acceptFriendRequest", [friendId]); }
  async changeAccountAvatar(avatarSource: unknown): Promise<unknown> { return this.execute("changeAccountAvatar", [avatarSource]); }
  async changeFriendAlias(alias: string, friendId: string): Promise<unknown> { return this.execute("changeFriendAlias", [alias, friendId]); }
  async fetchAccountInfo(): Promise<unknown> { return this.execute("fetchAccountInfo"); }
  async findUser(phoneNumber: string, avatarSize?: number): Promise<unknown> { return this.execute("findUser", [phoneNumber, avatarSize]); }
  async forwardMessage(payload: unknown, threadIds: string[], type?: number): Promise<unknown> { return this.execute("forwardMessage", [payload, threadIds, type]); }
  async getAliasList(count?: number, page?: number): Promise<unknown> { return this.execute("getAliasList", [count, page]); }
  async getAllFriends(count?: number, page?: number, avatarSize?: number): Promise<unknown> { return this.execute("getAllFriends", [count, page, avatarSize]); }
  async getAllGroups(): Promise<unknown> { return this.execute("getAllGroups"); }
  async getContext(): Promise<unknown> { return this.execute("getContext"); }
  async getFriendRecommendations(): Promise<unknown> { return this.execute("getFriendRecommendations"); }
  async getFriendRequestStatus(friendId: string): Promise<unknown> { return this.execute("getFriendRequestStatus", [friendId]); }
  async getGroupInfo(groupId: string | string[]): Promise<unknown> { return this.execute("getGroupInfo", [groupId]); }
  async getGroupLinkDetail(groupId: string): Promise<unknown> { return this.execute("getGroupLinkDetail", [groupId]); }
  async getGroupLinkInfo(payload: unknown): Promise<unknown> { return this.execute("getGroupLinkInfo", [payload]); }
  async getGroupMembersInfo(memberId: string | string[]): Promise<unknown> { return this.execute("getGroupMembersInfo", [memberId]); }
  async getOwnId(): Promise<unknown> { return this.execute("getOwnId"); }
  async getQR(userId: string | string[]): Promise<unknown> { return this.execute("getQR", [userId]); }
  async getStickers(keyword: string): Promise<unknown> { return this.execute("getStickers", [keyword]); }
  async getStickersDetail(stickerIds: number | number[]): Promise<unknown> { return this.execute("getStickersDetail", [stickerIds]); }
  async getUserInfo(userId: string | string[], avatarSize?: number): Promise<unknown> { return this.execute("getUserInfo", [userId, avatarSize]); }
  async inviteUserToGroups(userId: string, groupId: string | string[]): Promise<unknown> { return this.execute("inviteUserToGroups", [userId, groupId]); }
  async joinGroupLink(link: string): Promise<unknown> { return this.execute("joinGroupLink", [link]); }
  async keepAlive(): Promise<unknown> { return this.execute("keepAlive"); }
  async lastOnline(uid: string): Promise<unknown> { return this.execute("lastOnline", [uid]); }
  async parseLink(link: string): Promise<unknown> { return this.execute("parseLink", [link]); }
  async sendBankCard(payload: unknown, threadId: string, type?: number): Promise<unknown> { return this.execute("sendBankCard", [payload, threadId, type]); }
  async sendCard(options: unknown, threadId: string, type?: number): Promise<unknown> { return this.execute("sendCard", [options, threadId, type]); }
  async sendDeliveredEvent(isSeen: boolean, messages: unknown, type?: number): Promise<unknown> { return this.execute("sendDeliveredEvent", [isSeen, messages, type]); }
  async sendFriendRequest(message: string, userId: string): Promise<unknown> { return this.execute("sendFriendRequest", [message, userId]); }
  async sendLink(options: unknown, threadId: string, type?: number): Promise<unknown> { return this.execute("sendLink", [options, threadId, type]); }
  async sendReport(options: unknown, threadId: string, type?: number): Promise<unknown> { return this.execute("sendReport", [options, threadId, type]); }
  async sendSeenEvent(messages: unknown, type?: number): Promise<unknown> { return this.execute("sendSeenEvent", [messages, type]); }
  async sendSticker(sticker: unknown, threadId: string, type?: number): Promise<unknown> { return this.execute("sendSticker", [sticker, threadId, type]); }
  async sendTypingEvent(threadId: string, type?: number, destType?: number): Promise<unknown> { return this.execute("sendTypingEvent", [threadId, type, destType]); }
  async sendVideo(options: unknown, threadId: string, type?: number): Promise<unknown> { return this.execute("sendVideo", [options, threadId, type]); }
  async sendVoice(options: unknown, threadId: string, type?: number): Promise<unknown> { return this.execute("sendVoice", [options, threadId, type]); }
  async updateProfile(payload: unknown): Promise<unknown> { return this.execute("updateProfile", [payload]); }
  async updateSettings(type: string, value: number): Promise<unknown> { return this.execute("updateSettings", [type, value]); }
  async uploadAttachment(sources: unknown, threadId: string, type?: number): Promise<unknown> { return this.execute("uploadAttachment", [sources, threadId, type]); }
  async uploadProductPhoto(payload: unknown): Promise<unknown> { return this.execute("uploadProductPhoto", [payload]); }

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
    if (message.isSelf || ![USER_THREAD_TYPE, GROUP_THREAD_TYPE].includes(message.type) || !message.threadId || !message.data.uidFrom) return undefined;
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
        chat: { id: message.threadId, type: message.type === GROUP_THREAD_TYPE ? "group" : "private" },
        text,
        ...(message.type === GROUP_THREAD_TYPE ? { quote: message.data } : {}),
        ...(message.data.mentions === undefined ? {} : { mentions: message.data.mentions }),
        ...(message.data.mention === undefined ? {} : { mention: message.data.mention }),
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
    }, chatId, options.threadType ?? USER_THREAD_TYPE);
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
