# Onboarding Spec

## MVP Goal

Onboarding v1 should be short. The user should meet their bestie quickly.

Required v1 steps:

1. create character
2. connect LLM provider
3. run terminal test chat

Telegram and memory setup can be follow-up commands.

## Flow

Phase Now should keep this flow minimal: character basics, LLM provider config, local file writes, optional provider test, and terminal chat. Vibe presets, multiple tone sliders, emoji level, and forbidden joke topics are useful follow-ups but should not block the first onboarding implementation if they make it longer than `docs/NOW_BUILD_SPEC.md`.

```text
Welcome
  -> choose character name
  -> choose what agent calls user
  -> choose vibe preset
  -> choose tone sliders
  -> choose memory write policy
  -> choose LLM provider
  -> enter API key
  -> write config
  -> test LLM unless --skip-provider-test is set
  -> start terminal chat
```

Phase Now supports:

```bash
bestie onboard --skip-provider-test
```

Use this for offline setup, smoke tests, or slow/unavailable providers. The command must still create local config, env, character, prompt, and log files.

## Character Questions

- What should your bestie be called?
- What should it call you?
- Choose vibe preset:
  - Funny Savage Bestie
  - Soft Emotional Bestie
  - Productivity Coach Bestie
  - Chaotic Gen Z Friend
  - Calm Brutally Honest Mentor
  - Custom
- Roast level 1-10?
- Warmth level 1-10?
- Bluntness level 1-10?
- Language: Vietnamese / English / mixed?
- Memory write policy: ask / allow / deny? Default: ask.
- Emoji level: none / light / expressive?
- Any topics it should never joke about?

## LLM Questions

- Provider:
  - OpenAI
  - OpenRouter
  - QuotaCheap
  - Custom OpenAI-compatible
- Base URL
- Model
- API key

## Validation

- API key present
- config path writable
- logs path writable
- provider test result is logged when it runs
- provider test failure is explained but does not delete or block local files
- `--skip-provider-test` skips the provider network call and logs that it was skipped
- `memory.writePolicy` is written to config; default `ask` queues model-requested writes for approval

## Follow-Up Commands

```bash
bestie channel connect telegram
bestie memory setup
bestie provider connect zep
bestie doctor
```

## Principle

Do not ask users to configure everything before they feel the product. Fast first magic beats complete first setup.
