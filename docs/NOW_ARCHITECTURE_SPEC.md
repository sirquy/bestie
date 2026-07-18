# Bestie - Phase Now Architecture Spec

## Goal

Define the architecture for the Phase Now slice: terminal chat, character prompt, minimal onboarding/config wizard, OpenAI-compatible LLM calls, and basic logs.

The architecture must prove character quality quickly while leaving clean seams for later Telegram, memory, Doctor, installer, and UI work.

## Source Of Truth

This spec follows:

1. `PROJECT.md`
2. `docs/IMPLEMENTATION_PRIORITY.md`
3. `docs/NOW_BUILD_SPEC.md`

If these files conflict, prefer them in that order.

## System Boundary

Phase Now is a local CLI application.

This boundary is historical for the original Phase Now slice. Later local MVP work has since implemented Telegram/Zalo channels, cron, SQLite memory, permission-gated tools, MCP foundations, installer/update flows, daemon management, and one-service systemd integration.

Inside boundary:

- CLI commands.
- Local config and env loading.
- Character file loading.
- Terminal chat loop.
- OpenAI-compatible LLM request/response handling.
- Redacted local logging.

Outside boundary:

- Telegram, Discord, web chat, and other channels.
- SQLite memory and Zep memory.
- MCP, ACP, plugins, tools, reminders, notes, and web search.
- One-command installer, systemd, update, backup, restore, and rollback.
- Local web UI, hosted UI, avatar, voice, analytics, and telemetry.

## Module Responsibilities

Recommended Phase Now structure:

```text
src/
  cli/
    index.ts
    commands/
      onboard.ts
      chat.ts
      status.ts
      logs.ts
  runtime/
    config.ts
    env.ts
    logger.ts
    paths.ts
    errors.ts
  character/
    character-loader.ts
    prompt-loader.ts
    prompt-generator.ts
    schema.ts
  llm/
    openai-compatible.ts
    errors.ts
    types.ts
  chat/
    terminal-chat.ts
    message-builder.ts
```

### `src/cli`

Owns command parsing and user interaction.

Responsibilities:

- Register `bestie onboard`, `bestie chat`, `bestie status`, and `bestie logs`.
- Convert CLI input into calls to runtime services.
- Present friendly output and actionable errors.
- Avoid direct LLM, config parsing, or prompt assembly logic inside command files.

Commander routing rules:

- `src/cli/index.ts` owns entrypoint lifecycle only: banner, program creation, parse, and top-level errors.
- `src/cli/command-specs.ts` owns the declarative command tree; add new commands and nested commands there.
- `src/cli/command-router.ts` is the only place that directly translates command specs into Commander registrations.
- Every command and nested command must be represented as a `CliCommandSpec` with `name`, `description`, `handler`, and optional `children`.
- Nested help such as `bestie channels -h`, `bestie mcp -h`, and `bestie channels telegram -h` must come from the command tree, not from ad hoc string matching inside handlers.
- Command files in `src/cli/commands/` may parse behavior-specific flags while executing, but they should not define their own top-level help/router style.
- Human output should use shared line UI helpers from `src/cli/ui.ts`; JSON or other machine-readable output must stay plain and banner-free.

Runtime daemon rules:

- `bestie daemon --channel all` manages independent runtime processes, currently Telegram, Zalo, and cron.
- Channel daemons own only channel polling and channel-specific transport concerns.
- Cron schedules run only through the cron daemon target (`bestie cron run`) so scheduler crashes or provider failures do not take down Telegram or Zalo polling.
- `bestie service install|uninstall|restart|status` owns Linux user systemd integration and installs one `bestie.service` unit for all configured service targets.
- The systemd unit runs `bestie service run` in the foreground; that runtime starts Telegram, Zalo, cron, and future service targets together instead of creating one unit per target.
- Systemd service runtime should skip channel targets whose enabled channel config is missing required secrets, while still running cron.
- Shared voice input/output provider setup belongs in channel-neutral services under `src/channels/`; channel modules should keep only transport-specific attachment mapping, download, and send behavior.

### `src/runtime`

Owns local runtime foundations shared by all commands.

Responsibilities:

- Resolve Phase Now paths.
- Read and write config.
- Load `.env` secrets.
- Validate required config fields.
- Provide redacted logging.
- Normalize user-facing errors.

### `src/character`

Owns editable character artifacts.

Responsibilities:

- Load `character.json`.
- Load `system-prompt.md`.
- Generate default character files during onboarding.
- Validate prompt is not empty.
- Keep the default prompt aligned with `PROJECT.md` personality and safety boundaries.

### `src/llm`

Owns provider communication.

Responsibilities:

- Build OpenAI-compatible chat completion requests.
- Send requests to configured base URL and model.
- Read API key from configured env var.
- Return assistant text or normalized provider errors.
- Avoid provider-specific product assumptions beyond OpenAI-compatible shape.

### `src/chat`

Owns terminal conversation behavior.

Responsibilities:

- Run interactive terminal loop.
- Handle `/exit` and interrupt shutdown.
- Build message payloads using the system prompt and recent terminal context.
- Call the LLM client.
- Print assistant responses.
- Emit redacted log events.

## Data And File Model

Use local development paths for Phase Now:

```text
.bestie/
  config.json
  .env
  character.json
  system-prompt.md
  logs/
    app.log
```

### `config.json`

Stores non-secret configuration only.

```json
{
  "version": 1,
  "agent": {
    "name": "",
    "ownerName": "",
    "language": "vi",
    "toneIntensity": 7
  },
  "llm": {
    "provider": "openai-compatible",
    "baseUrl": "",
    "model": "provider-model-name",
    "apiKeyEnv": "OPENAI_API_KEY"
  }
}
```

### `.env`

Stores secrets.

```bash
OPENAI_API_KEY=...
```

Rules:

- Never print secret values after entry.
- Never write secret values to logs.
- Status checks may report presence or absence only.

### `character.json`

Stores structured character settings from onboarding.

Minimum fields:

- agent name
- owner name
- language mode
- tone intensity
- forbidden joke topics, if collected

### `system-prompt.md`

Stores the editable system prompt used by terminal chat.

The prompt must be generated during onboarding and may be edited manually later.

## Runtime Data Flow

### Onboarding Flow

```text
bestie onboard
  -> CLI asks character questions
  -> CLI asks LLM provider questions
  -> runtime writes config.json
  -> runtime writes .env
  -> character module writes character.json
  -> character module writes system-prompt.md
  -> llm module runs provider test completion unless skipped
  -> runtime logger records redacted result
```

### Terminal Chat Flow

```text
bestie chat
  -> runtime loads config.json
  -> runtime loads .env
  -> character loads character.json and system-prompt.md
  -> chat loop reads terminal input
  -> message builder creates OpenAI-compatible messages
  -> llm client sends request
  -> chat loop prints assistant text
  -> runtime logger records redacted success/failure
```

### Status Flow

```text
bestie status
  -> runtime checks config presence and parse result
  -> runtime checks required env var presence
  -> character checks character/prompt file presence
  -> CLI prints status without secrets
```

### Logs Flow

```text
bestie logs
  -> runtime resolves log path
  -> CLI prints recent redacted log lines or path fallback
```

## Message Construction

For Phase Now, message construction should stay simple:

```text
messages = [
  { role: "system", content: systemPrompt },
  recent terminal turns,
  { role: "user", content: currentUserInput }
]
```

Rules:

- Include `system-prompt.md` in every chat request.
- Keep only recent terminal turns in memory for the current process.
- Do not persist conversation memory in Phase Now.
- Do not run memory extraction.
- Do not call tools or external actions.

## Error Handling

Errors should have two forms:

- User-facing message: short, friendly, actionable.
- Log detail: technical enough to debug, with secrets redacted.

Required error categories:

- `MissingConfigError`
- `InvalidConfigError`
- `MissingSecretError`
- `MissingCharacterFileError`
- `EmptyPromptError`
- `ProviderAuthError`
- `ProviderRateLimitError`
- `ProviderNetworkError`
- `ProviderResponseError`

Example behavior:

```text
Missing API key for OPENAI_API_KEY.
Run `bestie onboard` or add the key to .bestie/.env.
```

## Logging And Redaction

Log events should include:

- command started
- config loaded or missing
- character files loaded or missing
- provider test success/failure/skipped
- chat request success/failure
- handled error category

Log events must not include:

- API key values
- raw `.env` contents
- full provider auth headers
- future memory contents or private user data

The logger should redact:

- configured API key values
- bearer tokens
- long token-like strings
- values for keys containing `key`, `token`, `secret`, or `password`

## Security And Privacy Constraints

- No external actions beyond calling the configured LLM provider.
- No secrets in config, logs, status output, or errors.
- No conversation persistence beyond optional redacted operational logs.
- No memory writes.
- No public posting or messages to other users.
- No file deletion or destructive actions.

## Extension Points For Later

Add only lightweight boundaries now:

- CLI command routing should allow future commands.
- Runtime services should be reusable by future Telegram, memory, and Doctor code.
- LLM client should accept config rather than hardcoded provider values.
- Character files should be editable without code changes.

Do not add abstractions for:

- Zep memory.
- MCP servers.
- Multi-agent routing.
- Plugin manifests.
- Hosted SaaS tenancy.
- Avatar or voice providers.

## Acceptance Criteria

- CLI command files do not contain provider request construction logic.
- Chat loop does not read or write memory files/databases.
- LLM client does not know about terminal input, onboarding prompts, or character file paths.
- Character loader does not know about provider credentials.
- Config file contains no secret values.
- `.env` secrets are loaded by env var name and not printed.
- Logs redact API keys and token-like values.
- Empty or missing system prompt prevents chat startup.
- Provider errors are normalized before reaching CLI output.
- The architecture can add Telegram later by reusing runtime, character, and LLM modules without rewriting terminal chat.

## Validation Plan

Manual validation:

1. Run `bestie onboard` and inspect generated files.
2. Confirm config has no API key value.
3. Confirm `.env` contains the API key.
4. Run `bestie status` and verify it reports secret presence only.
5. Run `bestie chat` and verify a response is produced.
6. Break `system-prompt.md` by emptying it and confirm chat refuses to start.
7. Use an invalid API key and confirm the user-facing error is friendly and logs are redacted.

Automated validation:

- Config schema accepts valid config and rejects missing required fields.
- Env loader detects missing configured API key env var.
- Prompt loader rejects empty prompt.
- Logger redacts configured secret values and token-like strings.
- LLM client builds an OpenAI-compatible request body.
- Message builder includes system prompt first.

## Open Questions

- Should Phase Now use `.bestie/` inside the repo or user-level config paths immediately?
- Should `bestie logs` print from `app.log` directly or show the path until logging is stable?
- Should terminal chat keep recent turns by token estimate, message count, or a fixed character budget?
- Which prompt test cases should block Phase Now from being considered complete?