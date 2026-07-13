import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type ChannelAttachmentKind = "photo" | "document" | "voice" | "audio" | "video" | "sticker";

export type ChannelTranscriptSource = "provider" | "platform" | "fallback";

export type ChannelAttachmentFailureReason = "download_disabled" | "mime_denied" | "client_unsupported" | "too_large" | "missing_file_path" | "metadata_failed" | "download_failed";

export interface ChannelTranscript {
  text: string;
  source: ChannelTranscriptSource;
  truncated?: boolean;
}

export interface ChannelAttachmentFileInfo {
  filePath?: string;
  fileSize?: number;
}

export interface ChannelDownloadedAttachment {
  filePath: string;
  bytes: Uint8Array;
  expectedSize?: number;
}

export interface ChannelPersistedAttachmentFile {
  localPath: string;
  bytes: number;
}

export interface ChannelAttachmentPathInput {
  workspaceDir: string;
  channelName: string;
  date: string;
  updateId: string | number;
  messageId: string | number;
  kind: ChannelAttachmentKind;
  sourceName: string;
  extension: string;
  fallbackName?: string;
}

export class ChannelAttachmentHandlingError extends Error {
  constructor(
    readonly reason: ChannelAttachmentFailureReason,
    readonly userMessage: string,
    options?: { cause?: unknown },
  ) {
    super(userMessage, options);
    this.name = "ChannelAttachmentHandlingError";
  }
}

export function formatChannelTranscriptLabel(transcript: ChannelTranscript): string {
  const sourceLabel = transcript.source === "provider" ? "provider STT" : transcript.source === "platform" ? "platform ASR" : "fallback text";
  return `Audio transcript from ${sourceLabel}${transcript.truncated ? " (truncated)" : ""}`;
}

export function isAudioAttachmentKind(kind: ChannelAttachmentKind): kind is "voice" | "audio" {
  return kind === "voice" || kind === "audio";
}

export function sanitizeChannelFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "attachment";
}

export function buildChannelAttachmentPath(input: ChannelAttachmentPathInput): string {
  const baseSourceName = input.sourceName.endsWith(input.extension) ? input.sourceName.slice(0, input.sourceName.length - input.extension.length) : input.sourceName;
  const baseName = sanitizeChannelFileName(baseSourceName || input.fallbackName || `${input.kind}-${input.messageId}`);
  return resolve(input.workspaceDir, input.channelName, input.date, `${input.updateId}-${input.messageId}-${input.kind}-${baseName}${input.extension}`);
}

export function isAllowedChannelAttachmentMimeType(mimeType: string | undefined, allowedMimeTypes: string[]): boolean {
  if (!mimeType) {
    return false;
  }

  const normalized = mimeType.toLowerCase();
  return allowedMimeTypes.some((allowed) => {
    const rule = allowed.toLowerCase();
    return rule.endsWith("/*") ? normalized.startsWith(rule.slice(0, -1)) : normalized === rule;
  });
}

export function assertChannelAttachmentDownloadAllowed(options: { downloadPolicy: "allow" | "deny"; message: string }): void {
  if (options.downloadPolicy === "deny") {
    throw new ChannelAttachmentHandlingError("download_disabled", options.message);
  }
}

export function assertChannelAttachmentMimeAllowed(options: { mimeType?: string; allowedMimeTypes?: string[]; message: string }): void {
  if (options.allowedMimeTypes && !isAllowedChannelAttachmentMimeType(options.mimeType, options.allowedMimeTypes)) {
    throw new ChannelAttachmentHandlingError("mime_denied", options.message);
  }
}

export function assertChannelAttachmentSizeAllowed(options: { bytes?: number; maxBytes: number; message: string }): void {
  if (options.bytes !== undefined && options.bytes > options.maxBytes) {
    throw new ChannelAttachmentHandlingError("too_large", options.message);
  }
}

export async function downloadChannelAttachmentBytes(options: {
  fileId: string;
  reportedSize?: number;
  maxBytes: number;
  getFile?: (fileId: string) => Promise<ChannelAttachmentFileInfo>;
  downloadFile?: (filePath: string) => Promise<Uint8Array>;
  messages: {
    clientUnsupported: string;
    metadataFailed: string;
    missingFilePath: string;
    downloadFailed: string;
    tooLarge: string;
  };
}): Promise<ChannelDownloadedAttachment> {
  if (!options.getFile || !options.downloadFile) {
    throw new ChannelAttachmentHandlingError("client_unsupported", options.messages.clientUnsupported);
  }

  assertChannelAttachmentSizeAllowed({ bytes: options.reportedSize, maxBytes: options.maxBytes, message: options.messages.tooLarge });

  let file: ChannelAttachmentFileInfo;
  try {
    file = await options.getFile(options.fileId);
  } catch (error) {
    throw new ChannelAttachmentHandlingError("metadata_failed", options.messages.metadataFailed, { cause: error });
  }

  const expectedSize = file.fileSize ?? options.reportedSize;
  assertChannelAttachmentSizeAllowed({ bytes: expectedSize, maxBytes: options.maxBytes, message: options.messages.tooLarge });
  if (!file.filePath) {
    throw new ChannelAttachmentHandlingError("missing_file_path", options.messages.missingFilePath);
  }

  let bytes: Uint8Array;
  try {
    bytes = await options.downloadFile(file.filePath);
  } catch (error) {
    throw new ChannelAttachmentHandlingError("download_failed", options.messages.downloadFailed, { cause: error });
  }

  assertChannelAttachmentSizeAllowed({ bytes: bytes.byteLength, maxBytes: options.maxBytes, message: options.messages.tooLarge });
  return { filePath: file.filePath, bytes, expectedSize };
}

export async function persistChannelAttachmentFile(options: { localPath: string; bytes: Uint8Array }): Promise<ChannelPersistedAttachmentFile> {
  await mkdir(dirname(options.localPath), { recursive: true });
  await writeFile(options.localPath, options.bytes, { mode: 0o600 });
  return { localPath: options.localPath, bytes: options.bytes.byteLength };
}

export async function applyChannelAttachmentRetention(options: {
  localPath: string;
  kind: ChannelAttachmentKind;
  deleteAfterProcessingKinds: ChannelAttachmentKind[];
  onCleanupFailed?: (detail: { kind: ChannelAttachmentKind; message: string }) => Promise<void> | void;
}): Promise<boolean> {
  if (!options.deleteAfterProcessingKinds.includes(options.kind)) {
    return true;
  }

  try {
    await unlink(options.localPath);
    return false;
  } catch (error) {
    await options.onCleanupFailed?.({ kind: options.kind, message: error instanceof Error ? error.message : "unknown cleanup error" });
    return true;
  }
}