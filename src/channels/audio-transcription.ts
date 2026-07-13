import type { ChannelTranscriptSource } from "./attachments.js";

export interface ChannelAudioTranscriptResult {
  audioTranscript?: string;
  audioTranscriptTruncated?: boolean;
  audioTranscriptSource?: ChannelTranscriptSource;
  transcriptionWarning?: string;
}

export interface ChannelProvidedAudioTranscript {
  text: string;
  source: ChannelTranscriptSource;
}

export function normalizeChannelTranscript(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/[\t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function truncateChannelTranscript(value: string, maxBytes: number): { text: string; truncated: boolean } {
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

export function buildChannelAudioTranscriptResult(options: {
  text: string;
  maxBytes: number;
  source: ChannelTranscriptSource;
  emptyWarning: string;
}): ChannelAudioTranscriptResult {
  const transcript = normalizeChannelTranscript(options.text);
  if (!transcript) {
    return { transcriptionWarning: options.emptyWarning };
  }

  const truncated = truncateChannelTranscript(transcript, options.maxBytes);
  return {
    audioTranscript: truncated.text,
    audioTranscriptTruncated: truncated.truncated,
    audioTranscriptSource: options.source,
  };
}

export function buildChannelProvidedAudioTranscriptResult(options: {
  transcript?: ChannelProvidedAudioTranscript;
  maxBytes: number;
}): ChannelAudioTranscriptResult | undefined {
  if (!options.transcript) {
    return undefined;
  }

  const transcript = buildChannelAudioTranscriptResult({
    text: options.transcript.text,
    maxBytes: options.maxBytes,
    source: options.transcript.source,
    emptyWarning: "",
  });

  return transcript.audioTranscript ? transcript : undefined;
}