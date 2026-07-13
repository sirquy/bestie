# Telegram Voice Local Mode

This runbook captures the local Telegram voice setup used for Vietnamese-first development. It keeps transcription private/local, avoids retaining raw voice files, and gives Doctor enough checks to catch common setup drift.

## Goal

- Telegram voice messages are downloaded locally.
- Ogg/Opus Telegram voice files are converted to WAV by a local wrapper.
- `whisper.cpp` transcribes the WAV with a multilingual model.
- The agent receives only the bounded transcript and metadata.
- Raw voice/audio files are deleted after processing.
- `bestie doctor` catches missing binary/model/ffmpeg and storage growth.

## Local Files

Expected local-only assets:

```text
.bestie/tools/whisper-bin/whisper-cli
.bestie/tools/local-whisper-transcribe.sh
.bestie/models/ggml-small.bin
```

The wrapper should accept model path and audio path as its first two arguments, convert Telegram Ogg/Opus to WAV, and print transcript text to stdout:

```bash
#!/usr/bin/env bash
set -euo pipefail

model_path="$1"
audio_path="$2"
shift 2

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
whisper_cli="$repo_root/.bestie/tools/whisper-bin/whisper-cli"
tmp_wav="$(mktemp --suffix=.wav)"

cleanup() {
  rm -f "$tmp_wav"
}
trap cleanup EXIT

ffmpeg -hide_banner -loglevel error -y -i "$audio_path" -ar 16000 -ac 1 -c:a pcm_s16le "$tmp_wav"
"$whisper_cli" -m "$model_path" -f "$tmp_wav" -np -nt "$@"
```

Make it executable:

```bash
chmod +x .bestie/tools/local-whisper-transcribe.sh
```

## Config Preset

If the local files above already exist, configure this mode automatically:

```bash
npm run start -- telegram voice setup-local
```

The command validates `.bestie/tools/whisper-bin/whisper-cli`, `.bestie/models/ggml-small.bin`, and `ffmpeg`, writes the wrapper, and merges the transcription/attachment config below without storing secrets.

List local whisper.cpp models and the currently configured model:

```bash
npm run start -- telegram voice models
```

Preview a controlled model download:

```bash
npm run start -- telegram voice download-model small
```

Download and switch the local transcription config to that model:

```bash
npm run start -- telegram voice download-model small --confirm --use
```

Supported names are `tiny`, `small`, `medium`, and `large-v3-turbo`. Existing files are not overwritten unless `--force` is provided.

Use this non-secret config shape in `.bestie/config.json`:

```json
{
  "transcription": {
    "provider": "local-whisper",
    "command": ".bestie/tools/local-whisper-transcribe.sh",
    "args": ["{modelPath}", "{audioPath}", "-l", "vi"],
    "modelPath": ".bestie/models/ggml-small.bin",
    "timeoutMs": 120000
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "botTokenEnv": "BESTIE_TELEGRAM_BOT_TOKEN",
      "ownerUserId": "<telegram-owner-id>",
      "attachments": {
        "downloadPolicy": "allow",
        "maxBytes": 20971520,
        "previewMaxBytes": 16384,
        "parseMaxBytes": 5242880,
        "visionPolicy": "deny",
        "visionMaxBytes": 4194304,
        "transcriptionPolicy": "allow",
        "transcriptionMaxBytes": 10485760,
        "deleteAfterProcessingKinds": ["voice", "audio"],
        "allowedMimeTypes": ["text/*", "application/json", "image/*", "video/*", "audio/*", "sticker/*", "application/pdf", "application/zip"]
      }
    }
  }
}
```

Notes:

- The `-l` argument is derived from `agent.language`: `vi` uses `-l vi`, `en` uses `-l en`, and `mixed` uses `-l auto`. This matters because letting `whisper-cli` default to English can make Vietnamese voice messages transcribe as English-sounding nonsense.
- `ggml-small.bin` is a practical local baseline for Vietnamese. `ggml-tiny.bin` is faster but commonly too inaccurate for Vietnamese voice chat.
- `deleteAfterProcessingKinds` removes raw Telegram voice/audio files after transcription, while still letting the agent use the transcript.
- Keep bot tokens in `.bestie/.env`, never in `.bestie/config.json`.

## Verification

Run Doctor:

```bash
npm run start -- doctor
```

Expected checks include:

```text
OK Local transcription command: ...local-whisper-transcribe.sh
OK Local transcription model: ...ggml-small.bin (... MiB)
OK Local transcription ffmpeg: .../ffmpeg
OK Local transcription model quality: Local transcription model choice does not look like the tiny model.
```

Run a real Telegram smoke transcript when debugging:

```bash
npm run start -- telegram --once --transcript .bestie/logs/telegram-local-voice-smoke.jsonl
```

Send a short Vietnamese voice message from the configured owner account. The transcript file must not contain raw message text, transcript text, file ids, file paths, owner ids, chat ids, or token values. It should only record metadata booleans such as `hasAudioTranscript`.

## Cleanup

Preview retained old voice/audio files:

```bash
npm run start -- tools attachments cleanup --older-than 7d --kinds voice,audio
```

Delete matched files:

```bash
npm run start -- tools attachments cleanup --older-than 7d --kinds voice,audio --confirm
```

For immediate local cleanup during testing, use `--older-than 0s`.

Doctor warns when retained Telegram attachments exceed the storage threshold and points back to this cleanup flow.

## Known Tradeoffs

- This is a pragmatic local wrapper, not the final product architecture.
- CPU transcription with `ggml-small.bin` can take tens of seconds for short voice messages.
- The wrapper depends on `ffmpeg` being available on `PATH`.
- Larger models can improve Vietnamese accuracy but increase disk, RAM, and latency.
- The raw voice file is intentionally deleted after processing; debugging transcription quality later requires a fresh sample.
