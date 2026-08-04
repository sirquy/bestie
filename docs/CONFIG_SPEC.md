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

Phase Now config started with non-secret `agent` and `llm` fields. The current local build uses config version 2 with canonical LLM model refs, auth profiles, a small model catalog, and optional `llm.image` media model refs. Optional `transcription`, `speech`, `generation`, `memory.writePolicy`, `memory.deletePolicy`, `memory.retrievalPolicy`, `skills.registry`, `workspace`, `internalTools`, `channels`, and `mcp` fields are supported as features are enabled.

```json
{
  "version": 2,
  "agent": {
    "name": "Bestie",
    "ownerName": "Owner",
    "language": "vi",
    "timeZone": "Asia/Bangkok",
    "toneIntensity": 7
  },
  "llm": {
    "primary": "openai/gpt-4o-mini",
    "fallbacks": ["anthropic/claude-sonnet-4-5", "ollama/llama3.1"],
    "image": {
      "primary": "openai/gpt-image-1",
      "fallbacks": ["custom-openai/image-fallback"]
    },
    "authProfile": "openai:api-key",
    "profiles": {
      "openai:api-key": {
        "provider": "openai",
        "mode": "api-key",
        "baseUrl": "https://api.openai.com/v1",
        "apiKeyEnv": "OPENAI_API_KEY"
      },
      "anthropic:api-key": {
        "provider": "anthropic",
        "mode": "api-key",
        "baseUrl": "https://api.anthropic.com/v1",
        "apiKeyEnv": "ANTHROPIC_API_KEY"
      },
      "ollama:local": {
        "provider": "openai-compatible",
        "mode": "local",
        "baseUrl": "http://127.0.0.1:11434/v1"
      },
      "gemini:api-key": {
        "provider": "gemini",
        "mode": "api-key",
        "apiKeyEnv": "GEMINI_API_KEY"
      },
      "custom-image:api-key": {
        "provider": "openai-compatible",
        "mode": "api-key",
        "baseUrl": "https://media.example.com/v1",
        "apiKeyEnv": "BESTIE_IMAGE_API_KEY"
      }
    },
    "modelCatalog": {
      "openai/gpt-4o-mini": { "profile": "openai:api-key" },
      "openai/gpt-image-1": { "profile": "openai:api-key" },
      "custom-openai/image-fallback": { "profile": "custom-image:api-key" },
      "anthropic/claude-sonnet-4-5": { "profile": "anthropic:api-key" },
      "ollama/llama3.1": { "profile": "ollama:local" },
      "gemini/gemini-2.5-flash": { "profile": "gemini:api-key" }
    },
    "timeoutMs": 300000,
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
  "speech": {
    "provider": "elevenlabs",
    "apiKeyEnv": "ELEVENLABS_API_KEY",
    "voiceId": "EXAMPLE_VOICE_ID",
    "modelId": "eleven_multilingual_v2",
    "outputFormat": "ogg_48000_128",
    "timeoutMs": 120000
  },
  "generation": {
    "image": {
      "endpointPath": "/images/generations",
      "timeoutMs": 120000
    },
    "video": {
      "provider": "openai-compatible",
      "baseUrl": "https://media.example.com/v1",
      "model": "video-model",
      "apiKeyEnv": "BESTIE_VIDEO_API_KEY",
      "endpointPath": "/videos/generations",
      "timeoutMs": 300000
    }
  },
  "memory": {
    "writePolicy": "ask",
    "deletePolicy": "ask",
    "retrievalPolicy": "governed",
    "recentMessageLimit": 20
  },
  "workspace": {
    "defaultPath": "~/.bestie/workspace",
    "externalPaths": [
      { "path": "~/shared-readonly", "access": "read" },
      { "path": "~/bestie-exports", "access": "write" }
    ]
  },
  "internalTools": {
    "policies": {
      "internal.write_file": "ask",
      "internal.edit_file": "ask",
      "internal.apply_patch": "ask",
      "internal.exec": "ask",
      "internal.list_processes": "allow",
      "internal.image_generate": "ask",
      "internal.video_generate": "ask",
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
        "deleteAfterProcessingKinds": []
      }
    },
    "zalo": {
      "enabled": false,
      "botTokenEnv": "BESTIE_ZALO_BOT_TOKEN",
      "ownerUserId": "",
      "pollingTimeoutSeconds": 25,
      "attachments": {
        "downloadPolicy": "allow",
        "maxBytes": 20971520,
        "previewMaxBytes": 16384,
        "parseMaxBytes": 5242880,
        "visionPolicy": "deny",
        "visionMaxBytes": 4194304,
        "transcriptionPolicy": "deny",
        "transcriptionMaxBytes": 10485760,
        "deleteAfterProcessingKinds": []
      }
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

LLM config rules:

- `llm.primary` and `llm.fallbacks[]` are canonical `provider/model` refs. Bestie splits on the first `/`, so model IDs may contain additional slashes.
- `llm.image.primary` and `llm.image.fallbacks[]` choose the model refs used by `internal.image_generate`. These refs must exist in `llm.modelCatalog`; their profiles must be `openai` or `openai-compatible` with `baseUrl` and `apiKeyEnv`.
- `llm.profiles` stores non-secret endpoint/auth metadata. `mode: "api-key"` and `mode: "oauth"` require `apiKeyEnv`; `mode: "local"` does not load a secret.
- `llm.modelCatalog[modelRef].profile` chooses which auth profile backs a model ref. When absent in future generated config, runtime falls back to `llm.authProfile`; current validation expects an explicit catalog object.
- Runtime provider labels are `openai`/`chatgpt` for OpenAI Chat Completions, `anthropic`/`claude` for Anthropic Messages, `gemini` for native Google Gemini through `@google/genai`, and `openai-compatible` for custom OpenAI-compatible endpoints or Ollama.
- Fallbacks are model refs, not repeated endpoint objects. Put endpoint/auth details in profiles and map model refs through `modelCatalog`.
- `generation.image` remains backward-compatible for older configs. When `llm.image` is present, `generation.image.endpointPath` and `generation.image.timeoutMs` may still override the default image endpoint/timeout, but provider, model, base URL, and API key come from `llm.image` refs.

Memory config controls local memory policy only. The SQLite database path is derived from runtime paths as `~/.bestie/data/memory.sqlite`; optional Zep remains later work and is not configured by the current schema.

Use `bestie llm providers` to list supported providers with adapter capabilities and `bestie llm models --provider <provider>` to inspect built-in model refs. Use `bestie llm setup` to configure this block and merge API-key secrets into `.env`. The command adds or updates a profile and model catalog entry; it preserves the current `llm.primary` unless `--set-default` is passed. Use `bestie llm models add --model provider/model --profile provider:mode` and `bestie llm models remove --model provider/model` to manage configured custom model refs; omitted `--profile` defaults to `llm.authProfile`. Use `bestie llm test --model provider/model` to test a configured model without switching primary. Use `bestie llm profiles list`, `bestie llm profiles show --profile provider:mode`, and `bestie llm profiles remove --profile provider:mode` to inspect or remove inactive profiles; removing a profile also removes model catalog entries that point to it. Use `bestie llm fallbacks list`, `bestie llm fallbacks add --model provider/model`, and `bestie llm fallbacks remove --model provider/model` to manage fallback order; fallback refs must already exist in `llm.modelCatalog`. The command supports Anthropic, ChatGPT/OpenAI, Groq, OpenRouter, Custom OpenAI-compatible, Custom Anthropic-compatible, local Ollama, Gemini API key, and Antigravity as a future OAuth provider. OAuth setup fails clearly until each provider has a real browser/device flow; Bestie does not scaffold placeholder OAuth tokens.

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

Telegram and Zalo inbound attachments are saved together under `.bestie/workspace/media/inbound/...` and kept by default. Image attachments are sent to the LLM automatically when the primary provider adapter supports image input; set `channels.telegram.attachments.visionPolicy` or `channels.zalo.attachments.visionPolicy` to `"deny"` to force this off. Set `channels.telegram.attachments.deleteAfterProcessingKinds` or `channels.zalo.attachments.deleteAfterProcessingKinds` to attachment kinds such as `["voice", "audio"]` to remove downloaded files after parsing/transcription/vision processing completes. This is useful for voice-heavy channel use where transcripts are enough and retaining raw audio would grow disk usage quickly.

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

Skill Library uses the official GitHub remote registry by default instead of a hardcoded in-app skill catalog. The default registry is `https://raw.githubusercontent.com/sirquy/bestie-skills/master/registry.json`, verified with the sidecar checksum at `https://raw.githubusercontent.com/sirquy/bestie-skills/master/registry.sha256`, cached under `~/.bestie/data/skill-remote-registry-cache.json`, and installed only after explicit WebUI confirmation. Custom registries remain optional; their URLs must use `https://`. Custom installs remain disabled unless the registry is enabled, the cached registry is verified by detached signature or checksum sidecar, `installPolicy` is set to `"ask"`, and the user confirms the install.

```json
{
  "skills": {
    "registry": {
      "remoteOfficial": {
        "enabled": true,
        "url": "https://raw.githubusercontent.com/sirquy/bestie-skills/master/registry.json",
        "checksumUrl": "https://raw.githubusercontent.com/sirquy/bestie-skills/master/registry.sha256",
        "publicKey": "base64-or-pem-public-key",
        "signatureHeader": "x-bestie-registry-signature",
        "timeoutMs": 10000,
        "installPolicy": "ask"
      }
    }
  }
}
```

Installed library skills also write non-secret source metadata to `~/.bestie/skills/<skill-name>/bestie-skill.json`. The manifest records source/version/checksum data, declared library `permissions`, and `enabled`; disabled skills remain visible in the WebUI but are not injected into future prompts. Enable, disable, install, update, rollback, uninstall, remote registry test, and remote cache clear actions all require explicit WebUI/API confirmation. Uninstall archives the removed `SKILL.md` and manifest under `~/.bestie/skills/.uninstalled/` before deletion.

Remote HTTP MCP servers use `transport: "http"`, `url`, and optional headers. Sensitive header values must be mapped from environment variables through `headersEnv`; do not store raw API keys or tokens in `config.json`. Stdio MCP servers inherit a scrubbed process environment with secret-like variable names removed; only values explicitly listed in the server's `env` block are added back for that server.

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

Onboarding writes the LLM API key. Channel, speech, transcription, media generation, and MCP secrets are added only when those features are configured.

```bash
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
BESTIE_TELEGRAM_BOT_TOKEN=
BESTIE_ZALO_BOT_TOKEN=
ELEVENLABS_API_KEY=
COMPOSIO_CONSUMER_API_KEY=
```

Secrets must not be printed after entry and must be redacted from logs. Gemini setup and onboarding use `GEMINI_API_KEY`; OpenAI-compatible custom providers may use `OPENAI_API_KEY` or a user-chosen env var name.

Telegram voice setup commands follow the same rule. `bestie channels telegram voice setup-elevenlabs` prompts for `ELEVENLABS_API_KEY` and writes the secret only to `.bestie/.env`; `.bestie/config.json` stores the env var name plus non-secret voice/model IDs. `bestie channels telegram voice setup-local`, `models`, and `download-model` should print only local paths, model names, sizes, and status details.

Set `BESTIE_NO_BANNER=1` to suppress the decorative CLI banner for human-facing commands in scripts. Set `BESTIE_BANNER=static` to disable the interactive animation while keeping the static banner. Machine-readable JSON outputs such as `bestie doctor --json`, `bestie channels doctor --json`, and `bestie memory export` suppress the banner automatically.

Set `NO_COLOR=1` to disable ANSI colors in human-facing tables, badges, and progress indicators. Commands that emit raw data, logs, git output, transcripts, or JSON payloads should remain script-friendly and avoid decorative formatting.

`memory.writePolicy` controls model-requested memory writes through `internal.remember_memory`: `allow` stores non-secret allowed memories, `ask` queues them as pending approval and asks the owner to approve or deny in supported channels, and `deny` rejects writes. Onboarding writes this field and defaults it to `ask`; older configs that omit it still behave as `ask` at runtime.

`memory.retrievalPolicy` controls how approved active memories are organized before prompt injection. `full` is the default and injects every active memory in the existing importance/recency order. `governed` still injects every active memory, but promotes pinned/current/high-confidence memories and labels low-confidence, expired, scoped, or superseded memories so the model can reason with them more carefully without silently hiding context. It can be changed with `bestie memory governance policy full|governed` or `/memory governance policy full|governed` in supported owner channels.

`workspace.defaultPath` controls where relative write/edit/exec paths land. It defaults to `~/.bestie/workspace` so ad hoc agent-created files do not pollute the project root. Generic `list_files` and `search_files` requests for `.` also inspect this workspace by default. Explicit project paths such as `src`, `docs`, `README.md`, or the absolute project root still inspect the repository so the agent can review code when asked. `workspace.externalPaths` is an explicit allowlist for absolute paths outside the project root and agent workspace. Entries may be legacy strings, which grant both read and write access for compatibility, or objects shaped as `{ "path": "...", "access": "read" | "write" | "readwrite" }`. Without a matching external path, internal tools reject external paths; write/edit/exec cwd and media output paths only write inside the agent workspace or external entries with write access. Git read tools also accept explicit `path` or `repoPath` values when they resolve through this workspace allowlist. Sandbox path resolution follows existing files and nearest existing parents through real paths, so symlinks inside an allowed directory cannot silently escape to an unconfigured location.

`internalTools.policies` controls individual built-in tools with `allow`, `ask`, or `deny`. Local read tools default to `allow`; web reads, writes, patches, exec, process listing, subagent spawning, and media generation default to the permission layer's conservative behavior unless explicitly allowed. Supported policy keys include `internal.read_url`, `internal.write_file`, `internal.edit_file`, `internal.apply_patch`, `internal.exec`, `internal.list_processes`, `internal.spawn_subagent`, `internal.image_generate`, and `internal.video_generate`. Browser tools do not use `internalTools.policies`: open, snapshot, click, type, screenshot, and reset are available without approval, without a domain allowlist, and without extra controls for submit/open/public-state-changing page interactions. `internal.send_photo` and `internal.send_file` also do not use `internalTools.policies`: they send local workspace or allowed external files through the active Telegram/Zalo channel runtime without approval. `internalTools.exec.timeoutMs` controls the default timeout for `internal.exec` when the model does not pass a per-call timeout; per-call timeouts still override it, and runtime clamps exec timeouts to a bounded maximum. `internal.exec` runs without a shell, from the agent workspace by default, with bounded timeout/output, and with secret-like environment variables such as API keys, tokens, passwords, cookies, auth, session, and credential variables removed from the child environment. `internal.read_url` is limited to HTTP(S) pages with bounded timeout and reads full response content by default; callers can pass a positive `maxBytes` only when they intentionally want a preview. Browser tools are limited to HTTP(S) URLs, use a Playwright Chromium session isolated under the Bestie workspace, and write screenshot evidence under `~/.bestie/workspace/browser/evidence/...`. `internal.send_photo` and `internal.send_file` support optional `channel` destinations such as `telegram:<chatId>` or `zalo:<chatId>`, optional captions, and file name/MIME overrides; photo sends require image MIME types. The write/edit tools resolve relative paths in the agent workspace and can access configured external paths; patch tools apply git-compatible diffs from the project root. `internal.image_generate` uses `llm.image.primary`/`llm.image.fallbacks` when configured, falling back to legacy `generation.image`; `internal.video_generate` still uses `generation.video`. Generated files are saved under the agent workspace, usually `~/.bestie/workspace/media/generated/...`; secrets stay in `.env` through `llm.profiles[...].apiKeyEnv`, legacy `generation.image.apiKeyEnv`, or `generation.video.apiKeyEnv`. `internal.spawn_subagent` runs a one-level helper tool loop with a scoped task and bounded max tool calls. File tools ignore `.git`, `node_modules`, `dist`, and `coverage`.

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
