# Config Spec

This file describes the current local runtime config plus a few future packaging targets. The shipped CLI currently uses `~/.bestie/` by default through `getRuntimePaths(rootDir = homedir())`.

## Paths

Config:

```text
~/.bestie/config.json
```

Secrets:

```text
~/.bestie/.env
```

Data:

```text
~/.bestie/data/
```

Logs:

```text
~/.bestie/logs/
```

Installed skills:

```text
~/.bestie/skills/<skill-name>/SKILL.md
```

## config.json

Phase Now config started with non-secret `agent` and `llm` fields. The current local build also supports optional `transcription`, `speech`, `memory.writePolicy`, `workspace`, `internalTools`, `channels`, and `mcp` fields as features are enabled.

```json
{
  "version": 1,
  "agent": {
    "name": "Bestie",
    "ownerName": "Owner",
    "language": "vi",
    "timeZone": "Asia/Ho_Chi_Minh",
    "toneIntensity": 7,
    "emojiLevel": "light"
  },
  "llm": {
    "provider": "openai-compatible",
    "baseUrl": "https://api.openai.com/v1",
    "model": "provider-model-name",
    "apiKeyEnv": "OPENAI_API_KEY",
    "timeoutMs": 60000,
    "maxRetries": 1,
    "retryDelayMs": 500
  },
  "transcription": {
    "provider": "openai-compatible",
    "baseUrl": "https://api.openai.com/v1",
    "model": "whisper-1",
    "apiKeyEnv": "BESTIE_TRANSCRIPTION_API_KEY",
    "timeoutMs": 60000
  },
  "memory": {
    "provider": "sqlite",
    "writePolicy": "ask",
    "sqlitePath": "~/.bestie/data/memory.sqlite",
    "zepEnabled": false,
    "zepApiKeyEnv": "ZEP_API_KEY"
  },
  "workspace": {
    "defaultPath": "~/.bestie/workspace",
    "externalPaths": []
  },
  "internalTools": {
    "policies": {
      "internal.write_file": "ask",
      "internal.edit_file": "ask",
      "internal.apply_patch": "ask",
      "internal.exec": "ask",
      "internal.list_processes": "allow",
      "internal.read_url": "ask"
    },
    "exec": {
      "timeoutMs": 120000
    }
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
    },
    "zalo": {
      "enabled": false,
      "botTokenEnv": "BESTIE_ZALO_BOT_TOKEN",
      "ownerUserId": "",
      "pollingTimeoutSeconds": 25
    }
  },
  "mcp": {
    "servers": [
      {
        "name": "local-files",
        "enabled": false,
        "transport": "stdio",
        "command": "node",
        "args": ["server.js"],
        "env": {
          "MCP_LOG_LEVEL": "warn"
        },
        "tools": [
          { "name": "read_file", "category": "read" }
        ]
      }
    ]
  },
  "security": {
    "ownerOnly": true,
    "confirmExternalActions": true,
    "telemetry": "off"
  }
}
```

For local audio transcription, replace the `transcription` block with a `local-whisper` provider. The command is executed directly without a shell; `args` must include `{audioPath}` and may include `{modelPath}`. The command should print the transcript to stdout.

For ElevenLabs audio transcription, use an `elevenlabs` provider. `languageCode` is optional; when omitted, Bestie derives the language from `agent.language`, and `mixed` or `auto` lets ElevenLabs auto-detect.

```json
{
  "transcription": {
    "provider": "elevenlabs",
    "apiKeyEnv": "ELEVENLABS_API_KEY",
    "modelId": "scribe_v2",
    "languageCode": "vi",
    "tagAudioEvents": true,
    "diarize": false,
    "timeoutMs": 120000
  }
}
```

Telegram attachments are kept by default. Set `channels.telegram.attachments.deleteAfterProcessingKinds` to attachment kinds such as `["voice", "audio"]` to remove downloaded files after parsing/transcription/vision processing completes. This is useful for voice-heavy Telegram use where transcripts are enough and retaining raw audio would grow disk usage quickly.

```json
{
  "transcription": {
    "provider": "local-whisper",
    "command": "whisper-cli",
    "args": ["-m", "{modelPath}", "-f", "{audioPath}", "-nt"],
    "modelPath": "~/.bestie/models/ggml-small.bin",
    "timeoutMs": 120000
  }
}
```

Remote HTTP MCP servers use `transport: "http"`, `url`, and optional headers. Sensitive header values must be mapped from environment variables through `headersEnv`; do not store raw API keys or tokens in `config.json`.

```json
{
  "mcp": {
    "servers": [
      {
        "name": "composio",
        "enabled": true,
        "transport": "http",
        "url": "https://connect.composio.dev/mcp",
        "headersEnv": {
          "x-consumer-api-key": "COMPOSIO_CONSUMER_API_KEY"
        },
        "tools": [
          { "name": "tool_name_from_tools_list", "category": "read" }
        ]
      }
    ]
  }
}
```

For compatibility with common MCP config snippets, a top-level `mcpServers` object is also accepted and normalized to `mcp.servers`. Use `headersEnv` here too:

```json
{
  "mcpServers": {
    "composio": {
      "url": "https://connect.composio.dev/mcp",
      "headersEnv": {
        "x-consumer-api-key": "COMPOSIO_CONSUMER_API_KEY"
      }
    }
  }
}
```

## .env

Onboarding writes the LLM API key. Channel, speech, transcription, and MCP secrets are added only when those features are configured.

```bash
OPENAI_API_KEY=
BESTIE_TELEGRAM_BOT_TOKEN=
BESTIE_ZALO_BOT_TOKEN=
ELEVENLABS_API_KEY=
COMPOSIO_CONSUMER_API_KEY=
```

Secrets must not be printed after entry and must be redacted from logs.

Telegram voice setup commands follow the same rule. `bestie channels telegram voice setup-elevenlabs` prompts for `ELEVENLABS_API_KEY` and writes the secret only to `.bestie/.env`; `.bestie/config.json` stores the env var name plus non-secret voice/model IDs. `bestie channels telegram voice setup-local`, `models`, and `download-model` should print only local paths, model names, sizes, and status details.

Set `BESTIE_NO_BANNER=1` to suppress the decorative CLI banner for human-facing commands in scripts. Set `BESTIE_BANNER=static` to disable the interactive animation while keeping the static banner. Machine-readable JSON outputs such as `bestie doctor --json`, `bestie channels doctor --json`, and `bestie memory export` suppress the banner automatically.

Set `NO_COLOR=1` to disable ANSI colors in human-facing tables, badges, and progress indicators. Commands that emit raw data, logs, git output, transcripts, or JSON payloads should remain script-friendly and avoid decorative formatting.

`memory.writePolicy` controls model-requested memory writes through `internal.remember_memory`: `allow` stores non-secret allowed memories, `ask` queues them as pending approval and asks the owner to approve or deny in supported channels, and `deny` rejects writes. Onboarding writes this field and defaults it to `ask`; older configs that omit it still behave as `ask` at runtime.

`workspace.defaultPath` controls where relative write/edit/exec paths land. It defaults to `~/.bestie/workspace` so ad hoc agent-created files do not pollute the project root. Generic `list_files` and `search_files` requests for `.` also inspect this workspace by default. Explicit project paths such as `src`, `docs`, `README.md`, or the absolute project root still inspect the repository so the agent can review code when asked. `workspace.externalPaths` is an explicit allowlist for absolute paths outside the project root and agent workspace; without it, internal file tools reject external paths. Git read tools also accept explicit `path` or `repoPath` values when they resolve through this workspace allowlist.

`internalTools.policies` controls individual built-in tools with `allow`, `ask`, or `deny`. Local read tools default to `allow`; web reads, writes, patches, and exec tools default to `ask`. Supported policy keys include `internal.read_url`, `internal.write_file`, `internal.edit_file`, `internal.apply_patch`, `internal.exec`, and `internal.list_processes`. `internalTools.exec.timeoutMs` controls the default timeout for `internal.exec` when the model does not pass a per-call timeout; per-call timeouts still override it, and runtime clamps exec timeouts to a bounded maximum. `internal.read_url` is limited to HTTP(S) pages with bounded timeout and content size so the agent can inspect setup links, such as MCP docs, before proposing config edits. The write/edit tools resolve relative paths in the agent workspace and can access configured external paths; patch tools apply git-compatible diffs from the project root; exec runs without a shell, from the agent workspace by default, with bounded timeout and output. File tools ignore `.git`, `node_modules`, `dist`, and `coverage`.

## character.json

```json
{
  "name": "Bestie",
  "role": "personal AI companion",
  "language": "vi-first",
  "personality": ["funny", "blunt", "playfully rude", "loyal"],
  "tone": {
    "roastLevel": 6,
    "warmthLevel": 7,
    "bluntnessLevel": 8,
    "chaosLevel": 5
  },
  "boundaries": {
    "neverJokeAbout": [],
    "dropJokesWhen": ["unsafe", "grief", "panic", "self-harm"]
  }
}
```

## Versioning

Every config must include `version`. Migrations should backup before changing user files.

The shipped local runtime now uses `~/.bestie/`. Doctor keeps a narrow compatibility migration for older `.ai-bestie/` local state: `bestie doctor --fix` copies `.ai-bestie/` to `.bestie/` only when `.bestie/` is absent, then rewrites legacy `AI_BESTIE_*` env names to `BESTIE_*` in copied config and env files.
