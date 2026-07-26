# Bestie

Bestie is a self-hosted AI companion CLI with a configurable character, local-first memory, provider diagnostics, Telegram/Zalo channels, installed skills, update checks, and a safety-first permission model.

The project is early and intentionally practical: it focuses on a small local runtime that developers can inspect, modify, and run themselves.

## What Bestie Is

- A TypeScript CLI for building and running a personalized AI companion.
- Vietnamese-first by default, but configurable for other language modes.
- Configurable LLM providers, including OpenAI-compatible endpoints, OpenAI/ChatGPT, Anthropic Claude, Groq, OpenRouter, Ollama, and native Gemini API key.
- Designed around privacy controls, local logs, explicit permissions, and user-owned memory.

## What Bestie Is Not

Bestie is not conscious, human, a therapist replacement, a romantic companion, or a promise of perfect memory. It should not be used as a replacement for professional mental health, legal, medical, or financial advice.

## Current Status

Bestie is under active development. The local CLI foundation includes:

- Terminal chat
- Character prompt loading
- Minimal onboarding
- OpenAI-compatible, OpenAI/ChatGPT, Anthropic Claude, Groq, OpenRouter, Ollama, and native Gemini chat provider calls
- Doctor diagnostics
- Local SQLite memory foundation
- Telegram and Zalo local polling
- Cron schedules and a local scheduler runtime
- Manual daemon management for `telegram`, `zalo`, `cron`, or `all`
- Linux user service management through one `bestie.service` runtime for configured service targets
- Local web console through `bestie ui` for chat, Doctor, providers, character, memory, knowledge graph, channels, approvals, MCP, tools, skills, and settings
- Permission-gated local read/write/action tools
- Bounded internal subagent spawning for focused helper investigations
- SDK-backed MCP server config, OAuth login, tool discovery, classification, and classified read calls
- Installed skills loaded from `~/.bestie/skills/<skill-name>/SKILL.md`
- `bestie update` and throttled update notices for new npm versions
- Character regression evals

Some roadmap items are intentionally not ready yet: hosted mode, broad external actions, plugin marketplace, hosted/production UI, avatar/body layer, optional Zep, and unrestricted tool execution.

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
npm run dev -- ui
```

For a local user install:

```bash
./install.sh --skip-onboard
bestie onboard
bestie doctor
bestie chat
bestie ui
```

For npm install:

```bash
npm install -g bestie-agent
bestie onboard
bestie doctor
bestie chat
bestie ui
```

Useful runtime commands:

```bash
bestie channels telegram
bestie channels zalo
bestie daemon restart --channel all
bestie daemon restart --channel cron
bestie service install
bestie service status
bestie ui
bestie ui --port 8717
bestie ui --port 0 --no-open
bestie cron list
bestie mcp list
bestie mcp add demo --url https://mcp.example.com/mcp
bestie mcp login demo
bestie skills
bestie update
bestie update --apply
```

Human-facing CLI commands print a built-in `Bestie Agent` ASCII banner. In an interactive terminal the banner animates briefly; piped output uses the static banner. Set `BESTIE_NO_BANNER=1` to hide it, or `BESTIE_BANNER=static` to keep it still. JSON modes such as `bestie doctor --json` suppress the banner automatically.

## Configuration

Bestie keeps local runtime files under `~/.bestie/` by default. Secrets belong in `~/.bestie/.env`; config files store environment variable names, not secret values.

Example `~/.bestie/.env`:

```bash
OPENAI_API_KEY=your-openai-compatible-key
GEMINI_API_KEY=your-gemini-key
BESTIE_TELEGRAM_BOT_TOKEN=your-telegram-token
BESTIE_ZALO_BOT_TOKEN=your-zalo-token
```

Example provider config:

```json
{
  "llm": {
    "primary": "openai/gpt-4o-mini",
    "fallbacks": ["gemini/gemini-2.5-flash"],
    "authProfile": "openai:api-key",
    "profiles": {
      "openai:api-key": {
        "provider": "openai",
        "mode": "api-key",
        "baseUrl": "https://api.openai.com/v1",
        "apiKeyEnv": "OPENAI_API_KEY"
      },
      "gemini:api-key": {
        "provider": "gemini",
        "mode": "api-key",
        "apiKeyEnv": "GEMINI_API_KEY"
      }
    },
    "modelCatalog": {
      "openai/gpt-4o-mini": { "profile": "openai:api-key" },
      "gemini/gemini-2.5-flash": { "profile": "gemini:api-key" }
    }
  }
}
```

See `docs/CONFIG_SPEC.md` for full config details.

## Development Commands

```bash
npm run build
npm test
npm run smoke
npm run smoke:ui
npm run smoke:ui:all
npm run eval:character
```

Use focused tests while iterating, then run the full suite before opening a pull request. `npm run smoke:ui` runs the API/static UI smoke; `npm run smoke:ui:all` also launches a headless browser and checks hydrated desktop/mobile layouts.

## Local Web Console

Run the local console with:

```bash
bestie ui
```

By default it binds to `127.0.0.1` and opens the browser. Use `bestie ui --no-open` for terminal-only sessions, `bestie ui --port 8717` for a fixed port, or `bestie ui --port 0 --no-open` for smoke-friendly dynamic ports.

The console uses the same `~/.bestie/` runtime files as the CLI. It shows chat sessions, runtime health, provider setup, character editing, memory and knowledge graph views, channel controls, approvals, MCP summaries, tool permissions, skills, and low-risk settings. It reports secret presence and env var names only; raw `.env` values are not returned by UI APIs.

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
