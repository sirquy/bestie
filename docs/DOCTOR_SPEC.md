# Doctor Spec

## Commands

```bash
bestie doctor
bestie doctor --json
bestie doctor --fix
bestie doctor --telegram-connect
bestie doctor --zalo-connect
bestie doctor --telegram-speech-test
```

## Purpose

Doctor diagnoses install, config, provider, memory, channel, service, and character problems. It explains issues in beginner-friendly language and repairs safe issues when asked.

Current status: implemented and hardened for local development. Doctor has human and JSON output, a reusable report contract, safe local `--fix`, opt-in Telegram and Zalo identity checks, redacted output guards, smoke coverage, and failure exit codes.

## MVP Checks

The current implementation checks local setup under `~/.bestie`, SQLite memory, Telegram/Zalo config when enabled, speech/transcription readiness, retained Telegram attachment storage, recent fallback health, and MCP config presence without external network messages by default.

- Node version
- project files present
- runtime paths stay inside the local `~/.bestie/` runtime
- config exists and parses
- `.env` exists and is not group/world readable
- LLM API key present without printing secret values
- LLM request timeout is present and within a practical range
- LLM test completion works (future Doctor expansion; current MVP avoids network calls)
- SQLite database opens, runs lightweight migrations, and exposes expected memory/message columns
- character prompt exists and is non-empty
- log directory writable
- existing log file is not group/world readable
- recent provider fallback health from local logs, warning when provider fallback chains have been exhausted recently
- Telegram token present if Telegram enabled
- Telegram attachment storage size if Telegram enabled, with cleanup guidance when retained files exceed the warning threshold
- Telegram transcription readiness when transcription is enabled: provider exists, local command is executable, local model is readable, ffmpeg is available for wrapper-based Ogg/Opus conversion, and tiny local models warn for Vietnamese/mixed language configs
- Telegram speech reply readiness when voice replies are enabled: ElevenLabs or OpenAI-compatible speech provider secret exists, ffmpeg is available for Telegram Ogg/Opus voice-note conversion, and `--telegram-speech-test` can opt into local synthesis/conversion without sending Telegram messages
- Telegram bot identity via `getMe` only when `--telegram-connect` is explicitly passed; default Doctor avoids external network calls
- Zalo token presence when Zalo is enabled, and Zalo bot identity only when `--zalo-connect` is explicitly passed
- MCP server config summary without printing env values; disabled servers and enabled servers missing tool classifications warn, and opt-in `test/tools/call` flows can connect through the SDK-backed MCP commands

## Output Format

The default output is human-readable text for local troubleshooting:

```text
Bestie Doctor

✓ Node.js found
✓ Config file found
✗ LLM API key missing
  Fix: run bestie provider connect llm

Summary: 1 issue found.
```

`--json` prints the same report as structured JSON so later channel integrations can reuse Doctor diagnostics without parsing text.

When `--fix` is passed, JSON output includes a `fixes` array with `fixed`, `skipped`, or `failed` entries before the normal check report is recomputed.

The JSON report contract requires:

- `checks[]` with `name`, `status`, `message`, and optional `fix`
- check status values of `pass`, `warn`, or `fail`
- `fixes[]` with `name`, `status`, and `message`
- fix status values of `fixed`, `skipped`, or `failed`
- `issueCount` matching the number of failed checks
- no secret-like values in JSON output

CLI exit policy:

- exit `0` when `issueCount` is `0`
- exit `1` when failing issues remain, including `--json` and `--fix`
- still print the human or JSON report before exiting non-zero
- warnings alone do not make `issueCount` non-zero

## Provider Fallback Diagnostics

Provider fallback chains are recorded as structured log metadata when all configured LLM, speech, or transcription candidates fail. The log entry includes `fallbackAttempts[]` with provider, model, and raw provider error text so local debugging can answer which candidate failed and why.

User-facing surfaces expose this information conservatively:

- `/status` appends a compact recent fallback count when fallback failures exist.
- `/providers` shows the latest fallback chains with timestamp, provider/model, and sanitized error text.
- `bestie doctor` reports `Provider fallback health` as `warn` when recent fallback attempts are present.

`/providers` normalizes whitespace, redacts secret-like values, and truncates displayed provider errors. Local logs keep structured detail for debugging, but logs still pass through the runtime logger's redaction path before writing to disk.

## Safe Auto-Fixes

`--fix` may:

- create config/data/log dirs
- initialize SQLite
- run migrations
- repair permissions inside user-owned directories

Current MVP `--fix` is intentionally local-only and only creates `~/.bestie/`, `~/.bestie/logs/`, `~/.bestie/data/`, initializes or migrates the local SQLite memory database, and restricts existing `.env` and app log files to owner read/write on POSIX platforms. On Windows, Doctor reports ACL-based guidance and skips POSIX chmod checks/fixes.

After the product rename to `bestie`, `--fix` also handles one safe legacy migration: if repo-local `.ai-bestie/` exists and `.bestie/` does not, Doctor copies the legacy runtime directory to `.bestie/` and rewrites legacy env/config names from `AI_BESTIE_*` to `BESTIE_*`. If `.bestie/` already exists, Doctor leaves `.ai-bestie/` untouched and reports a warning so the owner can archive or remove it manually.

`--fix` does not create or overwrite config files, prompt files, or secrets. If those remain missing after safe fixes, Doctor exits non-zero and reports the remaining issues.

## Requires Confirmation

`--fix` must not silently:

- overwrite config
- delete data
- change keys
- change webhooks/public channel settings
- stop services
- use sudo
- send test messages externally

## Future Checks

- Zep connection
- Telegram/Zalo bot identity by default; `--telegram-connect` and `--zalo-connect` cover opt-in checks today
- systemd user service
- MCP server reachability
- plugin health
- deeper update/migration health

## Smoke Coverage

Current local smoke commands:

```bash
npm run smoke:doctor
npm run smoke:doctor:json
npm run smoke:doctor:fix
npm run smoke:doctor:exit-code
```

`npm run smoke` includes Doctor human output, JSON contract smoke, and safe-fix smoke. The exit-code smoke is separate because it intentionally creates a broken temp runtime and expects Doctor to exit `1`.
