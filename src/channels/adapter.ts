import type { ChannelActivityControllerOptions } from "./activity.js";
import type { ChannelAttachmentPipelineResult } from "./attachment-pipeline.js";
import type { ChannelResponseAdapter } from "./response-controller.js";
import type { ChannelDescriptor } from "./registry.js";

export interface ChannelMessageRef<TChatId = unknown, TMessageId = unknown> {
  chatId: TChatId;
  messageId?: TMessageId;
}

export interface ChannelIncomingMessage<TChatId = unknown, TMessageId = unknown, TRaw = unknown> extends ChannelMessageRef<TChatId, TMessageId> {
  senderId: string;
  senderUsername?: string;
  text?: string;
  caption?: string;
  raw: TRaw;
}

export interface ChannelAttachmentAdapter<TAttachment = unknown> {
  getAttachment(message: ChannelIncomingMessage): TAttachment | undefined;
  processAttachment(attachment: TAttachment, message: ChannelIncomingMessage): Promise<ChannelAttachmentPipelineResult>;
}

export interface ChannelOutboundAdapter<TChatId = unknown, TAction extends string = string> {
  createResponseAdapter(chatId: TChatId): ChannelResponseAdapter;
  createActivityOptions(chatId: TChatId, action: TAction): ChannelActivityControllerOptions<TAction, TChatId>;
}

export interface ChannelRuntimeAdapter<TAttachment = unknown, TChatId = unknown, TAction extends string = string> {
  descriptor: ChannelDescriptor;
  attachments?: ChannelAttachmentAdapter<TAttachment>;
  outbound: ChannelOutboundAdapter<TChatId, TAction>;
}