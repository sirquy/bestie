# Bestie - UI Plan

The first local web console is now part of the shipped local MVP through `bestie ui`. This document tracks the implemented localhost console and the future product UI direction. `PROJECT.md` remains the source of truth when scope or priority conflicts appear.

## Goal

Keep improving the local web console and later product UI for configuring, managing, diagnosing, and embodying the Bestie.

The UI should feel like a character studio / companion control center, not a boring admin dashboard.

## UI Phases

1. CLI first: `bestie onboard`, `bestie doctor`, `bestie status` - shipped.
2. Local web console: `bestie ui` opens `localhost` - shipped as a zero-dependency Node HTTP console.
3. Character Studio: basic character and system prompt editing - shipped; visual/avatar-heavy authoring remains future work.
4. Memory Center: active memory search, pending approvals, and local knowledge graph - shipped; full edit/delete/export and optional Zep status remain future work.
5. Provider & Channel Hub: LLM provider setup plus Telegram, Zalo, cron, daemon and approval surfaces - shipped for local workflows; Discord/web chat and hosted channel setup remain future work.
6. Doctor UI: visual health checks and confirmation-gated safe fixes - shipped for the local console.
7. Avatar/voice/body layer - future work.

## Current Local Console

Current command surface:

```bash
bestie ui
bestie ui --port 8717
bestie ui --port 0 --no-open
```

Current panels:

- Chat session surface with local conversation history, retry/replay/fork/import/export, attachments, run inspector, and command palette.
- Doctor screen with confirmation-gated safe fixes.
- Provider Hub with presets, setup, primary model, fallbacks, and model test.
- Character Studio for `character.json` and `system-prompt.md`.
- Memory Center with search and pending memory approval.
- Knowledge Graph with map, review, trust, search, graph actions, and approval-gated writes.
- Channel Hub for Telegram, Zalo, cron, daemon actions, and cron logs.
- Approvals Hub for pending permission decisions.
- MCP Hub for server, tool, auth, and transport summaries.
- Tools & Permissions for internal tool policies and workspace paths.
- Skills manager for local `~/.bestie/skills` editing plus a source-aware curated local skill library with metadata, preview, resettable and locally persisted source/category/status/trust/risk/permission filters with readable source labels, risk/permission-aware search, sort controls, result/status counts, registry verification status, verified remote test refresh, remote cache freshness/clearing, checksum, diff, rollback, confirmation-gated enable/disable that controls future prompt injection, confirmation-gated uninstall with local archive, and install/update confirmation with source/version/permission/checksum review.
- Settings for low-risk agent and memory policy edits.

Validation:

```bash
npm run smoke:ui
npm run smoke:ui:all
```

## Design Direction

- playful but useful
- bold, characterful, not generic SaaS
- avatar-forward
- warm, expressive, personal
- no gray admin-table slop
- no generic purple AI startup look

## Architecture

The UI should reuse runtime services used by the CLI.

```text
runtime services -> CLI
runtime services -> local web API -> shipped localhost console
runtime services -> future hosted UI
```

Do not duplicate core logic inside the frontend.

## Key Product Questions The UI Must Answer

1. Who is my bestie?
2. Is it healthy and connected?
3. How do I tune it without breaking it?
