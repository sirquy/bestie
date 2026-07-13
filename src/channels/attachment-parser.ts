import { createRequire } from "node:module";
import { extname } from "node:path";

import mammoth from "mammoth";

export type AttachmentContentParser = "text" | "pdf" | "docx";

export interface ParseAttachmentContentOptions {
  bytes: Uint8Array;
  localPath: string;
  mimeType?: string;
  previewMaxBytes: number;
  parseMaxBytes: number;
}

export interface ParsedAttachmentContent {
  textPreview?: string;
  textPreviewTruncated?: boolean;
  contentParser?: AttachmentContentParser;
  parseWarning?: string;
}

interface PdfParseResult {
  text?: string;
}

type PdfParse = (dataBuffer: Buffer, options?: { max?: number }) => Promise<PdfParseResult>;

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as PdfParse;

export async function parseAttachmentContent(options: ParseAttachmentContentOptions): Promise<ParsedAttachmentContent> {
  const parser = detectAttachmentContentParser(options.localPath, options.mimeType);
  if (!parser) {
    return {};
  }

  if (looksBinary(options.bytes) && parser === "text") {
    return {};
  }

  if (options.bytes.byteLength > options.parseMaxBytes) {
    return {
      contentParser: parser,
      parseWarning: `Skipped ${parser} parsing because the file exceeds parseMaxBytes (${options.parseMaxBytes} bytes).`,
    };
  }

  try {
    const rawText = await extractAttachmentText(parser, options.bytes);
    const normalized = normalizeExtractedText(rawText);
    if (!normalized) {
      return { contentParser: parser, parseWarning: `No readable text was extracted from this ${parser} attachment.` };
    }

    const truncated = truncateUtf8Text(normalized, options.previewMaxBytes);
    return {
      contentParser: parser,
      textPreview: truncated.text,
      textPreviewTruncated: truncated.truncated,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown parser error";
    return { contentParser: parser, parseWarning: `Could not parse ${parser} attachment text: ${message}` };
  }
}

function detectAttachmentContentParser(localPath: string, mimeType: string | undefined): AttachmentContentParser | undefined {
  const normalizedMime = mimeType?.toLowerCase() ?? "";
  const extension = extname(localPath).toLowerCase();

  if (normalizedMime === "application/pdf" || extension === ".pdf") {
    return "pdf";
  }
  if (normalizedMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || extension === ".docx") {
    return "docx";
  }
  if (isTextLikeAttachment(localPath, normalizedMime)) {
    return "text";
  }

  return undefined;
}

async function extractAttachmentText(parser: AttachmentContentParser, bytes: Uint8Array): Promise<string> {
  const buffer = Buffer.from(bytes);
  if (parser === "pdf") {
    const result = await pdfParse(buffer);
    return result.text ?? "";
  }
  if (parser === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\u0000/g, "");
}

function isTextLikeAttachment(localPath: string, mimeType: string): boolean {
  if (mimeType.startsWith("text/") || ["application/json", "application/xml", "application/yaml", "application/x-yaml", "application/javascript"].includes(mimeType)) {
    return true;
  }

  return [".txt", ".md", ".markdown", ".json", ".jsonl", ".csv", ".tsv", ".log", ".xml", ".yaml", ".yml", ".js", ".ts", ".css", ".html"].includes(extname(localPath).toLowerCase());
}

function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.byteLength, 1024));
  return sample.includes(0);
}

function normalizeExtractedText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/[\t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function truncateUtf8Text(value: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return { text: value, truncated: false };
  }

  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, mid), "utf8") <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return { text: value.slice(0, low).trimEnd(), truncated: true };
}
