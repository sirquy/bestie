# MVP Build Plan

## Milestone 0 - Repo Skeleton

Status: implemented for local development.

Deliverables:

- TypeScript project
- package scripts
- CLI entrypoint
- config loader
- logger
- basic docs

Acceptance:

- `npm install` works
- `npm run build` works
- `bestie --help` prints commands

## Milestone 1 - Terminal Character Chat

Status: implemented for local development.

Deliverables:

- `character.json`
- `system-prompt.md`
- provider-profile LLM adapter layer for OpenAI-compatible endpoints, Anthropic Claude, and native Gemini API-key mode
- `bestie chat`
- basic redacted operational logs

Acceptance:

- user can chat in terminal
- replies use configured character style
- logs are written without persisting full conversation transcripts

## Milestone 2 - Onboarding MVP

Status: implemented for local development.

Deliverables:

- `bestie onboard`
- character creation questions
- LLM provider setup
- non-blocking provider test completion
- config v2/env generation with provider/model refs, profiles, model catalog entries, and provider-specific API key env names

Acceptance:

- fresh install can create config without manual file editing
- user meets the character in terminal after onboarding
- Gemini onboarding writes `GEMINI_API_KEY` and does not ask for or store `baseUrl`

## Milestone 3 - Telegram Channel

Status: implemented and real-bot smoke validated for local development.

Deliverables:

- Telegram adapter
- owner allowlist
- `/status`
- safe error messages
- `/doctor` and compact `/memory` commands
- long polling through grammY
- typing indicator, command registration, redacted transcript smoke, and edited tool-progress messages

Acceptance:

- Telegram bot replies to owner
- non-owner access is blocked by default

## Milestone 4 - Local SQLite Memory

Status: implemented for local development with manual controls and config-gated model-requested memory writes.

Deliverables:

- SQLite schema
- message log
- narrow durable memory extraction
- memory retrieval into prompt
- pending sensitive memory path

Acceptance:

- preferences/project facts can be remembered
- secrets/sensitive facts are not auto-stored
- memory can be inspected

## Milestone 5 - Early Doctor

Status: implemented and hardened for local development.

This milestone starts after Phase Now terminal chat and onboarding are working. Do not pull Doctor checks into the Phase Now tickets unless explicitly requested.

Deliverables:

- `bestie doctor`
- `bestie doctor --fix`
- checks for Node/config/env/LLM/SQLite/Telegram/character/logs
- JSON report contract and smoke coverage
- non-zero exit codes when failing issues remain
- opt-in Telegram identity check through `--telegram-connect`

Acceptance:

- missing config is explained clearly
- safe fixes create dirs/db and repair existing local permissions without overwriting config, prompts, or secrets
- risky fixes require confirmation

## Milestone 5.5 - Permission-Gated Read Tools And MCP Read Calls

Status: implemented as a local-development foundation ahead of broader MCP/productized tool work.

Deliverables:

- action permission policy with allow/ask/deny decisions
- redacted audit logging for permission decisions
- internal read tools for files, file search, logs, memories, multi-file reads, Markdown bundles, and read-only git status/diff/log context
- bounded internal action tools for file write, exact text edit, git-compatible patch apply, local exec, and process listing, each governed by per-tool `allow`, `ask`, or `deny` config
- `internal.image_generate` and `internal.video_generate` tools for configured OpenAI-compatible media providers, saving outputs under the agent workspace and governed by the same per-tool policy model
- bounded HTTP(S) URL reads for setup links, including MCP docs/package pages, governed by per-tool `allow`, `ask`, or `deny` config
- terminal and Telegram multi-step tool loop for internal read tools, local action tools, and classified MCP reads
- MCP add/list/show/test/tools/classify/login/call commands backed by `@modelcontextprotocol/sdk`
- remote HTTP MCP metadata discovery, OAuth authorization URL generation, token exchange into `.env`, and config reload after successful MCP config changes
- MCP calls execute only when locally classified as `read` or explicitly approved by the configured permission policy

Acceptance:

- shell command JSON is rejected rather than executed
- repo-scale Markdown summaries can use bounded internal bundle reads
- MCP env values are not printed
- unclassified or risky tool categories do not execute silently
- write, patch, exec, process, and media generation tools obey explicit `internalTools.policies` and default to conservative behavior when no per-tool policy is configured

## Milestone 6 - One-Command Installer

Status: completed for local development.

Spec: `docs/INSTALLER_SPEC.md`.

Deliverables:

- `install.sh`
- dependency checks
- npm package install flow
- onboarding launch
- existing install detection

Acceptance:

- clean user can install with one command
- failed install gives understandable recovery instructions
- local smoke verifies fresh install, onboarding handoff, reinstall preservation, and unknown-directory refusal

## Non-MVP

Do not build yet:

- full UI
- ACP/multi-agent
- plugin marketplace
- hosted/SaaS
- advanced avatar/voice

Broader MCP remains non-MVP beyond the current classified read-only foundation.
