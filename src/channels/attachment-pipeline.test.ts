import assert from "node:assert/strict";
import test from "node:test";

import { processChannelAttachment } from "./attachment-pipeline.js";

test("processChannelAttachment runs attachment steps in order and merges outputs", async () => {
  const steps: string[] = [];

  const result = await processChannelAttachment({
    validate: () => {
      steps.push("validate");
    },
    download: async () => {
      steps.push("download");
      return { filePath: "source.txt", bytes: new Uint8Array([1, 2, 3]) };
    },
    buildLocalPath: (downloaded) => {
      steps.push(`path:${downloaded.filePath}`);
      return "/workspace/source.txt";
    },
    persist: async (input) => {
      steps.push(`persist:${input.bytes.byteLength}`);
      return { localPath: input.localPath, bytes: input.bytes.byteLength };
    },
    preview: async (input) => {
      steps.push(`preview:${input.localPath}`);
      return { textPreview: "hello", contentParser: "text" };
    },
    vision: (input) => {
      steps.push(`vision:${input.bytes.byteLength}`);
      return { mimeType: "image/png", dataUrl: "data:image/png;base64,AQID" };
    },
    transcribe: async (input) => {
      steps.push(`transcribe:${input.localPath}`);
      return { audioTranscript: "voice", audioTranscriptSource: "provider", audioTranscriptTruncated: false };
    },
    retain: async (input) => {
      steps.push(`retain:${input.localPath}`);
      return true;
    },
  });

  assert.deepEqual(steps, ["validate", "download", "path:source.txt", "persist:3", "preview:/workspace/source.txt", "vision:3", "transcribe:/workspace/source.txt", "retain:/workspace/source.txt"]);
  assert.deepEqual(result, {
    localPath: "/workspace/source.txt",
    localPathRetained: true,
    bytes: 3,
    textPreview: "hello",
    contentParser: "text",
    visionImage: { mimeType: "image/png", dataUrl: "data:image/png;base64,AQID" },
    audioTranscript: "voice",
    audioTranscriptSource: "provider",
    audioTranscriptTruncated: false,
  });
});

test("processChannelAttachment stops before download when validation fails", async () => {
  let downloaded = false;

  await assert.rejects(() => processChannelAttachment({
    validate: () => {
      throw new Error("nope");
    },
    download: async () => {
      downloaded = true;
      return { filePath: "source.txt", bytes: new Uint8Array() };
    },
    buildLocalPath: () => "source.txt",
    persist: async () => ({ localPath: "source.txt", bytes: 0 }),
    preview: async () => ({}),
    vision: () => undefined,
    transcribe: async () => ({}),
    retain: async () => true,
  }));
  assert.equal(downloaded, false);
});