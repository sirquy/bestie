import { createAudioTranscription } from "../llm/openai-transcription.js";
import { createSpeech } from "../llm/openai-speech.js";
import type { FetchLike } from "../llm/openai-compatible.js";
import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import type { ChannelAttachmentKind } from "./attachments.js";

export interface ChannelVoiceTranscriptionInput {
  bytes: Uint8Array;
  localPath: string;
  mimeType?: string;
  kind: Extract<ChannelAttachmentKind, "voice" | "audio">;
  duration?: number;
}

export interface ChannelVoiceTranscriptionResult {
  text: string;
}

export type ChannelVoiceTranscriber = (input: ChannelVoiceTranscriptionInput) => Promise<ChannelVoiceTranscriptionResult>;

export interface ChannelSpeechSynthesisResult {
  bytes: Uint8Array;
  mimeType: string;
}

export type ChannelSpeechSynthesizer = (text: string) => Promise<ChannelSpeechSynthesisResult>;

export function createChannelVoiceTranscriber(options: {
  config: AppConfig;
  paths: RuntimePaths;
  transcriptionPolicy?: "allow" | "deny";
  fetchImpl?: FetchLike;
}): ChannelVoiceTranscriber | undefined {
  if (options.transcriptionPolicy !== "allow" || !options.config.transcription) {
    return undefined;
  }

  return async (input) => ({
    text: await createAudioTranscription(
      options.config,
      { bytes: input.bytes, localPath: input.localPath, mimeType: input.mimeType },
      { paths: options.paths, fetchImpl: options.fetchImpl },
    ),
  });
}

export function createChannelSpeechSynthesizer(options: {
  config: AppConfig;
  paths: RuntimePaths;
  fetchImpl?: FetchLike;
}): ChannelSpeechSynthesizer | undefined {
  if (!options.config.speech) {
    return undefined;
  }

  return async (text) => createSpeech(options.config, { text }, { paths: options.paths, fetchImpl: options.fetchImpl });
}
