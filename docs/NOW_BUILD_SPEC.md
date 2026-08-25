# Bestie - Phase Now Build Spec

## Goal

Build the smallest working slice that proves the Bestie character feels alive before the project invests in Telegram, installer, UI, MCP, or avatar/voice work. This spec is the historical contract for Phase Now; the current project has since moved into a broader local MVP with config v2, provider profiles, Telegram/Zalo, cron, local memory, Doctor, permission-gated tools, installed skills, npm update checks, daemon/service management, local Vite/React Web UI, and MCP read foundations.

Phase Now delivered a terminal-based chat loop with a configurable character prompt, LLM provider calls, minimal onboarding/config wizard, and basic logs for local development. The shipped implementation now supports OpenAI/ChatGPT, Anthropic Claude, generic OpenAI-compatible endpoints, Groq, OpenRouter, Ollama, and native Gemini API-key mode.

## Source Of Truth

This spec follows:

1. `PROJECT.md`
2. `docs/IMPLEMENTATION_PRIORITY.md`

If this spec conflicts with either file, prefer `PROJECT.md`, then `docs/IMPLEMENTATION_PRIORITY.md`.

## In Scope

- TypeScript project skeleton.
- CLI entrypoint for `bestie`.
- Terminal chat command.
- Minimal onboarding/config wizard.
- Character prompt loading from local files.
- LLM chat completion call through the provider adapter layer.
- Basic runtime config loading.
- Basic logs for startup, config loading, LLM request outcome, and errors.
- README quickstart for Phase Now.

## Out Of Scope For Original Phase Now

- Telegram, Discord, web chat, or any external chat channel.
- SQLite memory, memory extraction, or memory recall. Local SQLite memory was intentionally added later as Next-scope foundation work.
- MCP, ACP, plugins, agent tools, reminders, notes, web search, or external actions.
- One-command installer, update, backup, restore, rollback, systemd service, or daemon mode.
- Full local web UI, hosted UI, avatar, voice, or body layer.
- Analytics or telemetry.

## User Outcome

A developer or early owner can run onboarding, configure an LLM provider, start a terminal chat, and judge whether the Vietnamese-first bestie character feels distinct, useful, funny, blunt, emotionally aware, and safe.

## Functional Requirements

### CLI

The project must expose a CLI named `bestie` with Phase Now commands:

```bash
bestie onboard
bestie chat
bestie status
bestie logs
```

`bestie onboard` must:

- Ask for agent name.
- Ask what the agent should call the user.
- Ask for language mode: Vietnamese, English, or mixed.
- Ask for tone intensity from 1 to 10.
- Ask for memory write policy: `ask`, `allow`, or `deny`.
- Ask for LLM provider configuration:
  - provider label
  - base URL for HTTP providers
  - model name
  - API key
  - Gemini API-key setup uses `GEMINI_API_KEY` and does not ask for or store `baseUrl`
- Save non-secret config to a config file.
- Save secrets to a local `.env` file.
- Generate or update local character files.
- Run a small provider test completion unless `--skip-provider-test` is set.
- Keep local files when the provider test fails, and explain the failure.

`bestie chat` must:

- Load config and character prompt.
- Start an interactive terminal loop.
- Send user messages through the configured LLM provider adapter.
- Include the character system prompt in each request.
- Print the assistant response.
- Exit cleanly on `/exit` or `Ctrl+C`.
- Show a friendly error if config or provider setup is missing.

`bestie status` must:

- Report whether config exists.
- Report whether required env vars are present without printing secret values.
- Report the configured provider label, base URL, and model.
- Report whether character files exist.

`bestie logs` must:

- Print recent log lines or tell the user where logs are stored.
- Never print API keys or raw secret values.

### Character Prompt

The system prompt must encode the core character from `PROJECT.md`:

- Vietnamese-first by default.
- Funny, sharp, blunt, slightly cocky, and emotionally honest.
- Playfully rude only in a close-friend way.
- Warm and serious when the user is vulnerable or unsafe.
- Practical and willing to challenge bad ideas.
- Never cruel, humiliating, hateful, sexually explicit, or pretending to be human.
- Never positioned as therapy, consciousness, romantic companionship, or perfect memory.

The prompt must be stored in editable local files so character iteration does not require code changes.

### Config And Secrets

Use local config files for Phase Now.

Recommended paths for local development:

```text
.bestie/config.json
.bestie/.env
.bestie/character.json
.bestie/system-prompt.md
.bestie/logs/app.log
```

Historical Phase Now config was version 1. Current config is version 2 and may include:

```json
{
  "version": 2,
  "agent": {
    "name": "Bestie",
    "ownerName": "Boss",
    "language": "vi",
    "timeZone": "Asia/Bangkok",
    "toneIntensity": 7
  },
  "llm": {
    "primary": "gemini/gemini-2.5-flash",
    "authProfile": "gemini:api-key",
    "profiles": {
      "gemini:api-key": {
        "provider": "gemini",
        "mode": "api-key",
        "apiKeyEnv": "GEMINI_API_KEY"
      }
    },
    "modelCatalog": {
      "gemini/gemini-2.5-flash": { "profile": "gemini:api-key" }
    }
  },
  "memory": {
    "writePolicy": "allow",
    "deletePolicy": "allow"
  }
}
```

Secrets must live in `.env` and must not be printed after entry.

## Non-Functional Requirements

- Keep startup and command output readable for non-expert users.
- Redact secrets from logs and errors.
- Fail with actionable messages, not stack traces by default.
- Keep modules small enough that Telegram, memory, and Doctor can reuse runtime services later.
- Avoid adding abstractions for MCP, plugins, UI, or hosted SaaS during Phase Now.

## Architecture

Recommended module responsibilities:

```text
src/cli
  Parses commands and runs interactive flows.

src/runtime
  Loads config, env, logger, and shared runtime services.

src/character
  Loads character.json and system-prompt.md.

src/llm
  Resolves model refs, loads auth profiles, and calls provider-specific chat adapters.

src/chat
  Runs the terminal chat loop and assembles messages.
```

Data flow:

```text
Terminal user input
  -> CLI chat command
  -> runtime config/env loader
  -> character prompt loader
  -> chat message builder
  -> LLM provider adapter
  -> terminal response
  -> redacted log event
```

Original Phase Now did not introduce channel, memory, tool, MCP, or UI dependencies into the chat loop. The current code has since added local memory recall and writes, permission-gated internal tools, provider-backed image/video generation, classified permission-gated MCP calls, Telegram/Zalo/cron runtimes, and a localhost UI shell around shared runtime services. Broader external/destructive tool use, hosted UI, and named multi-agent orchestration remain out of current scope.

## Failure States

- Missing config: tell the user to run `bestie onboard`.
- Missing API key: identify the env var name, but do not print the value.
- Invalid base URL: explain that the provider endpoint is unreachable or malformed.
- Auth error: explain that the API key or provider account may be invalid.
- Rate limit/provider failure: show a short friendly error and log technical details.
- Exhausted provider fallback chains: log structured `fallbackAttempts`, show compact health in `/status`, show sanitized recent chains in `/providers`, and warn in Doctor without counting it as a failing issue.
- Empty character prompt: refuse to start chat and tell the user to rerun onboarding or restore the prompt file.

## Acceptance Criteria

- `bestie onboard` creates config, env, character, prompt, and log paths.
- `bestie onboard` writes `memory.writePolicy`, defaulting to `ask`.
- `bestie onboard` does not print entered API keys after submission.
- `bestie onboard --skip-provider-test` creates local files without making a provider network call.
- `bestie status` reports setup status without exposing secrets.
- `bestie chat` can complete a terminal conversation using a configured provider profile.
- `bestie chat` includes the local system prompt in the LLM request.
- The assistant replies in Vietnamese by default when language is `vi`.
- Serious or unsafe user messages reduce playful roasting and use a safety-first tone.
- Logs are written for command start, provider test result, chat request success/failure, and handled errors.
- Logs redact API keys and token-like values.
- Provider fallback diagnostics are available without exposing secrets: raw structured attempts stay in local logs, while `/providers` redacts and truncates displayed error text.
- No Telegram, MCP, plugin, installer, avatar, voice, or UI code was required for the original phase. Telegram/Zalo, local SQLite memory, cron, Doctor, tools, MCP read foundations, installed skills, local Vite/React Web UI, installer/update flows, daemon/service management, and shared voice helpers were added after this phase as local MVP work.

## Validation Plan

Manual validation:

1. Run `bestie onboard --skip-provider-test` and confirm local files are created without a provider call.
2. Run `bestie onboard` with a valid OpenAI-compatible provider.
3. Confirm `.bestie/config.json`, `.bestie/.env`, `.bestie/character.json`, `.bestie/system-prompt.md`, and logs exist.
4. Run `bestie status` and confirm secrets are not printed.
5. Run `bestie chat` and test:
   - casual banter
   - bad idea pushback
   - sad/vulnerable message
   - unsafe message
   - technical question
6. Confirm the character feels distinct from a generic assistant.

Automated validation, if test infrastructure exists:

- Config loader parses valid config.
- Config loader rejects missing required fields.
- Env loader finds the configured API key env var.
- Secret redaction removes API-key-like strings from log messages.
- Prompt loader rejects empty prompt files.
- LLM client builds OpenAI-compatible request shape correctly.

## Milestone Tickets

### Ticket NOW-1: TypeScript CLI Skeleton

Outcome: developer can run the local CLI command during development.

Scope:

- Create TypeScript package structure.
- Add CLI entrypoint.
- Add command routing for `onboard`, `chat`, `status`, and `logs`.
- Add basic README quickstart for local development.

Acceptance criteria:

- CLI starts without runtime errors.
- Unknown commands show useful help.
- Commands are stubbed or implemented without pulling future systems into scope.

Validation:

- Run CLI help.
- Run each Phase Now command once.

### Ticket NOW-2: Config, Env, And Logger

Outcome: runtime can load local config and secrets safely.

Scope:

- Implement config file read/write.
- Implement `.env` loading.
- Implement required config validation.
- Implement redacting logger.

Acceptance criteria:

- Missing config returns a friendly setup error.
- Secrets are loaded by env var name.
- Logs redact API keys and token-like values.

Validation:

- Unit-test config parse failures.
- Unit-test secret redaction.

### Ticket NOW-3: Minimal Onboarding Wizard

Outcome: user can create the first local character and provider config.

Scope:

- Ask character and provider questions.
- Write config, env, character, and prompt files.
- Run a small provider test completion unless `--skip-provider-test` is set.

Acceptance criteria:

- Onboarding produces all required Phase Now files.
- API key is never echoed after entry.
- Provider test success/failure is understandable and does not remove local files.
- `--skip-provider-test` skips the provider network call and logs the skip.

Validation:

- Run onboarding with valid and invalid provider settings.
- Run onboarding with `--skip-provider-test`.

### Ticket NOW-4: Character Prompt Loader

Outcome: chat uses editable character files instead of hardcoded personality.

Scope:

- Load `character.json`.
- Load `system-prompt.md`.
- Validate prompt is non-empty.
- Keep prompt aligned with `PROJECT.md` personality and safety boundaries.

Acceptance criteria:

- Empty prompt prevents chat startup.
- Prompt can be edited without code changes.
- Default generated prompt is Vietnamese-first and safety-aware.

Validation:

- Test prompt loading and empty prompt failure.

### Ticket NOW-5: OpenAI-Compatible LLM Client

Outcome: runtime can send messages to configured provider.

Scope:

- Implement chat completion request.
- Support configurable base URL, model, and API key env var.
- Normalize common provider errors.

Acceptance criteria:

- Valid provider returns assistant text.
- Auth/rate limit/network failures become friendly errors.
- Request shape stays OpenAI-compatible.

Validation:

- Use a real provider manually.
- Unit-test request construction where practical.

### Ticket NOW-6: Terminal Chat Loop

Outcome: user can chat with the Bestie in terminal.

Scope:

- Implement interactive input loop.
- Add `/exit` handling.
- Build messages with system prompt and recent terminal context only.
- Print assistant replies.
- Log success/failure events.

Acceptance criteria:

- Chat starts after valid onboarding.
- Chat exits cleanly.
- Replies use the character voice.
- Historical Phase Now only: no memory, Telegram, tool, MCP, or UI dependencies are introduced. Current local MVP work intentionally supersedes this constraint through scoped runtime services.

Validation:

- Run manual conversation checks listed in this spec.

## Open Questions

- Which package manager should be standard for Phase Now: npm, pnpm, or bun?
- Should local dev config live under `.bestie/` inside the repo first, or immediately use user-level paths from `PROJECT.md`?
- Which OpenAI-compatible provider should be the default example in docs: OpenAI, OpenRouter, QuotaCheap or custom?
- What exact character name and default owner nickname should onboarding suggest?

