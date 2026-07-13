import { readdir, rm, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import type { RuntimePaths } from "../runtime/paths.js";

export type CleanupAttachmentKind = "photo" | "document" | "voice" | "audio" | "video" | "sticker";

export interface CleanupTelegramAttachmentsOptions {
  paths: RuntimePaths;
  olderThanMs: number;
  kinds?: CleanupAttachmentKind[];
  confirm?: boolean;
  now?: Date;
}

export interface CleanupTelegramAttachmentsResult {
  root: string;
  dryRun: boolean;
  scannedFiles: number;
  matchedFiles: number;
  deletedFiles: number;
  bytesMatched: number;
  bytesDeleted: number;
  files: Array<{ path: string; kind: CleanupAttachmentKind; bytes: number; deleted: boolean }>;
}

const TELEGRAM_ATTACHMENT_KINDS: CleanupAttachmentKind[] = ["photo", "document", "voice", "audio", "video", "sticker"];

export async function cleanupTelegramAttachments(options: CleanupTelegramAttachmentsOptions): Promise<CleanupTelegramAttachmentsResult> {
  const root = resolve(options.paths.workspaceDir, "telegram");
  const nowMs = (options.now ?? new Date()).getTime();
  const kindFilter = new Set(options.kinds ?? TELEGRAM_ATTACHMENT_KINDS);
  const files: CleanupTelegramAttachmentsResult["files"] = [];
  let scannedFiles = 0;
  let bytesMatched = 0;
  let bytesDeleted = 0;
  let deletedFiles = 0;

  for (const filePath of await listFiles(root)) {
    scannedFiles += 1;
    const kind = detectTelegramAttachmentKind(filePath);
    if (!kind || !kindFilter.has(kind)) {
      continue;
    }

    const fileStat = await stat(filePath);
    if (nowMs - fileStat.mtimeMs < options.olderThanMs) {
      continue;
    }

    const relativePath = relative(options.paths.rootDir, filePath);
    const entry = { path: relativePath, kind, bytes: fileStat.size, deleted: false };
    bytesMatched += fileStat.size;

    if (options.confirm) {
      await rm(filePath, { force: true });
      entry.deleted = true;
      deletedFiles += 1;
      bytesDeleted += fileStat.size;
    }

    files.push(entry);
  }

  return {
    root,
    dryRun: options.confirm !== true,
    scannedFiles,
    matchedFiles: files.length,
    deletedFiles,
    bytesMatched,
    bytesDeleted,
    files,
  };
}

export function parseCleanupAttachmentKinds(value: string): CleanupAttachmentKind[] {
  const kinds = value.split(",").map((kind) => kind.trim()).filter(Boolean);
  if (kinds.length === 0 || kinds.some((kind) => !isTelegramAttachmentKind(kind))) {
    throw new Error(`--kinds must be a comma-separated list of: ${TELEGRAM_ATTACHMENT_KINDS.join(",")}.`);
  }

  return [...new Set(kinds)] as CleanupAttachmentKind[];
}

export function parseDurationMs(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new Error("--older-than must use a duration like 30m, 12h, or 7d.");
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return amount * multiplier;
}

async function listFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
}

function detectTelegramAttachmentKind(filePath: string): CleanupAttachmentKind | undefined {
  const name = filePath.split(/[\\/]/).at(-1) ?? "";
  const match = /^\d+-\d+-(photo|document|voice|audio|video|sticker)-/.exec(name);
  return match && isTelegramAttachmentKind(match[1]) ? match[1] : undefined;
}

function isTelegramAttachmentKind(value: string): value is CleanupAttachmentKind {
  return TELEGRAM_ATTACHMENT_KINDS.includes(value as CleanupAttachmentKind);
}
