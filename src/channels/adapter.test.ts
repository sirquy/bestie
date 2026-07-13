import assert from "node:assert/strict";
import test from "node:test";

import type { ChannelRuntimeAdapter } from "./adapter.js";
import { TELEGRAM_CHANNEL } from "./registry.js";

test("ChannelRuntimeAdapter describes the shared channel contract shape", () => {
  const adapter: ChannelRuntimeAdapter<{ fileId: string }, number, "typing"> = {
    descriptor: TELEGRAM_CHANNEL,
    attachments: {
      getAttachment: () => ({ fileId: "file-1" }),
      processAttachment: async () => ({ localPath: "/tmp/file", localPathRetained: true, bytes: 1 }),
    },
    outbound: {
      createResponseAdapter: () => ({
        sendMessage: async () => ({ messageId: 1 }),
        editMessage: async () => {},
        splitMessage: (text) => [text],
        isNoopEditError: () => false,
      }),
      createActivityOptions: (chatId, action) => ({
        client: { sendChatAction: async () => {} },
        chatId,
        action,
        refreshMs: 1_000,
      }),
    },
  };

  assert.equal(adapter.descriptor.id, "telegram");
  assert.deepEqual(adapter.attachments?.getAttachment({ chatId: 1, senderId: "owner", raw: {} }), { fileId: "file-1" });
});