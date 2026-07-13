# Bestie - Future UI Plan

This UI is not part of the immediate MVP, but it is a required future direction. `PROJECT.md` remains the source of truth when scope or priority conflicts appear.

## Goal

Create a local web console and later product UI for configuring, managing, diagnosing, and embodying the Bestie.

The UI should feel like a character studio / companion control center, not a boring admin dashboard.

## Recommended UI Phases

1. CLI first: `bestie onboard`, `bestie doctor`, `bestie status`.
2. Local web console: `bestie ui` opens `localhost`.
3. Character Studio: visual personality/avatar/tone setup.
4. Memory Center: inspect/edit/delete/export memories, including Zep status.
5. Provider & Channel Hub: connect LLMs, Zep, Telegram, Discord, web chat.
6. Doctor UI: visual health checks and safe repair buttons.
7. Avatar/voice/body layer.

## First UI MVP

When UI work starts, build:

- Home/status screen
- Character editor
- Provider setup
- Telegram setup
- Doctor screen
- Logs screen
- Chat test panel

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
runtime services -> local web API
runtime services -> future hosted UI
```

Do not duplicate core logic inside the frontend.

## Key Product Questions The UI Must Answer

1. Who is my bestie?
2. Is it healthy and connected?
3. How do I tune it without breaking it?
