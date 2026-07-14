import assert from "node:assert/strict";
import test from "node:test";

import { parseZaloSmokeTranscript, validateZaloSmokeTranscript, type ZaloSmokeTranscriptEvent } from "./zalo-smoke-transcript.js";

test("validateZaloSmokeTranscript accepts owner update with reply", () => {
  const summary = validateZaloSmokeTranscript([
    event("zalo_get_updates_finish", { count: 1, updates: [{ fromOwner: true, hasAttachment: false }] }),
    event("zalo_send_chat_action"),
    event("zalo_send_message", { kind: "reply", textLength: 120 }),
  ]);

  assert.deepEqual(summary, {
    updates: 1,
    ownerUpdates: 1,
    outboundMessages: 1,
    replies: 1,
    progressMessages: 0,
    hasTyping: true,
    attachmentUpdates: 0,
  });
});

test("validateZaloSmokeTranscript summarizes attachment-like updates", () => {
  const summary = validateZaloSmokeTranscript([
    event("zalo_get_updates_finish", { count: 1, updates: [{ fromOwner: true, hasAttachment: true }] }),
    event("zalo_send_chat_action"),
    event("zalo_send_message", { kind: "reply", textLength: 42 }),
  ]);

  assert.equal(summary.attachmentUpdates, 1);
  assert.equal(summary.replies, 1);
});

test("validateZaloSmokeTranscript rejects repeated progress messages", () => {
  assert.throws(
    () => validateZaloSmokeTranscript([
      event("zalo_get_updates_finish", { count: 1, updates: [{ fromOwner: true }] }),
      event("zalo_send_chat_action"),
      event("zalo_send_message", { kind: "tool_progress" }),
      event("zalo_send_message", { kind: "tool_progress" }),
      event("zalo_send_message", { kind: "reply" }),
    ]),
    /at most one tool progress message/,
  );
});

test("validateZaloSmokeTranscript rejects updates without owner", () => {
  assert.throws(
    () => validateZaloSmokeTranscript([
      event("zalo_get_updates_finish", { count: 1, updates: [{ fromOwner: false }] }),
      event("zalo_send_chat_action"),
      event("zalo_send_message", { kind: "reply" }),
    ]),
    /No owner Zalo updates/,
  );
});

test("parseZaloSmokeTranscript reads JSONL transcript events", () => {
  assert.deepEqual(
    parseZaloSmokeTranscript('{"event":"zalo_get_updates_finish","detail":{"count":1}}\n{"event":"zalo_send_message"}\n'),
    [event("zalo_get_updates_finish", { count: 1 }), event("zalo_send_message")],
  );
});

function event(eventName: string, detail?: ZaloSmokeTranscriptEvent["detail"]): ZaloSmokeTranscriptEvent {
  return detail === undefined ? { event: eventName } : { event: eventName, detail };
}