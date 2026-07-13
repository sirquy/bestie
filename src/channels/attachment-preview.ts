import { parseAttachmentContent, type AttachmentContentParser } from "./attachment-parser.js";

export interface ChannelAttachmentPreviewOptions {
  bytes: Uint8Array;
  localPath: string;
  mimeType?: string;
  previewMaxBytes: number;
  parseMaxBytes: number;
}

export interface ChannelAttachmentPreview {
  textPreview?: string;
  textPreviewTruncated?: boolean;
  contentParser?: AttachmentContentParser;
  parseWarning?: string;
}

export type { AttachmentContentParser };

export async function buildChannelAttachmentPreview(options: ChannelAttachmentPreviewOptions): Promise<ChannelAttachmentPreview> {
  return parseAttachmentContent(options);
}