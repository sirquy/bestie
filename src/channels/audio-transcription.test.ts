import assert from "node:assert/strict";
import test from "node:test";

import { buildChannelAudioTranscriptResult, buildChannelProvidedAudioTranscriptResult, normalizeChannelTranscript, truncateChannelTranscript } from "./audio-transcription.js";

test("normalizeChannelTranscript trims whitespace and collapses blank lines", () => {
  assert.equal(normalizeChannelTranscript("  hello \r\n\t\n\n\nworld  "), "hello\n\nworld");
});

test("truncateChannelTranscript respects UTF-8 byte limits", () => {
  const result = truncateChannelTranscript("xin chào thế giới", 9);

  assert.equal(Buffer.byteLength(result.text, "utf8") <= 9, true);
  assert.equal(result.truncated, true);
});

test("buildChannelAudioTranscriptResult returns warning for empty transcript", () => {
  assert.deepEqual(
    buildChannelAudioTranscriptResult({ text: " \n ", maxBytes: 100, source: "provider", emptyWarning: "empty" }),
    { transcriptionWarning: "empty" },
  );
});

test("buildChannelAudioTranscriptResult records source and truncation", () => {
  assert.deepEqual(
    buildChannelAudioTranscriptResult({ text: "hello world", maxBytes: 5, source: "platform", emptyWarning: "empty" }),
    { audioTranscript: "hello", audioTranscriptTruncated: true, audioTranscriptSource: "platform" },
  );
});

test("buildChannelProvidedAudioTranscriptResult reuses platform or fallback transcript text", () => {
  assert.deepEqual(
    buildChannelProvidedAudioTranscriptResult({ transcript: { text: " platform transcript ", source: "platform" }, maxBytes: 100 }),
    { audioTranscript: "platform transcript", audioTranscriptTruncated: false, audioTranscriptSource: "platform" },
  );
  assert.equal(buildChannelProvidedAudioTranscriptResult({ transcript: { text: " ", source: "fallback" }, maxBytes: 100 }), undefined);
});