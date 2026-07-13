import assert from "node:assert/strict";
import test from "node:test";

import { buildChannelAttachmentPreview } from "./attachment-preview.js";

test("buildChannelAttachmentPreview returns bounded text previews", async () => {
  const result = await buildChannelAttachmentPreview({
    bytes: new TextEncoder().encode("hello from a shared channel preview"),
    localPath: "note.txt",
    mimeType: "text/plain",
    previewMaxBytes: 10,
    parseMaxBytes: 1024,
  });

  assert.deepEqual(result, { contentParser: "text", textPreview: "hello from", textPreviewTruncated: true });
});

test("buildChannelAttachmentPreview preserves parser warnings", async () => {
  const result = await buildChannelAttachmentPreview({
    bytes: new TextEncoder().encode("hello"),
    localPath: "note.txt",
    mimeType: "text/plain",
    previewMaxBytes: 100,
    parseMaxBytes: 1,
  });

  assert.equal(result.contentParser, "text");
  assert.match(result.parseWarning ?? "", /exceeds parseMaxBytes/);
});