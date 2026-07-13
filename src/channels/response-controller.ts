export interface ChannelSentMessage {
  messageId?: number;
}

export interface ChannelResponseAdapter {
  sendMessage(text: string): Promise<ChannelSentMessage | void>;
  editMessage(messageId: number, text: string): Promise<void>;
  splitMessage(text: string): string[];
  isNoopEditError(error: unknown): boolean;
}

export interface ChannelResponseController {
  showProgress(text: string): Promise<void>;
  replyFinal(text: string): Promise<void>;
}

export function createChannelResponseController(adapter: ChannelResponseAdapter): ChannelResponseController {
  let progressMessageId: number | undefined;

  return {
    showProgress: async (text) => {
      if (progressMessageId !== undefined) {
        await editMessageBestEffort(adapter, progressMessageId, text);
        return;
      }

      const sentMessage = await adapter.sendMessage(text);
      progressMessageId = sentMessage?.messageId;
    },
    replyFinal: async (text) => {
      const chunks = adapter.splitMessage(text);

      if (progressMessageId !== undefined) {
        const [firstChunk, ...remainingChunks] = chunks;
        await editMessageBestEffort(adapter, progressMessageId, firstChunk);
        for (const chunk of remainingChunks) {
          await adapter.sendMessage(chunk);
        }
        return;
      }

      for (const chunk of chunks) {
        await adapter.sendMessage(chunk);
      }
    },
  };
}

async function editMessageBestEffort(adapter: ChannelResponseAdapter, messageId: number, text: string): Promise<void> {
  try {
    await adapter.editMessage(messageId, text);
  } catch (error) {
    if (!adapter.isNoopEditError(error)) {
      throw error;
    }
  }
}