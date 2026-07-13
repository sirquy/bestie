import assert from "node:assert/strict";
import test from "node:test";

import type { ChannelIncomingMessage, ChannelRuntimeAdapter } from "./adapter.js";
import { createChannelActivityController } from "./activity.js";
import { createChannelResponseController } from "./response-controller.js";
import type { ChannelDescriptor } from "./registry.js";

interface NoopAttachment {
  fileId: string;
}

const NOOP_CHANNEL: ChannelDescriptor = {
  id: "noop",
  displayName: "Noop",
  configKey: "noop",
  capabilities: {
    polling: false,
    attachments: true,
    voiceInput: false,
    voiceReply: false,
    toolActivity: true,
    approvals: false,
  },
  commands: [{ command: "help", description: "Show noop help" }],
};

test("noop adapter demonstrates the channel runtime adapter contract", async () => {
  const sentMessages: string[] = [];
  const chatActions: string[] = [];
  const incoming: ChannelIncomingMessage<number, string, { attachment?: NoopAttachment }> = {
    chatId: 1,
    messageId: "message-1",
    senderId: "owner",
    caption: "please inspect",
    raw: { attachment: { fileId: "file-1" } },
  };

  const adapter: ChannelRuntimeAdapter<NoopAttachment, number, "typing"> = {
    descriptor: NOOP_CHANNEL,
    attachments: {
      getAttachment: (message) => (message.raw as { attachment?: NoopAttachment }).attachment,
      processAttachment: async (attachment, message) => ({
        localPath: `/noop/${attachment.fileId}`,
        localPathRetained: true,
        bytes: 4,
        textPreview: message.caption,
        contentParser: "text",
      }),
    },
    outbound: {
      createResponseAdapter: () => ({
        sendMessage: async (text) => {
          sentMessages.push(text);
          return { messageId: sentMessages.length };
        },
        editMessage: async (_messageId, text) => {
          sentMessages.push(`edit:${text}`);
        },
        splitMessage: (text) => [text],
        isNoopEditError: () => false,
      }),
      createActivityOptions: (chatId, action) => ({
        client: {
          sendChatAction: async (targetChatId, targetAction) => {
            chatActions.push(`${targetChatId}:${targetAction}`);
          },
        },
        chatId,
        action,
        refreshMs: 1_000,
      }),
    },
  };

  const attachment = adapter.attachments?.getAttachment(incoming);
  assert.deepEqual(attachment, { fileId: "file-1" });

  const processed = await adapter.attachments!.processAttachment(attachment!, incoming);
  assert.deepEqual(processed, { localPath: "/noop/file-1", localPathRetained: true, bytes: 4, textPreview: "please inspect", contentParser: "text" });

  const activity = createChannelActivityController(adapter.outbound.createActivityOptions(incoming.chatId, "typing"));
  activity.start();
  await activity.pulse();
  activity.stop();

  const response = createChannelResponseController(adapter.outbound.createResponseAdapter(incoming.chatId));
  await response.showProgress("working");
  await response.replyFinal("done");

  assert.deepEqual(chatActions, ["1:typing"]);
  assert.deepEqual(sentMessages, ["working", "edit:done"]);
});