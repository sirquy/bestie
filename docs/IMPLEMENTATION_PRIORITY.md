# Bestie - Implementation Priority Contract

This file defines what to build now, next, later, and future. It exists to prevent feature gravity from pulling the project into risky systems too early. `PROJECT.md` remains the source of truth when scope or priority conflicts appear.

## Dangerous Mistakes To Avoid

1. Do not build MCP/ACP before Doctor and permission layer.
2. Do not let playful rude tone become abusive.
3. Do not market the agent as conscious, therapy, romantic companionship, or perfect memory.
4. Do not make onboarding v1 too long.

## Now

Status: completed for local development and superseded by the local MVP foundation.

Delivered:

- terminal chat
- character prompt
- minimal onboarding/config wizard
- config v2 with provider/model refs, auth profiles, fallback order, and provider catalog
- LLM adapters for OpenAI/ChatGPT, Anthropic Claude, OpenAI-compatible endpoints, Groq, OpenRouter, Ollama, and native Gemini API-key mode
- basic redacted logs

Goal: prove the character feels alive.

## Next

Status: completed for local development. Local SQLite memory, basic memory policy, status, Doctor MVP, Telegram/Zalo channel runtimes, cron, daemon/service management, permission-gated local tools, image/video generation tools, bounded internal subagents, fixed-role Agent Workforce, SDK-backed MCP setup plus classified read calls, installed skills and verified remote registry lifecycle, npm update checks, native Gemini API-key and local CLI provider setup, provider catalog/CLI management, local Vite/React Web UI, and opt-in Telegram real-bot smoke are implemented and validated for local development.

Build:

- Telegram channel (`docs/TELEGRAM_MVP_SPEC.md`)
- Zalo channel runtime
- cron schedule CRUD and scheduler runtime
- daemon management for `telegram`, `zalo`, `cron`, `workforce`, or `all`
- user service management across Linux systemd, macOS launchd, and Windows Startup for configured Telegram, Zalo, cron, Agent Workforce, and Web UI targets
- local SQLite memory
- basic memory policy
- status command
- MVP Doctor checks and safe local fixes
- first permission layer and read-only local tool foundation
- permission-gated `internal.image_generate` and `internal.video_generate` tools for configured media generation providers
- bounded `internal.spawn_subagent` helper investigations inside the existing tool loop
- fixed-role Agent Workforce profiles, task inbox, queued executor, watcher daemon, and manager tools
- MCP add/list/show/test/tools/classify/login/call commands, remote HTTP OAuth setup, and classified read calls for trusted local workflows
- installed skills from `~/.bestie/skills`
- `bestie update` for npm version checks and updates
- local Vite/React Web UI through `bestie ui` for chat, Doctor, providers, character, memory, knowledge graph, channels, approvals, MCP, tools, skills, Agent Workforce, settings, PWA install support, update notices, and responsive mobile layout

Maintenance guardrails:

- keep Doctor useful for local config, secrets, logs, SQLite, and Telegram
- rerun Telegram real-bot smoke after risky channel/tool changes
- avoid broadening into hosted/product UI, public tools, hosted mode, or general multi-agent orchestration/collaboration without a scoped milestone decision

Goal: make it usable in a real chat channel.

## Later

Build:

- one-command installer (completed for local development)
- fuller onboarding
- backup/restore/migration
- hosted/product UI beyond the shipped localhost React console
- broader tool surfaces after permission defaults have real-channel mileage

Goal: make it usable by non-technical users.

## Future

Build:

- broader MCP execution categories after Doctor, permissions, local read tools, and real-channel behavior are stable
- ACP and general multi-agent orchestration beyond the fixed-role Agent Workforce and bounded subagent helper
- plugin system
- persona templates
- hosted/SaaS mode
- advanced avatar/voice/body

Goal: expand power after core safety exists.

## Character Evals Required

Before heavy implementation, create `docs/CHARACTER_EVALS.md` with 20-30 test conversations covering banter, sadness, spiraling, unsafe states, bad ideas, technical help, ambition, procrastination, memory recall, and sensitive info.

## Memory MVP Policy

Expose complete model-requested memory listing through `internal.list_memories`, search through `internal.search_memories`, structured governance analysis through `internal.analyze_memories`, model-requested writes through `internal.remember_memory`, and a bounded post-turn Memory Candidate Reasoning pass for configs that explicitly set `memory.writePolicy`; config controls whether allowed non-secret writes are stored, queued, or denied.

Sensitive details should go to pending approval. Secrets must never be stored.

Every stored memory should keep source, consent, and lightweight governance metadata so users and tools can inspect why it was saved, detect duplicates/stale/conflicting entries, and remove it later.

## Onboarding MVP Scope

First onboarding should only require:

1. create character
2. connect LLM provider
3. run terminal test chat

Telegram and memory can be follow-up commands to reduce friction.
