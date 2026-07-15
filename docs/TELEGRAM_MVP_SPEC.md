# Telegram MVP Spec

## Purpose

Telegram is the first real chat channel after terminal chat. The MVP should prove that the existing character, LLM, logging, Doctor, and local memory foundations work outside the terminal without adding hosted infrastructure.

## Scope

Current implementation status: config schema, setup command, enabled-only Doctor checks, owner-only update handler, grammY-backed Telegram client, polling loop with capped exponential backoff and recovery logging, LLM-backed owner text replies, formatted Telegram replies, MVP slash commands, native command registration, typing keepalive, basic owner attachment download into the local workspace with caption, metadata, and text-like preview forwarding, Telegram conversation persistence, memory controls, Doctor summary rendering, edited tool activity progress, explicit Telegram read-tool permission policy, pending approval request storage, approval decision recording without action execution, and redacted transcript smoke validation exist. Opt-in real-bot smoke with a fresh owner message has passed for local development.

Build a local polling bot that runs from the CLI:

```bash
bestie channels telegram
bestie channels telegram setup
bestie channels telegram whoami
bestie channels telegram voice setup-local
bestie channels telegram voice models
bestie channels telegram voice download-model small --confirm --use
bestie channels telegram --once --transcript .bestie/logs/telegram-smoke.jsonl
```

In scope:

- Telegram long polling only.
- Telegram Bot API calls should go through `grammy` with official `@grammyjs/types` shapes instead of hand-rolled endpoint payloads.
- Owner-only access by configured Telegram user id.
- Text messages and simple slash commands.
- Telegram-formatted assistant replies for common Markdown output.
- Long assistant replies should be split into Telegram-safe chunks before send/edit calls.
- Typing indicator while processing owner messages.
- Tool activity should use one progress message edited via `editMessageText`; the final answer should replace that same message instead of sending a second message that leaves progress clutter in the conversation.
- Tool activity text should be user-facing Vietnamese descriptions such as `Miu đang xem danh sách tệp trong src/cli`, `Miu đang tìm tệp khớp *.md trong docs`, or `Miu đang gom tài liệu Markdown từ src`, not raw tool names such as `internal.list_files src/cli`.
- If the final answer is too long to edit into the progress message, edit the progress message with the first safe chunk and send the remaining chunks as follow-up messages.
- If the model accidentally adds prose before a supported tool JSON object, the runtime should still execute the tool request instead of sending the raw JSON to Telegram.
- Basic owner attachment handling: save supported Telegram file objects under `.bestie/workspace/telegram/...`, forward caption, metadata, local path, and a bounded preview for text, PDF, and DOCX files to the model, and treat uploaded content as untrusted. Full saved files may be read later through existing local read tools; other binary/media contents are not interpreted by the Telegram layer.
- Native Telegram slash command registration at bot startup.
- Shared prompt, LLM provider, memory, and logging behavior from terminal chat.
- Model-requested memory writes use `internal.remember_memory` and are stored, queued, or denied according to `memory.writePolicy`; Telegram should not rely on language-specific remember-request keyword detection.
- When `memory.writePolicy` is `ask`, Telegram sends an inline Approve/Deny prompt for the pending memory; Approve stores it immediately and Deny rejects it.
- Model-requested memory lookup uses `internal.search_memories` so Telegram turns can answer from approved active memories without channel-level keyword matching.
- Redacted operational logs.
- Doctor checks for Telegram config when enabled.
- Doctor can verify Telegram bot identity with an explicit `bestie doctor --telegram-connect` network check.
- Permission-gated read-only internal tools may run from Telegram turns and report progress through one edited activity message.
- Missing internal read-tool paths for file read, multi-file read, list, search, and Markdown bundle tools should be returned to the model as structured tool failures, not surfaced to Telegram as raw `ENOENT` errors; file-missing results should include guidance to recover with nearby `internal.list_files` or `internal.search_files` when another tool call is useful.
- Approval-required actions produce a redacted Telegram prompt, create a short-lived local pending approval request, and are denied until a later flow can safely execute approved actions.

Out of scope for MVP:

- Webhooks.
- Hosted/SaaS deployment.
- systemd service setup.
- Multi-user groups.
- Inline keyboards beyond approval prompts, sticker/voice/image/file content understanding beyond local download and metadata, payments, or public bot discovery.
- Public/external/write/destructive tools or unclassified MCP actions. Classified read-only internal/MCP tools are implemented for local development behind the permission gate.

## Config

Telegram config stays non-secret in `.bestie/config.json`:

```json
"transcription": {
  "provider": "openai-compatible",
  "baseUrl": "https://api.openai.com/v1",
  "model": "whisper-1",
  "apiKeyEnv": "BESTIE_TRANSCRIPTION_API_KEY",
  "timeoutMs": 60000
},
"channels": {
  "telegram": {
    "enabled": false,
    "botTokenEnv": "BESTIE_TELEGRAM_BOT_TOKEN",
    "ownerUserId": "",
    "attachments": {
      "downloadPolicy": "allow",
      "maxBytes": 20971520,
      "previewMaxBytes": 16384,
      "parseMaxBytes": 5242880,
      "visionPolicy": "deny",
      "visionMaxBytes": 4194304,
      "transcriptionPolicy": "deny",
      "transcriptionMaxBytes": 10485760,
      "deleteAfterProcessingKinds": [],
      "allowedMimeTypes": ["text/*", "application/json"]
    }
  }
}
```

The bot token is stored only in `.bestie/.env`:

```bash
BESTIE_TELEGRAM_BOT_TOKEN=
BESTIE_TRANSCRIPTION_API_KEY=
```

Local transcription is also supported by replacing the top-level `transcription` block with a local command provider. The command is executed without a shell, `{audioPath}` is replaced with the downloaded Telegram audio path, `{modelPath}` is replaced with the configured model path, and stdout is treated as the transcript.

For the current local Vietnamese voice runbook, see [Telegram Voice Local Mode](TELEGRAM_VOICE_LOCAL_MODE.md).

```json
"transcription": {
  "provider": "local-whisper",
  "command": "whisper-cli",
  "args": ["-m", "{modelPath}", "-f", "{audioPath}", "-nt"],
  "modelPath": ".bestie/models/ggml-small.bin",
  "timeoutMs": 120000
}
```

Rules:

- Never print or log the bot token.
- `attachments` is optional. Defaults are `downloadPolicy: allow`, `maxBytes: 20971520`, `previewMaxBytes: 16384`, `parseMaxBytes: 5242880`, `visionPolicy: deny`, `visionMaxBytes: 4194304`, `transcriptionPolicy: deny`, `transcriptionMaxBytes: 10485760`, and no MIME allowlist. Set `downloadPolicy` to `deny` to disable attachment downloads, set `allowedMimeTypes` to restrict saved attachment types, lower `parseMaxBytes` to skip expensive text extraction for larger files, set `visionPolicy` to `allow` only when the configured model/provider supports image inputs, or set `transcriptionPolicy` to `allow` only when a top-level `transcription` provider is configured. OpenAI-compatible transcription requires `BESTIE_TRANSCRIPTION_API_KEY`; local-whisper requires the local binary and model file.
- Set `deleteAfterProcessingKinds` to kinds such as `["voice", "audio"]` to remove downloaded attachment files after parsing/transcription/vision processing completes. The model still receives available previews/transcripts, but the prompt will not advertise a retained local path for deleted files.
- Use `bestie tools attachments cleanup --older-than 7d --kinds voice,audio` to preview old Telegram attachment cleanup, then add `--confirm` to delete matched files. This covers older files that predate retention policy changes.
- Text, PDF, and DOCX attachments get bounded text previews when they are within `parseMaxBytes`. Photos, image documents, and static image stickers are attached to the model only when `visionPolicy` is `allow` and the saved bytes are within `visionMaxBytes`. Voice/audio attachments get bounded transcripts only when `transcriptionPolicy` is `allow`, a transcriber is configured, and the saved bytes are within `transcriptionMaxBytes`. Other downloaded files are saved locally and described to the agent as untrusted external content.
- Voice replies are opt-in with `channels.telegram.voiceReplyPolicy: "voice-input-only"` plus a top-level `speech` provider. ElevenLabs via `@elevenlabs/elevenlabs-js` is the default recommended provider; OpenAI-compatible local speech remains supported for local development. The bot sends the text reply first, then converts generated speech to Telegram voice-note Ogg/Opus and sends it with `sendVoice` for voice/audio inputs. Speech logs and smoke transcript events record only metadata such as byte counts and MIME types, not raw reply text or audio bytes.

```json
"speech": {
  "provider": "elevenlabs",
  "apiKeyEnv": "ELEVENLABS_API_KEY",
  "voiceId": "NOpBlnGInO9m6vDvFkFC",
  "modelId": "eleven_v3",
  "languageCode": "en",
  "outputFormat": "mp3_44100_128",
  "timeoutMs": 60000
}
```
- Prefer `bestie channels telegram setup` for local setup; manual config edits are still supported.
- Do not require Telegram config for terminal-only users.
- If `channels.telegram.enabled` is false or missing, `bestie channels telegram` should explain how to enable it.
- `ownerUserId` must be required before the bot replies to messages. Despite the legacy key name, the value may be a numeric Telegram id, username, or `@username`; matching is case-insensitive for usernames.
- During `bestie channels telegram setup`, leaving the owner prompt blank should detect the owner from the latest user message sent to the bot, ask for confirmation, and save the detected username when available. `bestie channels telegram whoami` exposes the same lookup as a standalone helper.

## Runtime Flow

```text
bestie channels telegram
  -> load config and env
  -> require Telegram bot token and owner id or username
  -> start getUpdates polling loop
  -> ignore messages from non-owner users
  -> map owner text into a shared chat turn
  -> call configured LLM provider
  -> send assistant text with sendMessage, or edit the activity message when tool progress was shown
  -> log redacted channel event
```

The adapter should stay thin. Shared behavior belongs in runtime/chat services so terminal and Telegram do not drift.

Channel-facing metadata belongs in the shared channel registry rather than in handler-local constants. Telegram is the first descriptor-backed channel; future Zalo, WhatsApp, or similar channels should add descriptors for display name, config key, native commands, aliases, and capability flags before adding transport code. Transport-specific handlers may still own API details such as polling, message IDs, or upload formats.

Attachment handling is adapter-driven on top of shared channel primitives. Telegram maps Bot API attachment metadata into the shared pipeline, but reusable behavior lives outside the Telegram handler:

- `src/channels/attachments.ts` owns attachment kinds, structured handling errors, MIME/size validation, download byte retrieval, path naming, private file persistence, and retention cleanup.
- `src/channels/attachment-pipeline.ts` owns the thin orchestration order: validate, download, build local path, persist, preview, vision, transcript, retain.
- `src/channels/attachment-preview.ts` wraps bounded text/PDF/DOCX preview extraction.
- `src/channels/attachment-vision.ts` builds opt-in image data URLs when the policy and byte budget allow it.
- `src/channels/audio-transcription.ts` normalizes, truncates, and labels provider, platform, or fallback audio transcripts.
- `src/channels/attachment-prompt.ts` formats the LLM-facing attachment prompt with channel display name, preview, transcript provenance, and retained-file guidance.

Future Zalo, WhatsApp, or similar channels should avoid copying Telegram attachment logic. A new channel should provide transport adapters for metadata mapping, file lookup/download, platform-provided transcript text when available, and channel-specific user-facing error messages; the shared pipeline should continue to own validation, byte limits, local persistence, preview parsing, vision gating, transcript shaping, retention, and prompt formatting.

Channel adapter contracts should stay explicit and type-first. `src/channels/adapter.ts` defines the shared shape for future channel runtimes: a `ChannelRuntimeAdapter` combines the channel descriptor, optional attachment adapter, and outbound adapter. Attachment adapters map raw transport messages into `processChannelAttachment` results. Outbound adapters provide response-controller and activity-controller options. This contract is intentionally small; channel implementations should still own transport authentication, polling/webhook mechanics, and raw API quirks.

## Commands

Telegram MVP should support:

- `/start` - brief owner-only readiness reply.
- `/help` - list supported commands.
- `/status` - short local status summary, no secrets.
- `/doctor` - concise Doctor summary using `doctor --json` equivalent data.
- `/memory` or `/memory list` - show memory status or a short recent-memory summary.
- `/memory pending` - show a short pending-memory review queue.
- `/memory pending inspect <id>` - show one pending memory with CLI approve/reject next steps.
- `/memory pause` and `/memory resume` - reuse local memory pause behavior. Legacy `/pause_memory`, `/resume_memory`, `/pause-memory`, and `/resume-memory` aliases are accepted for typed messages, but native Telegram command registration only exposes `/memory` so the command list stays compact.
- `/approvals` - list pending action approval requests.
- `/approve <id>` and `/deny <id>` - record the owner decision only; no action is executed in this foundation slice.

Unknown slash commands should return a short fallback instead of calling the LLM.

## Error Handling

- Provider failures should be sent back as concise user-facing messages.
- Unexpected runtime chat errors should be summarized in Telegram with a safe generic message; detailed error text belongs only in redacted local logs.
- Telegram API errors should be logged redacted and retried only when safe.
- Rate limits should back off instead of spinning.
- Long-running polling logs transient `getUpdates` failures with consecutive failure counts, uses capped exponential backoff, logs recovery, and retries; `--once` still fails fast for smoke/debug use.
- Polling offset must advance only after updates are handled or safely ignored.
- The process should exit cleanly on `SIGINT` and `SIGTERM`.
- `--transcript <path>` should write redacted JSONL smoke evidence for Telegram polling events, update counts, attachment metadata/download events, typing actions, progress message edits, and replies without raw chat text, raw file names, raw Telegram file ids/paths, chat ids, owner ids, bot tokens, or provider secrets.

## Doctor Checks

Doctor should remain useful before the bot starts:

- Telegram config exists when enabled.
- Bot token env name is present and secret value exists.
- Owner id or username is configured.
- `bestie doctor --telegram-connect` calls Telegram `getMe` through grammY and reports the reachable bot identity without printing the token.
- Terminal-only configs should not fail Telegram checks.

## Acceptance Checks

Minimum local checks before considering Telegram MVP done:

```bash
npm test
npm run smoke
npm run smoke:telegram
npm run smoke:telegram:setup
```

Add Telegram unit tests for:

- non-owner messages are ignored.
- owner text produces one LLM call and one Telegram reply.
- `/doctor` uses structured Doctor report data.
- repeated polling failures back off and reset after recovery.
- Telegram approval foundation creates pending approval records, prompts the owner, and records `/approve` or `/deny` decisions without executing actions.
- prose-plus-tool JSON model replies execute the supported tool request and do not leak raw tool JSON into chat.
- long final replies after tool activity are split before `editMessageText` to avoid Telegram `MESSAGE_TOO_LONG` failures.
- token, provider secrets, raw Telegram file ids/paths, raw uploaded file names, and uploaded file contents are not printed or logged.

Manual smoke with a real bot token is opt-in and must never commit `.env` changes. This is the remaining readiness gate before treating Telegram MVP as done.

Manual real-bot smoke:

```bash
npm run build
npm run smoke
npm run smoke:doctor:exit-code
npm run smoke:doctor:fix
npm run dev -- telegram --once
npm run dev -- telegram
```

From the configured owner account, send `/start`, `/help`, `/status`, `/doctor`, `/memory`, `/memory pending`, `/memory pending inspect <id>` when a pending memory exists, `/memory pause`, `/memory resume`, and one normal text message with Markdown-like formatting in the reply. Send a repo-reading message such as `đọc docs repo rồi summary` when validating tool progress. Send a small `.txt`, `.pdf`, or `.docx` attachment with a short caption when validating attachment download and preview. From a different Telegram account, send any message and confirm the bot ignores it.

Redacted transcript smoke:

```bash
npm run build
npm run smoke:doctor:json
# Send a fresh owner message that should trigger tools, for example: "đọc docs repo rồi summary", then run:
BESTIE_TELEGRAM_REAL_SMOKE=1 npm run smoke:telegram:real
```

Expected result: the script observes at least one update, a typing action, and an outbound Telegram message, then writes `.bestie/logs/telegram-smoke.jsonl`. If tool activity appears, the quality gate requires at most one `telegram_send_message` with `kind: "tool_progress"` and at least one `telegram_edit_message_text` so progress and final reply replace the same message instead of spamming the chat. If an attachment is sent, the transcript records redacted `telegram_get_file_*`, `telegram_download_file_*`, and `telegram_attachment_parse` events with hashed file identifiers, byte counts, parser type, preview booleans, warning booleans, a vision-input boolean, audio-transcript booleans, and transcription-warning booleans only. The transcript records event names, hashed chat identifiers, text/caption lengths, owner-match booleans, attachment kind, byte counts, and tool-progress labels only. It must not include raw message text, owner ids, chat ids, bot token values, raw file ids/paths, raw uploaded file names or contents, extracted file text, audio transcript text, image data URLs, LLM API keys, or full assistant replies.

The real-smoke script deletes stale transcript output before running, requires at least one update from the configured owner, requires a reply or final edited reply, and reports owner update and reply counts in its summary.
