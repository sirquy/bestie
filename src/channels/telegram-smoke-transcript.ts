export interface TelegramSmokeTranscriptEvent {
  event: string;
  detail?: Record<string, unknown>;
}

export interface TelegramSmokeTranscriptSummary {
  updates: number;
  ownerUpdates: number;
  outboundMessages: number;
  replies: number;
  edits: number;
  progressMessages: number;
  progressEdits: number;
  hasTyping: boolean;
  attachmentUpdates: number;
  downloadedFiles: number;
  parsedAttachments: number;
  textPreviewAttachments: number;
  parseWarningAttachments: number;
  visionInputAttachments: number;
  audioTranscriptAttachments: number;
  transcriptionWarningAttachments: number;
}

export function parseTelegramSmokeTranscript(text: string): TelegramSmokeTranscriptEvent[] {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TelegramSmokeTranscriptEvent);
}

export function validateTelegramSmokeTranscript(events: TelegramSmokeTranscriptEvent[]): TelegramSmokeTranscriptSummary {
  const eventNames = events.map((event) => event.event);
  requireEvent(eventNames, "telegram_get_updates_finish");
  requireEvent(eventNames, "telegram_send_chat_action");
  requireEvent(eventNames, "telegram_send_message");

  const updateBatch = events.find((event) => event.event === "telegram_get_updates_finish");
  const updateCount = typeof updateBatch?.detail?.count === "number" ? updateBatch.detail.count : 0;

  if (updateCount < 1) {
    throw new Error("No Telegram updates were observed. Send a fresh owner message to the bot, then rerun the smoke.");
  }

  const ownerUpdateCount = countOwnerUpdates(updateBatch);

  if (ownerUpdateCount < 1) {
    throw new Error("No owner Telegram updates were observed. Send a fresh message from the configured owner account, then rerun the smoke.");
  }

  const outbound = events.filter((event) => event.event === "telegram_send_message");
  const edits = events.filter((event) => event.event === "telegram_edit_message_text");
  const replies = outbound.filter(isReplyEvent).length + edits.filter(isReplyEvent).length;
  const progressMessages = outbound.filter(isToolProgressEvent);
  const progressEdits = edits.filter(isToolProgressEvent);
  const attachmentUpdates = countAttachmentUpdates(updateBatch);
  const downloadedFiles = events.filter((event) => event.event === "telegram_download_file_finish").length;
  const parsedAttachmentEvents = events.filter((event) => event.event === "telegram_attachment_parse");
  const textPreviewAttachments = parsedAttachmentEvents.filter((event) => event.detail?.hasTextPreview === true).length;
  const parseWarningAttachments = parsedAttachmentEvents.filter((event) => event.detail?.hasParseWarning === true).length;
  const visionInputAttachments = parsedAttachmentEvents.filter((event) => event.detail?.hasVisionInput === true).length;
  const audioTranscriptAttachments = parsedAttachmentEvents.filter((event) => event.detail?.hasAudioTranscript === true).length;
  const transcriptionWarningAttachments = parsedAttachmentEvents.filter((event) => event.detail?.hasTranscriptionWarning === true).length;

  if (replies < 1) {
    throw new Error("No Telegram reply was recorded. The owner message should produce a reply or a final edited reply.");
  }

  if (progressMessages.length > 1) {
    throw new Error(`Expected at most one tool progress message, saw ${progressMessages.length}. Tool activity should edit one message instead of spamming chat.`);
  }

  if (progressMessages.length === 1 && edits.length < 1) {
    throw new Error("Tool activity was observed, but no message edits were recorded. The final reply should replace the activity message.");
  }

  return {
    updates: updateCount,
    ownerUpdates: ownerUpdateCount,
    outboundMessages: outbound.length,
    replies,
    edits: edits.length,
    progressMessages: progressMessages.length,
    progressEdits: progressEdits.length,
    hasTyping: eventNames.includes("telegram_send_chat_action"),
    attachmentUpdates,
    downloadedFiles,
    parsedAttachments: parsedAttachmentEvents.length,
    textPreviewAttachments,
    parseWarningAttachments,
    visionInputAttachments,
    audioTranscriptAttachments,
    transcriptionWarningAttachments,
  };
}

function requireEvent(eventNames: string[], expected: string): void {
  if (!eventNames.includes(expected)) {
    throw new Error(`Expected transcript event ${expected}; saw ${eventNames.join(", ")}`);
  }
}

function isToolProgressEvent(event: TelegramSmokeTranscriptEvent): boolean {
  return event.detail?.kind === "tool_progress";
}

function isReplyEvent(event: TelegramSmokeTranscriptEvent): boolean {
  return event.detail?.kind === "reply";
}

function countOwnerUpdates(event: TelegramSmokeTranscriptEvent | undefined): number {
  const updates = event?.detail?.updates;

  if (!Array.isArray(updates)) {
    return 0;
  }

  return updates.filter((update) => isTranscriptUpdateSummary(update) && update.fromOwner).length;
}

function countAttachmentUpdates(event: TelegramSmokeTranscriptEvent | undefined): number {
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
