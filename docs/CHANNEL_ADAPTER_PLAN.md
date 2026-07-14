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

## Zalo Notes

Zalo Bot Platform constraints are now grounded from `https://bot.zapps.me/docs`:

- API calls use `https://bot-api.zaloplatforms.com/bot<BOT_TOKEN>/<functionName>`.
- Bot Token is a long-lived secret until reset; keep it in `.bestie/.env` only.
- `getUpdates` long polling is POST-based and intended for local/dev polling; it is mutually exclusive with webhook mode.
- Webhook mode requires HTTPS and validates `X-Bot-Api-Secret-Token`; it is a later production slice, not part of initial local polling.
- Zalo user and chat ids are strings; do not assume Telegram-style numeric ids.
- `sendMessage` accepts text from 1 to 2000 characters, so outbound replies must chunk at 2000 characters.
- `sendChatAction` supports typing activity and can back shared progress indicators.
- `sendVoice` requires a public `.aac` URL and only supports 1-1 chats, so voice reply is out of the initial text polling slice.

Initial Zalo support is intentionally text-only local polling:

- descriptor capability: polling and tool activity enabled; attachments, voice input, and voice reply disabled
- config key: `channels.zalo` with `enabled`, `botTokenEnv`, `ownerUserId`, and optional `pollingTimeoutSeconds`
- CLI setup: `bestie zalo setup` writes `BESTIE_ZALO_BOT_TOKEN` and owner allowlist config
- CLI polling: `bestie zalo --once` runs one local polling pass

## WhatsApp Notes

Do not add a real WhatsApp runtime until the API constraints are clear:

- bot account type and approval requirements
- webhook versus polling support
- file download and upload limits
- voice/audio transcript availability
- message edit support for progress updates
- typing/activity support
- user identity format and owner allowlist strategy
- rate limits and retry semantics

If a platform provides ASR text with an audio message, store it as a platform transcript source rather than treating it as provider STT. Provider STT should remain the fallback when policy allows it and no usable platform transcript exists.

## Out Of Scope For The Initial Zalo Step

- no Zalo webhook server or hosted callback setup
- no Zalo attachment download/pipeline support
- no Zalo voice reply upload/public URL support
- no installer changes
- no WhatsApp transport
