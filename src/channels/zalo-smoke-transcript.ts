export interface ZaloSmokeTranscriptEvent {
  event: string;
  detail?: Record<string, unknown>;
}

export interface ZaloSmokeTranscriptSummary {
  updates: number;
  ownerUpdates: number;
  outboundMessages: number;
  replies: number;
  progressMessages: number;
  hasTyping: boolean;
  attachmentUpdates: number;
}

export function parseZaloSmokeTranscript(text: string): ZaloSmokeTranscriptEvent[] {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ZaloSmokeTranscriptEvent);
}

export function validateZaloSmokeTranscript(events: ZaloSmokeTranscriptEvent[]): ZaloSmokeTranscriptSummary {
  const eventNames = events.map((event) => event.event);
  requireEvent(eventNames, "zalo_get_updates_finish");

  const updateBatch = events.find((event) => event.event === "zalo_get_updates_finish");
  const updateCount = typeof updateBatch?.detail?.count === "number" ? updateBatch.detail.count : 0;

  if (updateCount < 1) {
    throw new Error("No Zalo updates were observed. Send a fresh owner message to the bot, then rerun the smoke.");
  }

  requireEvent(eventNames, "zalo_send_chat_action");
  requireEvent(eventNames, "zalo_send_message");

  const ownerUpdateCount = countOwnerUpdates(updateBatch);

  if (ownerUpdateCount < 1) {
    throw new Error("No owner Zalo updates were observed. Send a fresh message from the configured owner account, then rerun the smoke.");
  }

  const outbound = events.filter((event) => event.event === "zalo_send_message");
  const replies = outbound.filter(isReplyEvent).length;
  const progressMessages = outbound.filter(isToolProgressEvent);
  const attachmentUpdates = countAttachmentUpdates(updateBatch);

  if (replies < 1) {
    throw new Error("No Zalo reply was recorded. The owner message should produce a reply.");
  }

  if (progressMessages.length > 1) {
    throw new Error(`Expected at most one tool progress message, saw ${progressMessages.length}. Tool activity should not spam chat.`);
  }

  return {
    updates: updateCount,
    ownerUpdates: ownerUpdateCount,
    outboundMessages: outbound.length,
    replies,
    progressMessages: progressMessages.length,
    hasTyping: eventNames.includes("zalo_send_chat_action"),
    attachmentUpdates,
  };
}

function requireEvent(eventNames: string[], expected: string): void {
  if (!eventNames.includes(expected)) {
    throw new Error(`Expected transcript event ${expected}; saw ${eventNames.join(", ")}`);
  }
}

function isToolProgressEvent(event: ZaloSmokeTranscriptEvent): boolean {
  return event.detail?.kind === "tool_progress";
}

function isReplyEvent(event: ZaloSmokeTranscriptEvent): boolean {
  return event.detail?.kind === "reply";
}

function countOwnerUpdates(event: ZaloSmokeTranscriptEvent | undefined): number {
  const updates = event?.detail?.updates;

  if (!Array.isArray(updates)) {
    return 0;
  }

  return updates.filter((update) => isTranscriptUpdateSummary(update) && update.fromOwner).length;
}

function countAttachmentUpdates(event: ZaloSmokeTranscriptEvent | undefined): number {
  const updates = event?.detail?.updates;

  if (!Array.isArray(updates)) {
    return 0;
  }

  return updates.filter((update) => isTranscriptAttachmentUpdateSummary(update) && update.hasAttachment).length;
}

function isTranscriptUpdateSummary(value: unknown): value is { fromOwner: boolean } {
  return typeof value === "object" && value !== null && "fromOwner" in value && typeof (value as { fromOwner?: unknown }).fromOwner === "boolean";
}

function isTranscriptAttachmentUpdateSummary(value: unknown): value is { hasAttachment: boolean } {
  return typeof value === "object" && value !== null && "hasAttachment" in value && typeof (value as { hasAttachment?: unknown }).hasAttachment === "boolean";
}