# Channel Adapter Plan

Bestie channels should stay small transport adapters around shared runtime behavior. Telegram is the first real channel; this plan defines how to add future channels such as Zalo, WhatsApp, Discord, or web chat without copying Telegram internals.

## Current Contract

- `src/channels/registry.ts` owns channel descriptors: display name, config key, native commands, aliases, and capability flags.
- `src/channels/adapter.ts` owns the type-first runtime adapter contract.
- `src/channels/noop-adapter.test.ts` is the reference implementation for the contract without real transport code.
- Telegram remains the production example for long polling, owner checks, Bot API file lookup, upload APIs, and platform quirks.

## New Channel Checklist

1. Add a descriptor in `src/channels/registry.ts` before adding transport code.
2. Map raw platform events into `ChannelIncomingMessage` shape: `chatId`, optional `messageId`, `senderId`, text, caption, and raw payload.
3. Implement outbound response behavior with `createChannelResponseController` so progress and final replies behave consistently.
4. Implement activity behavior with `createChannelActivityController` only if the platform supports typing or action indicators.
5. Implement an attachment adapter only when the platform can expose files, media, or platform transcripts.
6. Reuse `processChannelAttachment` for validation, download, local persistence, preview parsing, vision gating, transcript shaping, retention, and prompt formatting.
7. Keep authentication, polling or webhook setup, upload formats, API retries, and platform-specific errors inside the channel transport.
8. Add focused tests for descriptor shape, inbound mapping, outbound replies, activity behavior, attachment metadata mapping, and platform transcript provenance.

## Attachment Rules

New channels should provide platform-specific callbacks to the shared pipeline instead of copying Telegram attachment logic:

- metadata mapping: kind, file id, file name, MIME type, size, and caption
- file lookup and download
- local path naming inputs
- platform-provided transcript text, when available
- channel-specific user-facing error messages

Shared channel modules should continue to own policy enforcement and LLM-facing formatting:

- `src/channels/attachments.ts`
- `src/channels/attachment-pipeline.ts`
- `src/channels/attachment-preview.ts`
- `src/channels/attachment-vision.ts`
- `src/channels/audio-transcription.ts`
- `src/channels/attachment-prompt.ts`

## Zalo And WhatsApp Notes

Do not add a real Zalo or WhatsApp runtime until the API constraints are clear:

- bot account type and approval requirements
- webhook versus polling support
- file download and upload limits
- voice/audio transcript availability
- message edit support for progress updates
- typing/activity support
- user identity format and owner allowlist strategy
- rate limits and retry semantics

If a platform provides ASR text with an audio message, store it as a platform transcript source rather than treating it as provider STT. Provider STT should remain the fallback when policy allows it and no usable platform transcript exists.

## Out Of Scope For This Step

- no real Zalo or WhatsApp transport
- no new channel config schema
- no new CLI command
- no hosted webhook service
- no installer changes
