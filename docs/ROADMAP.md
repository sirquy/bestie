# Roadmap

## Now

- terminal chat
- character prompt
- minimal onboarding/config wizard
- OpenAI-compatible LLM call
- basic logs
- character eval suite

Status: completed for local development.

## Next

- choose the next scoped milestone before expanding beyond the local MVP foundation
- fuller onboarding polish only when it improves first-run completion
- Doctor/local diagnostics polish only when it protects install or real use
- Telegram reliability fixes discovered by daily local use

Status: local MVP foundation complete. Terminal chat, onboarding, local SQLite memory, Doctor, Telegram local polling with capped retry backoff, permission-gated read tools, classified read-only MCP calls, Telegram real-bot smoke, and one-command installer smoke exist for local development.

## Later

- fuller onboarding
- optional Zep memory
- backup/update/migration
- local web console
- Doctor UI
- broader tools after permissions have been exercised in terminal and Telegram

## Future

- broader MCP support after permission layer, local tool logging, and real-channel readiness
- ACP/multi-agent support
- plugin system
- persona templates/marketplace
- avatar/voice/body layer
- hosted/SaaS mode

## Hard Rules

- Phase Now excludes Telegram, memory, Zep, MCP/ACP, plugins, installer, UI, avatar, voice, hosted/SaaS, analytics, and telemetry unless explicitly requested.
- Zep after SQLite
- MCP/ACP after Doctor + permissions
- UI after CLI basics
- installer after onboarding works
- no public marketing claims about consciousness/therapy/romance
