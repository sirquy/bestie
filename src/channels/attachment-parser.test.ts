import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { parseAttachmentContent } from "./attachment-parser.js";

test("parseAttachmentContent extracts bounded text previews", async () => {
  const result = await parseAttachmentContent({
    bytes: new TextEncoder().encode("hello from a text attachment"),
    localPath: "note.txt",
    mimeType: "text/plain",
    previewMaxBytes: 10,
    parseMaxBytes: 1024,
  });

  assert.deepEqual(result, {
    contentParser: "text",
    textPreview: "hello from",
    textPreviewTruncated: true,
  });
});

test("parseAttachmentContent extracts DOCX raw text", async () => {
  const bytes = await readFile(resolve("node_modules/mammoth/test/test-data/single-paragraph.docx"));
  const result = await parseAttachmentContent({
    bytes,
    localPath: "single-paragraph.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    previewMaxBytes: 1024,
    parseMaxBytes: 1024 * 1024,
  });

  assert.equal(result.contentParser, "docx");
  assert.equal(result.textPreview, "Walking on imported air");
  assert.equal(result.textPreviewTruncated, false);
});

test("parseAttachmentContent extracts PDF text", async () => {
  const bytes = await readFile(resolve("node_modules/pdf-parse/test/data/01-valid.pdf"));
  const result = await parseAttachmentContent({
    bytes,
    localPath: "paper.pdf",
    mimeType: "application/pdf",
    previewMaxBytes: 256,
    parseMaxBytes: 1024 * 1024,
  });

  assert.equal(result.contentParser, "pdf");
  assert.match(result.textPreview ?? "", /Trace-based Just-in-Time Type Specialization/);
});

test("parseAttachmentContent skips expensive parsing above parseMaxBytes", async () => {
  const result = await parseAttachmentContent({
    bytes: new TextEncoder().encode("hello"),
    localPath: "note.txt",
    mimeType: "text/plain",
    previewMaxBytes: 1024,
    parseMaxBytes: 1,
  });

  assert.equal(result.contentParser, "text");
  assert.match(result.parseWarning ?? "", /exceeds parseMaxBytes/);
  assert.equal(result.textPreview, undefined);
});
