# Bestie - Productized Plan

This file is a quick pointer, not a second source of truth. The detailed productized self-hosted plan lives in `PROJECT.md` starting from section `18. New Direction: Public/Shareable Bestie`.

Core direction:

- self-hosted product
- one-command installer
- onboarding wizard
- user-created character
- OpenAI-compatible LLM provider setup
- optional Zep memory
- Telegram first, more channels later
- safe local-first MVP

Recommended build order:

1. Terminal chat with character prompt.
2. Onboarding wizard.
3. Telegram bot.
4. Local SQLite memory.
5. One-command installer.
6. Optional Zep memory.
7. Avatar/voice/body layer.

## Owner Direction Snapshot

The owner explicitly wants this to become a shareable/self-hosted product, not just a private bot. Required future UX:

- one-command install such as `curl ... | bash`
- automatic environment setup
- onboarding wizard
- agent character creation
- Zep API key setup
- LLM provider setup
- channel connection setup

Implementation order is delegated to developer judgment; requirements should be preserved, but the build should start with the lowest-risk path that proves the character quality first.

## Doctor Requirement

The product must include diagnostics and safe repair:

```bash
bestie doctor
bestie doctor --fix
```

Doctor should eventually detect environment, config, LLM provider, Zep memory, SQLite, channel, service, and character prompt issues. For MVP scope, follow `PROJECT.md` section `33. Doctor And Auto-Fix Requirement`: start with Node version, config/env parsing, LLM key and test call, SQLite writability, Telegram token if enabled, character prompt presence, and log directory writability.

`bestie doctor --fix` may repair safe local problems automatically, but must not overwrite config, delete data, change keys, modify public channel settings, stop services, or use sudo without explicit confirmation.
