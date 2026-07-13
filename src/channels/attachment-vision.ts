import { extname } from "node:path";

import type { ChannelAttachmentKind } from "./attachments.js";

export interface ChannelVisionAttachmentInput {
  kind: ChannelAttachmentKind;
  mimeType?: string;
  localPath: string;
  bytes: Uint8Array;
  visionPolicy: "allow" | "deny";
  visionMaxBytes: number;
}

export interface ChannelVisionAttachment {
  mimeType: string;
  dataUrl: string;
}

export function buildChannelVisionAttachment(input: ChannelVisionAttachmentInput): ChannelVisionAttachment | undefined {
  if (input.visionPolicy !== "allow" || input.bytes.byteLength > input.visionMaxBytes) {
    return undefined;
  }

  const mimeType = getChannelVisionMimeType(input);
  if (!mimeType) {
    return undefined;
  }

  return { mimeType, dataUrl: `data:${mimeType};base64,${Buffer.from(input.bytes).toString("base64")}` };
}

function getChannelVisionMimeType(input: Pick<ChannelVisionAttachmentInput, "kind" | "mimeType" | "localPath">): string | undefined {
  const mimeType = input.mimeType?.toLowerCase();
  if (mimeType && ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mimeType)) {
    return mimeType;
  }

  const extension = extname(input.localPath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (input.kind === "photo") return "image/jpeg";
  return undefined;
}