import assert from "node:assert/strict";
import { access, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  ChannelAttachmentHandlingError,
  buildChannelAttachmentPath,
  assertChannelAttachmentDownloadAllowed,
  assertChannelAttachmentMimeAllowed,
  assertChannelAttachmentSizeAllowed,
  applyChannelAttachmentRetention,
  downloadChannelAttachmentBytes,
  formatChannelTranscriptLabel,
  isAllowedChannelAttachmentMimeType,
  isAudioAttachmentKind,
  persistChannelAttachmentFile,
  sanitizeChannelFileName,
} from "./attachments.js";

test("isAudioAttachmentKind narrows voice and audio attachment kinds", () => {
  assert.equal(isAudioAttachmentKind("voice"), true);
  assert.equal(isAudioAttachmentKind("audio"), true);
  assert.equal(isAudioAttachmentKind("photo"), false);
});

test("formatChannelTranscriptLabel includes source and truncation", () => {
  assert.equal(formatChannelTranscriptLabel({ text: "hello", source: "provider" }), "Audio transcript from provider STT");
  assert.equal(formatChannelTranscriptLabel({ text: "hello", source: "platform", truncated: true }), "Audio transcript from platform ASR (truncated)");
  assert.equal(formatChannelTranscriptLabel({ text: "hello", source: "fallback" }), "Audio transcript from fallback text");
});

test("sanitizeChannelFileName keeps attachment file names bounded and portable", () => {
  assert.equal(sanitizeChannelFileName(" hello/world?.txt "), "hello-world-.txt");
  assert.equal(sanitizeChannelFileName("***"), "attachment");
  assert.equal(sanitizeChannelFileName("a".repeat(100)).length, 80);
});

test("buildChannelAttachmentPath uses shared channel layout and sanitized base names", () => {
  assert.equal(
    buildChannelAttachmentPath({
      workspaceDir: "/workspace",
      channelName: "telegram",
      date: "2026-07-13",
      updateId: 42,
      messageId: 7,
      kind: "document",
      sourceName: "unsafe report?.txt",
      extension: ".txt",
    }),
    "/workspace/telegram/2026-07-13/42-7-document-unsafe-report.txt",
  );
});

test("isAllowedChannelAttachmentMimeType supports exact and wildcard rules", () => {
  assert.equal(isAllowedChannelAttachmentMimeType("image/png", ["image/*"]), true);
  assert.equal(isAllowedChannelAttachmentMimeType("TEXT/PLAIN", ["text/plain"]), true);
  assert.equal(isAllowedChannelAttachmentMimeType(undefined, ["image/*"]), false);
  assert.equal(isAllowedChannelAttachmentMimeType("application/pdf", ["image/*"]), false);
});

test("channel attachment assertions throw structured handling errors", () => {
  assert.throws(
    () => assertChannelAttachmentDownloadAllowed({ downloadPolicy: "deny", message: "downloads disabled" }),
    (error) => error instanceof ChannelAttachmentHandlingError && error.reason === "download_disabled" && error.userMessage === "downloads disabled",
  );
  assert.doesNotThrow(() => assertChannelAttachmentDownloadAllowed({ downloadPolicy: "allow", message: "downloads disabled" }));

  assert.throws(
    () => assertChannelAttachmentMimeAllowed({ mimeType: "application/pdf", allowedMimeTypes: ["image/*"], message: "mime denied" }),
    (error) => error instanceof ChannelAttachmentHandlingError && error.reason === "mime_denied",
  );

  assert.throws(
    () => assertChannelAttachmentSizeAllowed({ bytes: 11, maxBytes: 10, message: "too large" }),
    (error) => error instanceof ChannelAttachmentHandlingError && error.reason === "too_large",
  );
});

test("downloadChannelAttachmentBytes downloads metadata and bytes", async () => {
  const result = await downloadChannelAttachmentBytes({
    fileId: "file-1",
    reportedSize: 2,
    maxBytes: 10,
    getFile: async (fileId) => ({ filePath: `${fileId}.bin`, fileSize: 3 }),
    downloadFile: async () => new Uint8Array([1, 2, 3]),
    messages: downloadMessages(),
  });

  assert.deepEqual(result, { filePath: "file-1.bin", bytes: new Uint8Array([1, 2, 3]), expectedSize: 3 });
});

test("downloadChannelAttachmentBytes maps adapter failures to structured errors", async () => {
  await assert.rejects(
    () => downloadChannelAttachmentBytes({ fileId: "file-1", maxBytes: 10, messages: downloadMessages() }),
    (error) => error instanceof ChannelAttachmentHandlingError && error.reason === "client_unsupported",
  );
  await assert.rejects(
    () => downloadChannelAttachmentBytes({ fileId: "file-1", maxBytes: 10, getFile: async () => { throw new Error("boom"); }, downloadFile: async () => new Uint8Array(), messages: downloadMessages() }),
    (error) => error instanceof ChannelAttachmentHandlingError && error.reason === "metadata_failed",
  );
  await assert.rejects(
    () => downloadChannelAttachmentBytes({ fileId: "file-1", maxBytes: 10, getFile: async () => ({}), downloadFile: async () => new Uint8Array(), messages: downloadMessages() }),
    (error) => error instanceof ChannelAttachmentHandlingError && error.reason === "missing_file_path",
  );
  await assert.rejects(
    () => downloadChannelAttachmentBytes({ fileId: "file-1", maxBytes: 10, getFile: async () => ({ filePath: "file.bin" }), downloadFile: async () => { throw new Error("boom"); }, messages: downloadMessages() }),
    (error) => error instanceof ChannelAttachmentHandlingError && error.reason === "download_failed",
  );
});

test("downloadChannelAttachmentBytes enforces reported metadata and downloaded byte limits", async () => {
  await assert.rejects(
    () => downloadChannelAttachmentBytes({ fileId: "file-1", reportedSize: 11, maxBytes: 10, getFile: async () => ({ filePath: "file.bin" }), downloadFile: async () => new Uint8Array(), messages: downloadMessages() }),
    (error) => error instanceof ChannelAttachmentHandlingError && error.reason === "too_large",
  );
  await assert.rejects(
    () => downloadChannelAttachmentBytes({ fileId: "file-1", maxBytes: 10, getFile: async () => ({ filePath: "file.bin", fileSize: 11 }), downloadFile: async () => new Uint8Array(), messages: downloadMessages() }),
    (error) => error instanceof ChannelAttachmentHandlingError && error.reason === "too_large",
  );
  await assert.rejects(
    () => downloadChannelAttachmentBytes({ fileId: "file-1", maxBytes: 2, getFile: async () => ({ filePath: "file.bin" }), downloadFile: async () => new Uint8Array([1, 2, 3]), messages: downloadMessages() }),
    (error) => error instanceof ChannelAttachmentHandlingError && error.reason === "too_large",
  );
});

test("persistChannelAttachmentFile writes private attachment bytes", async (t) => {
  const root = join(process.cwd(), ".tmp-channel-attachment-test", `${Date.now()}-${Math.random()}`);
  const localPath = join(root, "nested", "file.bin");
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await persistChannelAttachmentFile({ localPath, bytes: new Uint8Array([1, 2, 3]) });

  assert.deepEqual(result, { localPath, bytes: 3 });
  assert.deepEqual(await readFile(localPath), Buffer.from([1, 2, 3]));
});

test("applyChannelAttachmentRetention removes configured kinds and reports cleanup failures", async (t) => {
  const root = join(process.cwd(), ".tmp-channel-attachment-test", `${Date.now()}-${Math.random()}`);
  const localPath = join(root, "file.bin");
  t.after(() => rm(root, { recursive: true, force: true }));

  await persistChannelAttachmentFile({ localPath, bytes: new Uint8Array([1]) });
  assert.equal(await applyChannelAttachmentRetention({ localPath, kind: "voice", deleteAfterProcessingKinds: ["voice"] }), false);
  await assert.rejects(() => access(localPath));

  const failures: Array<{ kind: string; message: string }> = [];
  assert.equal(
    await applyChannelAttachmentRetention({
      localPath,
      kind: "voice",
      deleteAfterProcessingKinds: ["voice"],
      onCleanupFailed: (detail) => {
        failures.push(detail);
      },
    }),
    true,
  );
  assert.deepEqual(failures.map((failure) => failure.kind), ["voice"]);
});

function downloadMessages() {
  return {
    clientUnsupported: "client unsupported",
    metadataFailed: "metadata failed",
    missingFilePath: "missing path",
    downloadFailed: "download failed",
    tooLarge: "too large",
  };
}