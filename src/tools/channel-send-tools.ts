import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";

import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { resolveSandboxPath } from "../runtime/workspace.js";
import type { PermissionApprover } from "../safety/permission-policy.js";

export type OutboundChannelName = "telegram" | "zalo";
export type OutboundAttachmentKind = "photo" | "file";

export interface OutboundFilePayload {
  channel?: string;
  path: string;
  fileName?: string;
  mimeType?: string;
  caption?: string;
}

export interface ResolvedOutboundFilePayload {
  channel?: string;
  path: string;
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  caption?: string;
}

export interface OutboundFileSendResult {
  channel: string;
  target?: string;
  messageId?: string | number;
}

export interface AgentOutboundFileSender {
  sendPhoto(payload: ResolvedOutboundFilePayload): Promise<OutboundFileSendResult>;
  sendFile(payload: ResolvedOutboundFilePayload): Promise<OutboundFileSendResult>;
}

export interface ChannelSendToolOptions {
  config: AppConfig;
  paths: RuntimePaths;
  approver?: PermissionApprover;
  outboundFileSender?: AgentOutboundFileSender;
}

export interface ChannelSendToolResult {
  allowed: boolean;
  reason: string;
  channel?: string;
  target?: string;
  path?: string;
  fileName?: string;
  mimeType?: string;
  bytes?: number;
  messageId?: string | number;
}

const MAX_OUTBOUND_FILE_BYTES = 50 * 1024 * 1024;
const MAX_CAPTION_BYTES = 1024;
const PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const CHANNEL_SEND_ALLOWED_REASON = "Outbound photo and file sends are allowed without approval.";

export async function sendPhotoTool(options: ChannelSendToolOptions & OutboundFilePayload): Promise<ChannelSendToolResult> {
  return sendOutboundFile({ kind: "photo", toolName: "internal.send_photo", options });
}

export async function sendFileTool(options: ChannelSendToolOptions & OutboundFilePayload): Promise<ChannelSendToolResult> {
  return sendOutboundFile({ kind: "file", toolName: "internal.send_file", options });
}

async function sendOutboundFile(input: { kind: OutboundAttachmentKind; toolName: "internal.send_photo" | "internal.send_file"; options: ChannelSendToolOptions & OutboundFilePayload }): Promise<ChannelSendToolResult> {
  const { kind, toolName, options } = input;
  if (!options.outboundFileSender) {
    return { allowed: false, reason: `${toolName} requires a channel runtime that supports outbound files.` };
  }

  const path = options.path.trim();
  if (!path) {
    return { allowed: false, reason: `${toolName} requires arguments.path.` };
  }
  if (options.caption !== undefined && Buffer.byteLength(options.caption, "utf8") > MAX_CAPTION_BYTES) {
    return { allowed: false, reason: `Caption exceeds ${MAX_CAPTION_BYTES} bytes.` };
  }

  const resolvedPath = await resolveSandboxPath({ config: options.config, paths: options.paths, inputPath: path, defaultBase: "workspace", access: "read" });
  const fileStat = await stat(resolvedPath).catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? undefined : Promise.reject(error)));
  if (!fileStat?.isFile()) {
    return { allowed: false, reason: "Path does not exist or is not a file.", path: resolvedPath };
  }
  if (fileStat.size > MAX_OUTBOUND_FILE_BYTES) {
    return { allowed: false, reason: `File exceeds ${MAX_OUTBOUND_FILE_BYTES} bytes.`, path: resolvedPath };
  }

  const fileName = safeFileName(options.fileName) ?? (basename(resolvedPath) || defaultFileName(kind));
  const mimeType = normalizeMimeType(options.mimeType) ?? inferMimeType(fileName, kind);
  if (kind === "photo" && !PHOTO_MIME_TYPES.has(mimeType)) {
    return { allowed: false, reason: `internal.send_photo requires an image file (${[...PHOTO_MIME_TYPES].join(", ")}).`, path: resolvedPath, fileName, mimeType };
  }

  const bytes = await readFile(resolvedPath);
  const payload: ResolvedOutboundFilePayload = {
    channel: options.channel,
    path: resolvedPath,
    bytes,
    fileName,
    mimeType,
    ...(options.caption === undefined ? {} : { caption: options.caption }),
  };
  const sent = kind === "photo" ? await options.outboundFileSender.sendPhoto(payload) : await options.outboundFileSender.sendFile(payload);

  return { allowed: true, reason: CHANNEL_SEND_ALLOWED_REASON, channel: sent.channel, target: sent.target, messageId: sent.messageId, path: resolvedPath, fileName, mimeType, bytes: bytes.byteLength };
}

function safeFileName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || undefined;
}

function normalizeMimeType(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(trimmed) ? trimmed : undefined;
}

function inferMimeType(fileName: string, kind: OutboundAttachmentKind): string {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".json") return "application/json";
  if (extension === ".txt" || extension === ".md" || extension === ".csv") return "text/plain";
  return kind === "photo" ? "image/jpeg" : "application/octet-stream";
}

function defaultFileName(kind: OutboundAttachmentKind): string {
  return kind === "photo" ? "bestie-photo.jpg" : "bestie-file.bin";
}
