import assert from "node:assert/strict";
import test from "node:test";

import { parseTelegramSmokeTranscript, validateTelegramSmokeTranscript, type TelegramSmokeTranscriptEvent } from "./telegram-smoke-transcript.js";

test("validateTelegramSmokeTranscript accepts a final reply that replaces tool activity", () => {
  const summary = validateTelegramSmokeTranscript([
    event("telegram_get_updates_finish", { count: 1, updates: [{ fromOwner: true }] }),
    event("telegram_send_chat_action"),
    event("telegram_send_message", { kind: "tool_progress", progressLabel: "internal.read_markdown_bundle . markdown bundle" }),
    event("telegram_edit_message_text", { kind: "reply", textLength: 1200 }),
  ]);

  assert.deepEqual(summary, {
    updates: 1,
    ownerUpdates: 1,
    outboundMessages: 1,
    replies: 1,
    edits: 1,
    progressMessages: 1,
    progressEdits: 0,
    hasTyping: true,
    attachmentUpdates: 0,
    downloadedFiles: 0,
    parsedAttachments: 0,
    textPreviewAttachments: 0,
    parseWarningAttachments: 0,
    visionInputAttachments: 0,
    audioTranscriptAttachments: 0,
    transcriptionWarningAttachments: 0,
  });
});

test("validateTelegramSmokeTranscript summarizes attachment downloads without raw file data", () => {
  const summary = validateTelegramSmokeTranscript([
    event("telegram_get_updates_finish", { count: 1, updates: [{ fromOwner: true, hasAttachment: true, attachmentKind: "document", captionLength: 12 }] }),
    event("telegram_send_chat_action"),
    event("telegram_get_file_start", { file: "hash-file" }),
    event("telegram_get_file_finish", { file: "hash-file", hasFilePath: true, fileSize: 18 }),
    event("telegram_download_file_start", { filePathHash: "hash-path" }),
    event("telegram_download_file_finish", { filePathHash: "hash-path", bytes: 18 }),
    event("telegram_attachment_parse", { kind: "document", mimeType: "text/plain", savedBytes: 18, contentParser: "text", hasTextPreview: true, textPreviewTruncated: false, hasParseWarning: false, hasVisionInput: false, hasAudioTranscript: false, hasTranscriptionWarning: false }),
    event("telegram_send_message", { kind: "reply", textLength: 42 }),
  ]);

  assert.equal(summary.attachmentUpdates, 1);
  assert.equal(summary.downloadedFiles, 1);
  assert.equal(summary.parsedAttachments, 1);
  assert.equal(summary.textPreviewAttachments, 1);
  assert.equal(summary.parseWarningAttachments, 0);
  assert.equal(summary.visionInputAttachments, 0);
  assert.equal(summary.audioTranscriptAttachments, 0);
  assert.equal(summary.transcriptionWarningAttachments, 0);
  assert.equal(summary.replies, 1);
});

test("validateTelegramSmokeTranscript rejects repeated progress messages", () => {
  assert.throws(
    () => validateTelegramSmokeTranscript([
      event("telegram_get_updates_finish", { count: 1, updates: [{ fromOwner: true }] }),
      event("telegram_send_chat_action"),
      event("telegram_send_message", { kind: "tool_progress" }),
      event("telegram_send_message", { kind: "tool_progress" }),
      event("telegram_edit_message_text", { kind: "reply" }),
    ]),
    /at most one tool progress message/,
  );
});

test("validateTelegramSmokeTranscript rejects tool activity without a final edit", () => {
  assert.throws(
    () => validateTelegramSmokeTranscript([
      event("telegram_get_updates_finish", { count: 1, updates: [{ fromOwner: true }] }),
      event("telegram_send_chat_action"),
      event("telegram_send_message", { kind: "tool_progress" }),
      event("telegram_send_message", { kind: "reply" }),
    ]),
    /no message edits were recorded/,
  );
});

test("validateTelegramSmokeTranscript rejects updates without the configured owner", () => {
  assert.throws(
    () => validateTelegramSmokeTranscript([
      event("telegram_get_updates_finish", { count: 1, updates: [{ fromOwner: false }] }),
      event("telegram_send_chat_action"),
      event("telegram_send_message", { kind: "reply" }),
    ]),
    /No owner Telegram updates/,
  );
});

test("validateTelegramSmokeTranscript rejects runs without a reply", () => {
  assert.throws(
    () => validateTelegramSmokeTranscript([
      event("telegram_get_updates_finish", { count: 1, updates: [{ fromOwner: true }] }),
      event("telegram_send_chat_action"),
      event("telegram_send_message", { kind: "tool_progress" }),
    ]),
    /No Telegram reply/,
  );
});

test("parseTelegramSmokeTranscript reads JSONL transcript events", () => {
  assert.deepEqual(
    parseTelegramSmokeTranscript('{"event":"telegram_get_updates_finish","detail":{"count":1}}\n{"event":"telegram_send_message"}\n'),
    [event("telegram_get_updates_finish", { count: 1 }), event("telegram_send_message")],
  );
});

function event(eventName: string, detail?: TelegramSmokeTranscriptEvent["detail"]): TelegramSmokeTranscriptEvent {
  return detail === undefined ? { event: eventName } : { event: eventName, detail };
}
