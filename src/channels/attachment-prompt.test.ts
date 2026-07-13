import assert from "node:assert/strict";
import test from "node:test";

import { buildChannelAttachmentPrompt } from "./attachment-prompt.js";

test("buildChannelAttachmentPrompt formats saved attachment metadata and preview guidance", () => {
  const prompt = buildChannelAttachmentPrompt({
    channelDisplayName: "Telegram",
    caption: "please read this",
    kind: "document",
    fileName: "note.txt",
    mimeType: "text/plain",
    reportedSize: 12,
    savedBytes: 12,
    localPath: "/tmp/note.txt",
    localPathRetained: true,
    textPreview: "hello",
    textPreviewParser: "text",
    visionAttached: false,
  });

  assert.match(prompt, /User caption: please read this/);
  assert.match(prompt, /Telegram attachment saved locally/);
  assert.match(prompt, /Telegram reported size: 12 bytes/);
  assert.match(prompt, /Text preview \(text\):\nhello/);
  assert.match(prompt, /Use the preview for a quick answer/);
});

test("buildChannelAttachmentPrompt formats transcript source and retained-file guidance", () => {
  const prompt = buildChannelAttachmentPrompt({
    channelDisplayName: "Zalo",
    kind: "voice",
    savedBytes: 8,
    localPathRetained: false,
    visionAttached: false,
    audioTranscript: "xin chao",
    audioTranscriptSource: "platform",
    audioTranscriptTruncated: true,
  });

  assert.match(prompt, /User sent a Zalo attachment with no caption/);
  assert.match(prompt, /Local file: removed after processing by Zalo attachment retention policy/);
  assert.match(prompt, /Audio transcript from platform ASR \(truncated\):\nxin chao/);
  assert.match(prompt, /Use the available metadata or transcript/);
});