# Bestie

Bestie is a self-hosted AI companion CLI with a configurable character, local-first memory, provider diagnostics, Telegram/Zalo channels, installed skills, update checks, and a safety-first permission model.

The project is early and intentionally practical: it focuses on a small local runtime that developers can inspect, modify, and run themselves.

## What Bestie Is

- A TypeScript CLI for building and running a personalized AI companion.
- Vietnamese-first by default, but configurable for other language modes.
- OpenAI-compatible for LLM providers, with local config for model, base URL, and API key environment variable names.
- Designed around privacy controls, local logs, explicit permissions, and user-owned memory.

## What Bestie Is Not

Bestie is not conscious, human, a therapist replacement, a romantic companion, or a promise of perfect memory. It should not be used as a replacement for professional mental health, legal, medical, or financial advice.

## Current Status

Bestie is under active development. The local CLI foundation includes:

- Terminal chat
- Character prompt loading
- Minimal onboarding
- OpenAI-compatible chat provider calls
- Doctor diagnostics
- Local SQLite memory foundation
- Telegram and Zalo local polling
- Channel daemon management, including `--channel all`
- Permission-gated local read/write/action tools
- Basic classified MCP read-tool support
- Installed skills loaded from `~/.bestie/skills/<skill-name>/SKILL.md`
- `bestie update` and throttled update notices for new npm versions
- Character regression evals

Some roadmap items are intentionally not ready yet: hosted mode, broad external actions, plugin marketplace, production UI, avatar/body layer, and unrestricted tool execution.

## Requirements

- Node.js 20 or newer
- npm
- An OpenAI-compatible provider API key for chat
- Optional: Telegram bot token for Telegram mode

## Quickstart

```bash
npm ci
npm run build
npm run dev -- onboard
npm run dev -- doctor
npm run dev -- chat
```

For a local user install from a checkout:

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
bestie channels zalo
bestie daemon restart --channel all
bestie skills
bestie update
bestie update --apply
```

## Configuration

Bestie keeps local runtime files under `~/.bestie/` by default. Secrets belong in `~/.bestie/.env`; config files store environment variable names, not secret values.

Example `~/.bestie/.env`:

```bash
OPENAI_API_KEY=your-provider-key
BESTIE_TELEGRAM_BOT_TOKEN=your-telegram-token
```

Example provider config:

```json
{
  "llm": {
    "provider": "openai-compatible",
    "baseUrl": "https://api.openai.com/v1",
    "model": "provider-model-name",
    "apiKeyEnv": "OPENAI_API_KEY"
  }
}
```

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
