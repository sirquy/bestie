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
- Telegram/Zalo reliability fixes discovered by daily local use
- skills and update-command polish when it improves owner workflows

Status: local MVP foundation complete. Terminal chat, onboarding, local SQLite memory, Doctor, Telegram/Zalo local polling, cron, daemon management for `telegram|zalo|cron|all`, one `bestie.service` systemd runtime, permission-gated local tools, SDK-backed MCP setup plus classified read calls, installed skills, npm update checks, Telegram real-bot smoke, and one-command installer smoke exist for local development.

## Later

- fuller onboarding
- optional Zep memory
- backup/restore/migration
- local web console
- Doctor UI
- broader tools after permissions have been exercised in terminal, Telegram, and Zalo

## Future

- broader MCP execution categories after permission layer, local tool logging, and real-channel readiness
- ACP/multi-agent support
- plugin system
- persona templates/marketplace
- avatar/voice/body layer
- hosted/SaaS mode

## Hard Rules

- The original Phase Now excluded Telegram, memory, Zep, MCP/ACP, plugins, installer, UI, avatar, voice, hosted/SaaS, analytics, and telemetry. The current local MVP has since implemented Telegram, Zalo, cron, local memory, Doctor, permission-gated tools, MCP setup/read foundations, installer, skills, update checks, daemon management, and one-service systemd integration.
- Zep after SQLite
- MCP/ACP after Doctor + permissions
- UI after CLI basics
- installer after onboarding works
- no public marketing claims about consciousness/therapy/romance
