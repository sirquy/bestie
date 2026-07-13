import assert from "node:assert/strict";
import test from "node:test";

import { createChannelResponseController, type ChannelResponseAdapter } from "./response-controller.js";

test("channel response controller edits progress into final reply and sends remaining chunks", async () => {
  const events: string[] = [];
  const controller = createChannelResponseController(createAdapter(events, ["final-1", "final-2"]));

  await controller.showProgress("working");
  await controller.replyFinal("final");

  assert.deepEqual(events, ["send:working", "edit:42:final-1", "send:final-2"]);
});

test("channel response controller sends final chunks when no progress message exists", async () => {
  const events: string[] = [];
  const controller = createChannelResponseController(createAdapter(events, ["a", "b"]));

  await controller.replyFinal("final");

  assert.deepEqual(events, ["send:a", "send:b"]);
});

test("channel response controller ignores no-op edit errors", async () => {
  const events: string[] = [];
  const controller = createChannelResponseController(createAdapter(events, ["same"], { noopEditText: "same" }));

  await controller.showProgress("same");
  await controller.replyFinal("same");

  assert.deepEqual(events, ["send:same", "edit:42:same"]);
});

function createAdapter(events: string[], chunks: string[], options: { noopEditText?: string } = {}): ChannelResponseAdapter {
  return {
    sendMessage: async (text) => {
      events.push(`send:${text}`);
      return { messageId: 42 };
    },
    editMessage: async (messageId, text) => {
      events.push(`edit:${messageId}:${text}`);
      if (text === options.noopEditText) {
        throw new Error("message is not modified");
      }
    },
    splitMessage: () => chunks,
    isNoopEditError: (error) => error instanceof Error && error.message.includes("message is not modified"),
  };
}