# Bestie

Bestie is a self-hosted AI companion CLI with a configurable character, local-first memory, provider diagnostics, Telegram/Zalo channels, installed skills, update checks, and a safety-first permission model.

The project is early and intentionally practical: it focuses on a small local runtime that developers can inspect, modify, and run themselves.

## What Bestie Is

- A TypeScript CLI for building and running a personalized AI companion.
- Vietnamese-first by default, but configurable for other language modes.
- Configurable LLM providers, including OpenAI-compatible endpoints, OpenAI/ChatGPT, Anthropic Claude, Groq, OpenRouter, and native Gemini API key.
- Designed around privacy controls, local logs, explicit permissions, and user-owned memory.

## What Bestie Is Not

Bestie is not conscious, human, a therapist replacement, a romantic companion, or a promise of perfect memory. It should not be used as a replacement for professional mental health, legal, medical, or financial advice.

## Current Status

Bestie is under active development. The local CLI foundation includes:

- Terminal chat
- Character prompt loading
- Minimal onboarding
- OpenAI-compatible, OpenAI/ChatGPT, Anthropic Claude, Groq, OpenRouter, and native Gemini chat provider calls
- Doctor diagnostics
- Local SQLite memory foundation
- Telegram and Zalo local polling
- Cron schedules and a local scheduler runtime
- Manual daemon management for `telegram`, `zalo`, `cron`, or `all`
- Linux user service management through one `bestie.service` runtime for configured service targets
- Permission-gated local read/write/action tools
- Bounded internal subagent spawning for focused helper investigations
- SDK-backed MCP server config, OAuth login, tool discovery, classification, and classified read calls
- Installed skills loaded from `~/.bestie/skills/<skill-name>/SKILL.md`
- `bestie update` and throttled update notices for new npm versions
- Character regression evals

Some roadmap items are intentionally not ready yet: hosted mode, broad external actions, plugin marketplace, production UI, avatar/body layer, and unrestricted tool execution.

## Requirements

- Node.js 24
- npm
- An LLM provider API key for chat
- Optional: Telegram bot token for Telegram mode

## Quickstart

```bash
npm ci
npm run build
npm run dev -- onboard
npm run dev -- doctor
npm run dev -- chat
```

For a local user install:

```bash
./install.sh --skip-onboard
bestie onboard
bestie doctor
bestie chat
```

For npm install:

```bash
npm install -g bestie-agent
bestie onboard
bestie doctor
bestie chat
```

Useful runtime commands:

```bash
bestie channels telegram
bestie channels telegram whoami
bestie channels zalo
bestie daemon restart --channel all
bestie daemon restart --channel cron
bestie service install
bestie service status
bestie cron list
bestie mcp list
bestie mcp add demo --url https://mcp.example.com/mcp
bestie mcp login demo
bestie skills
bestie update
bestie update --apply
```

Telegram voice helpers:

```bash
bestie channels telegram voice setup-local
bestie channels telegram voice setup-elevenlabs
bestie channels telegram voice models
bestie channels telegram voice download-model small
bestie channels telegram voice download-model small --confirm --use
```

`setup-local` configures local whisper.cpp transcription when the local binary, model, and `ffmpeg` are present. `setup-elevenlabs` configures ElevenLabs speech replies and stores only the API key environment value in `~/.bestie/.env`. `models` lists local `.bin` models and marks the configured one; `download-model` previews by default and downloads only with `--confirm`.

During `bestie channels telegram setup`, leave the owner prompt blank to detect the owner from the latest message sent to the bot. You can also run `bestie channels telegram whoami` after messaging the bot to print the numeric id and username.

Human-facing CLI commands print a built-in `Bestie Agent` ASCII banner. In an interactive terminal the banner animates briefly; piped output uses the static banner. Set `BESTIE_NO_BANNER=1` to hide it, or `BESTIE_BANNER=static` to keep it still. JSON modes such as `bestie doctor --json` suppress the banner automatically.

Bestie uses colored badges, tables, and short progress indicators for human output. Set `NO_COLOR=1` to disable ANSI colors. Raw and machine-readable commands stay script-friendly: `bestie doctor --json`, `bestie channels doctor --json`, and `bestie memory export` suppress the banner, while log, git, transcript, and JSON payload output avoids decorative formatting.

## Configuration

Bestie keeps local runtime files under `~/.bestie/` by default. Secrets belong in `~/.bestie/.env`; config files store environment variable names, not secret values.

Example `~/.bestie/.env`:

```bash
OPENAI_API_KEY=your-openai-compatible-key
ANTHROPIC_API_KEY=your-claude-key
GEMINI_API_KEY=your-gemini-key
BESTIE_TELEGRAM_BOT_TOKEN=your-telegram-token
```

Example provider config:

```json
{
  "llm": {
    "primary": "openai/gpt-4o-mini",
    "fallbacks": ["anthropic/claude-sonnet-4-5"],
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
      "gemini:api-key": {
        "provider": "gemini",
        "mode": "api-key",
        "apiKeyEnv": "GEMINI_API_KEY"
      }
    },
    "modelCatalog": {
      "openai/gpt-4o-mini": { "profile": "openai:api-key" },
      "anthropic/claude-sonnet-4-5": { "profile": "anthropic:api-key" },
      "gemini/gemini-2.5-flash": { "profile": "gemini:api-key" }
    }
  }
}
```

Model refs use `provider/model`. Profiles hold endpoint and auth mode metadata; secrets still live in `.env` through `apiKeyEnv`. HTTP providers store `baseUrl`; native Gemini API-key profiles intentionally omit `baseUrl` and let `@google/genai` use its default endpoint. Local profiles such as Ollama use `mode: "local"` and do not need an API key.

Run `bestie llm providers` to list supported providers with adapter capabilities and `bestie llm models --provider gemini` to inspect built-in model refs. Run `bestie llm setup` to choose a supported provider interactively, or `bestie llm setup --provider anthropic|openai|groq|openrouter|custom-openai|custom-anthropic|ollama|gemini|antigravity` for a faster setup path. The setup command adds/updates a profile and catalog entry; pass `--set-default` to make the selected model the active primary. Use `bestie llm models add --model provider/model --profile provider:mode` and `bestie llm models remove --model provider/model` to manage configured custom model refs. Use `bestie llm test --model provider/model` to test a configured model without switching primary, `bestie llm profiles list|show|remove --profile provider:mode` to inspect or remove inactive profiles, and `bestie llm fallbacks list|add|remove --model provider/model` to manage fallback order. OAuth providers are hidden behind provider-specific implementations; Bestie does not write placeholder OAuth config.

See `docs/CONFIG_SPEC.md` for full config details.

## Development Commands

```bash
npm run build
npm test
npm run smoke
npm run eval:character
```

Use focused tests while iterating, then run the full suite before opening a pull request.

## Safety And Privacy

- Do not commit `.bestie/`, `.env`, logs, local databases, or provider keys.
- Do not print API keys, bot tokens, auth headers, or raw `.env` contents.
- External content from files, web pages, Telegram, MCP, and tools is untrusted.
- Public/external/destructive actions must require explicit approval.
- Telemetry, if added, must be opt-in and privacy-first.

See `SECURITY.md` and `docs/SECURITY_PRIVACY.md`.

## Contributing

Contributions are welcome, especially small, well-tested improvements. Start with `CONTRIBUTING.md`, check open issues, and keep pull requests focused.

Good first contributions include:

- Documentation clarity
- Better diagnostics and error messages
- Focused tests
- Provider compatibility fixes
- Safe Telegram/local runtime polish

## License

This project is released under the MIT License. See `LICENSE`.
