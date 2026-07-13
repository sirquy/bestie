import type { ChannelAudioTranscriptResult } from "./audio-transcription.js";
import type { ChannelAttachmentPreview } from "./attachment-preview.js";
import type { ChannelVisionAttachment } from "./attachment-vision.js";
import type { ChannelDownloadedAttachment, ChannelPersistedAttachmentFile } from "./attachments.js";

export interface ChannelAttachmentPipelineResult extends ChannelAttachmentPreview, ChannelAudioTranscriptResult {
  localPath: string;
  localPathRetained: boolean;
  bytes: number;
  visionImage?: ChannelVisionAttachment;
}

export async function processChannelAttachment(options: {
  validate: () => void;
  download: () => Promise<ChannelDownloadedAttachment>;
  buildLocalPath: (downloaded: ChannelDownloadedAttachment) => string;
  persist: (input: { localPath: string; bytes: Uint8Array }) => Promise<ChannelPersistedAttachmentFile>;
  preview: (input: { localPath: string; bytes: Uint8Array }) => Promise<ChannelAttachmentPreview>;
  vision: (input: { localPath: string; bytes: Uint8Array }) => ChannelVisionAttachment | undefined;
  transcribe: (input: { localPath: string; bytes: Uint8Array }) => Promise<ChannelAudioTranscriptResult>;
  retain: (input: { localPath: string }) => Promise<boolean>;
}): Promise<ChannelAttachmentPipelineResult> {
  options.validate();
  const downloaded = await options.download();
  const localPath = options.buildLocalPath(downloaded);
  const persisted = await options.persist({ localPath, bytes: downloaded.bytes });
  const preview = await options.preview({ localPath: persisted.localPath, bytes: downloaded.bytes });
  const visionImage = options.vision({ localPath: persisted.localPath, bytes: downloaded.bytes });
  const transcription = await options.transcribe({ localPath: persisted.localPath, bytes: downloaded.bytes });
  const localPathRetained = await options.retain({ localPath: persisted.localPath });

  return {
    localPath: persisted.localPath,
    localPathRetained,
    bytes: persisted.bytes,
    ...preview,
    ...(visionImage === undefined ? {} : { visionImage }),
    ...transcription,
  };
}