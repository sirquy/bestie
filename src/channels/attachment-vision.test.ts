import assert from "node:assert/strict";
import test from "node:test";

import { buildChannelVisionAttachment } from "./attachment-vision.js";

test("buildChannelVisionAttachment builds data URLs for allowed image MIME types", () => {
  assert.deepEqual(
    buildChannelVisionAttachment({ kind: "photo", mimeType: "IMAGE/PNG", localPath: "photo.bin", bytes: new Uint8Array([1, 2, 3]), visionPolicy: "allow", visionMaxBytes: 10 }),
    { mimeType: "image/png", dataUrl: "data:image/png;base64,AQID" },
  );
});

test("buildChannelVisionAttachment infers image MIME types from paths and photo kind", () => {
  assert.equal(buildChannelVisionAttachment({ kind: "document", localPath: "image.webp", bytes: new Uint8Array([1]), visionPolicy: "allow", visionMaxBytes: 10 })?.mimeType, "image/webp");
  assert.equal(buildChannelVisionAttachment({ kind: "photo", localPath: "photo.bin", bytes: new Uint8Array([1]), visionPolicy: "allow", visionMaxBytes: 10 })?.mimeType, "image/jpeg");
});

test("buildChannelVisionAttachment returns undefined when denied too large or unsupported", () => {
  assert.equal(buildChannelVisionAttachment({ kind: "photo", localPath: "photo.jpg", bytes: new Uint8Array([1]), visionPolicy: "deny", visionMaxBytes: 10 }), undefined);
  assert.equal(buildChannelVisionAttachment({ kind: "photo", localPath: "photo.jpg", bytes: new Uint8Array([1, 2]), visionPolicy: "allow", visionMaxBytes: 1 }), undefined);
  assert.equal(buildChannelVisionAttachment({ kind: "document", localPath: "note.txt", bytes: new Uint8Array([1]), visionPolicy: "allow", visionMaxBytes: 10 }), undefined);
});