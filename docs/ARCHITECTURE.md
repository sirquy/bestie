# Architecture

This document describes the current long-term architecture and the local-development runtime that now exists. Phase Now terminal chat/onboarding is complete; the codebase is in local MVP hardening with Telegram, Zalo, daemon management, local SQLite memory, Doctor, permission-gated tools, installed skills, npm update checks, and classified read-only MCP calls implemented for local development.

## Overview

Bestie is a local-first, self-hostable agent runtime. The core runtime should be shared by CLI, Telegram, local web UI, future MCP integrations, and future multi-agent features.

```text
User / Channel
  -> Channel Adapter
  -> Runtime Orchestrator
    -> Mode Detector
    -> Memory Router
    -> Prompt Builder
    -> LLM Adapter
    -> Safety / Permission Layer
    -> Tool / Plugin / MCP Router
  -> Response
  -> Logs + Memory Update
```

## Core Modules

### CLI

Owns user-facing commands:

- `onboard`
- `chat`
- `status`
- `logs`
- `doctor`
- `memory`
- `channels telegram|zalo`
- `daemon`
- `tools`
- `mcp`
- `skills`
- `update`
- future backup/restore commands

Current local development includes `onboard`, `chat`, `status`, `logs`, `doctor`, `memory`, `channels`, `daemon`, `skills`, `tools`, `mcp`, and `update` commands. Backup/restore remain later milestones.

CLI should call runtime services, not duplicate business logic.

### Runtime

Coordinates one turn:

1. receive message
2. build prompt from editable character files
3. call the configured OpenAI-compatible LLM
4. send response
5. store redacted operational logs

The current runtime also includes approved local memory recall, explicit memory writes, permission-gated read tools, a multi-step tool loop, and Doctor diagnostics. Broader write/external/destructive tools, Zep, UI, and multi-agent routing remain later work.

### Character System

Loads:

- `character.json`
- `system-prompt.md`
- style examples
- safety boundaries
- installed skill instructions from `~/.bestie/skills/<skill-name>/SKILL.md`

Character config should be data-driven so onboarding and UI can edit it.

### LLM Adapter

First adapter: OpenAI-compatible HTTP API.

Required config:

- `baseUrl`
- `apiKeyEnv`
- `model`
- optional temperature/max tokens

Adapters should normalize errors for Doctor and logs.

### Memory Router

MVP memory:

- SQLite local memory with active and pending memories, persisted terminal/Telegram messages, pause/resume state, manual inspect/edit/forget/export/clear controls, and config-gated model-requested memory writes

Later:

- optional Zep
- memory merge logic
- pending sensitive memory approvals

### Channel Adapters

Current real channels:

- Telegram long polling with owner allowlist, slash commands, typing, edited tool-progress messages, transcript smoke, shared attachment pipeline, and shared runtime behavior
- Zalo polling with owner allowlist, text replies, memory approval prompts, and friendly tool progress labels
- daemon start/stop/restart/status for `telegram`, `zalo`, or `all`

Later:

- Discord
- web chat
- WhatsApp/Slack/Messenger via adapters

Channel adapters should be thin. They translate platform events into runtime messages and send runtime responses back.

The shared channel contract lives in `src/channels/adapter.ts`. A future channel should expose a descriptor, optional attachment adapter, and outbound adapter instead of copying Telegram handler internals. Reusable channel infrastructure includes:

- `src/channels/activity.ts` for typing/activity keepalive.
- `src/channels/response-controller.ts` for progress edits and final reply chunking.
- `src/channels/attachment-pipeline.ts` plus `attachments.ts`, `attachment-preview.ts`, `attachment-vision.ts`, `audio-transcription.ts`, and `attachment-prompt.ts` for local attachment processing and LLM-facing prompt formatting.

Transport-specific code should still own authentication, polling or webhook mechanics, platform message IDs, upload APIs, and platform quirks.

`src/channels/noop-adapter.test.ts` is the reference contract example. It demonstrates how a future channel wires a descriptor, attachment adapter, response adapter, and activity options without adding a real transport or config surface. See `docs/CHANNEL_ADAPTER_PLAN.md` for the implementation checklist before adding a new real channel.

### Doctor

Doctor is a first-class module. It checks environment, config, providers, memory, channels, logs, services, and character files.

`--fix` only performs safe local repairs unless explicitly confirmed.

Doctor currently has a JSON report contract, safe local fixes, failure exit codes, Telegram opt-in identity checks, and smoke coverage.

### Permissions

Every action beyond text reply should pass through a permission classifier:

- read-only
- local write
- external write
- public action
- destructive
- money/payment
- unknown

Current local foundation allows trusted read-only actions, asks or denies riskier categories by default, logs decisions with secret redaction, and exposes internal read tools for terminal and Telegram.

### MCP / Plugins / Multi-Agent

Current foundation and future extension points:

- classified read-only MCP calls through local config and permission review
- future broader MCP router for arbitrary tool servers
- plugin runtime for native modules
- agent registry for specialist subagents

Broader MCP, plugins, and multi-agent features must wait until Doctor, logging, permissions, and real-channel behavior are mature.

## Data Paths

Default local runtime path:

```text
~/.bestie/
```

The current code resolves runtime paths through `getRuntimePaths(rootDir = homedir())`, so normal installed usage stores config, secrets, logs, memory, skills, daemon state, and workspace data under `~/.bestie/`.

Future XDG-style paths remain a possible packaging target, not the current implementation:

```text
~/.config/bestie/
~/.local/share/bestie/
~/.local/state/bestie/logs/
```

## Design Rule

Core logic belongs in runtime services. CLI and UI are shells around the same runtime.
