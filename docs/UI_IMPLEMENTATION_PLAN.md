# Bestie - UI Implementation Plan

This plan turns `docs/UI_PLAN.md` into an implementation-ready local web console milestone. `PROJECT.md`, `docs/IMPLEMENTATION_PRIORITY.md`, and `docs/ROADMAP.md` remain higher-priority sources when scope conflicts appear.

## Direction

Build a local companion cockpit, not a generic hosted SaaS dashboard.

The first UI should help the owner answer three questions quickly:

1. Who is my Bestie right now?
2. Is it healthy and connected?
3. How do I tune it without breaking secrets, memory, or channel runtime state?

The UI starts as a localhost-only control center for the current npm CLI/runtime. Hosted UI, marketplace, avatar/body, optional Zep, and broad external actions stay out of scope until the local console proves useful.

## Non-Goals For The First UI Milestone

- No hosted/SaaS deployment.
- No public network listener by default.
- No multi-user auth model.
- No plugin marketplace.
- No avatar/body layer beyond reserved visual space.
- No full Telegram/Zalo/web replacement chat surface.
- No direct secret display after a secret is saved.
- No Doctor fix, memory delete, service restart, or destructive action without explicit confirmation.

## Product Shape

The command should be:

```bash
bestie ui
bestie ui --port 8717
bestie ui --port 0 --no-open
```

Default behavior:

- Bind only to `127.0.0.1`.
- Open the browser unless `--no-open` is set.
- Read/write the same runtime paths as the CLI, normally `~/.bestie/`.
- Reuse runtime services instead of shelling out to human-facing CLI text.
- Serve static UI assets plus a small JSON API.

## Current Implemented State

The current local UI milestone is implemented as a zero-dependency Node HTTP console, not yet a Vite/React app.

Shipped command surface:

```bash
bestie ui
bestie ui --port 8717
bestie ui --port 0 --no-open
```

Shipped panels:

- Runtime status and top-level metrics.
- Doctor checks and confirmation-gated safe fixes.
- Provider Hub with presets, setup, primary model, fallback add/remove, and test primary.
- Character Studio for `character.json` and `system-prompt.md` edits.
- Memory Center for active memory search and pending memory approve/reject.
- Channel Hub for Telegram, Zalo, cron, and daemon actions.
- Approvals Hub for pending permission decisions without exposing payload JSON.
- MCP Hub with server cards, transports, auth/env metadata, tool categories, and tool names.
- Tools & Permissions with policy counts, per-tool policy rows, workspace paths, and exec timeout.
- Settings for low-risk agent and memory policy edits.

Current implementation paths:

```text
src/cli/commands/ui.ts
src/ui/server.ts
src/ui/api/*.ts
src/ui/home-page.ts
src/ui/home/client-script.ts
src/ui/home/styles.ts
```

The Home client script is served as `/assets/home.js`; it is not inlined into the HTML shell.

Current validation commands:

```bash
npm run smoke:ui
npm run smoke:ui:all
```

`npm run smoke:ui` validates API routes, startup, static HTML, script syntax, and redaction. `npm run smoke:ui:all` also launches Chromium through Playwright, verifies hydrated panels in a real browser, captures desktop/mobile screenshots in a temporary directory, and checks for horizontal overflow, offscreen core elements, and overflowing buttons.

## Visual Direction

The interface should feel like a character studio plus operational cockpit.

Design principles:

- Use expressive typography and a warm, personal visual language.
- Avoid generic gray admin tables and generic purple AI gradients.
- Use dense but readable panels for operational state.
- Keep cards for repeated entities only: profiles, channels, Doctor checks, memories.
- Put identity and runtime health in the first viewport.
- Make dangerous actions visually distinct and confirmation-gated.

Suggested first visual structure:

```text
Top rail: Bestie identity, active model, runtime health
Left nav: Home, Character, Providers, Doctor, Memory, Channels, Logs, Chat Test
Main panel: selected workflow
Right rail: recent warnings, missing secrets, fallback health, last Doctor summary
```

## Architecture

Add a UI layer around existing runtime services. The implemented console currently follows this shape, with `src/ui/home/*` holding the plain home client assets until a dedicated frontend build exists.

```text
src/cli/commands/ui.ts
  -> src/ui/server.ts
    -> src/ui/api/*.ts
      -> existing runtime / llm / memory / doctor / channels services
    -> static assets from dist/ui/web
```

Recommended paths:

```text
src/ui/server.ts
src/ui/api/status.ts
src/ui/api/config.ts
src/ui/api/providers.ts
src/ui/api/doctor.ts
src/ui/api/memory.ts
src/ui/api/channels.ts
src/ui/api/logs.ts
src/ui/home/
```

Keep API handlers thin. If a handler needs business logic that the CLI also needs, move the logic into `src/runtime`, `src/llm`, `src/memory`, `src/channels`, or `src/safety` first.

## Tech Recommendation

Use a small local HTTP server. The first shipped UI currently uses server-rendered HTML plus a served client script. Vite/React remains optional if the form surface outgrows the plain client shell.

Backend:

- Start with Node's built-in `node:http` server unless route complexity justifies a dependency.
- Keep routes explicit and JSON-only under `/api/*`.
- Serve static files from a built UI directory.
- Support `--port 0` for tests.

Frontend direction:

- Plain HTML/CSS/client JS is acceptable for the current local console.
- Vite + React + TypeScript can be introduced later when it removes real complexity.
- Keep state local first; avoid adding a large client state library.
- Use CSS variables for theme tokens.
- Use icons for actions and status states.

Package impact:

- UI assets must be included in npm package files once implemented.
- Add `ui:build` and wire it into `build` or `prepack` only after the first UI app exists.
- Keep `bestie ui --no-open --port 0` smoke-friendly.

## Local Security Model

The UI is local-only by default.

Rules:

- Bind `127.0.0.1`, not `0.0.0.0`.
- Do not enable CORS wildcard.
- Do not return raw `.env` contents.
- Secret endpoints may report presence, absence, env var names, and last updated metadata, but never values.
- Writes to config, secrets, memory, services, channels, or Doctor fixes must be explicit API actions.
- Dangerous or irreversible operations require confirmation in UI and should reuse existing permission/safety patterns where possible.
- Any future remote bind must require an explicit flag and a separate auth design.

Optional later hardening:

- Generate a one-time local session token and include it in the opened URL.
- Reject requests without the token.
- Expire token when the `bestie ui` process exits.

## Milestone 1: Local UI Server And Home

Goal: open a local page that shows the real runtime summary.

Scope:

- Add `bestie ui` command and help text.
- Start localhost HTTP server.
- Serve a minimal static UI.
- Add `/api/health`.
- Add `/api/status` with config presence, active agent, active model, active provider, missing env vars, channel enablement, memory status, and recent provider fallback health.
- Add a Home screen that renders the status response.

Acceptance:

- `bestie ui --port 0 --no-open` starts and prints the chosen localhost URL.
- `/api/health` returns JSON without reading secrets.
- `/api/status` reports missing `GEMINI_API_KEY` by env var name only.
- Home shows active Bestie name, owner name, model ref, provider profile, memory count or status, channel status, and Doctor-needed hints.
- No browser route or API response leaks raw API keys, bot tokens, headers, or `.env` values.

Validation:

- Unit test API response shaping.
- Smoke test server startup with `--port 0 --no-open`.
- Build still passes with no UI assets missing from package.

## Milestone 2: Doctor UI

Goal: make local health actionable without requiring users to parse terminal output.

Scope:

- Add `/api/doctor` using Doctor's JSON report contract.
- Add `/api/doctor/fix` for safe fixes only.
- Render checks by severity and subsystem: runtime, config, secrets, memory, channels, voice, service, MCP.
- Show fix availability without automatically running fixes.

Acceptance:

- Doctor screen renders the same issue counts as `bestie doctor --json`.
- Secret-related checks show env var names and presence, never values.
- Safe fix buttons require confirmation.
- Failed fixes produce actionable sanitized messages.

Validation:

- Contract test against `validateDoctorReportJsonContract` or shared typed report shape.
- API test for redaction of secret-like values.
- UI smoke for healthy and missing-config states.

## Milestone 3: Provider Hub

Goal: remove JSON editing from LLM provider setup.

Scope:

- List provider profiles, model catalog entries, primary model, fallback order, and provider capabilities.
- Add setup forms for OpenAI/ChatGPT, Anthropic Claude, Groq, OpenRouter, Ollama, Gemini, custom OpenAI-compatible, and custom Anthropic-compatible providers.
- Add model test action for configured models.
- Add set-primary action.
- Add fallback add/remove/reorder action.

Provider rules:

- Gemini API-key profile uses `GEMINI_API_KEY` by default.
- Gemini form does not show `baseUrl`.
- HTTP-backed providers require `baseUrl`.
- Ollama uses local mode and does not require a secret.
- Nested model IDs are valid after the first provider slash, such as `openrouter/anthropic/claude-3.5-sonnet`.

Acceptance:

- User can set Gemini as primary without editing config.
- User can test a configured model without switching primary.
- UI preserves existing inactive profiles unless user explicitly removes them.
- Model/fallback operations reject unknown refs with clear messages.
- Secret entry writes only the configured env var into `.env`.

Validation:

- API tests mirror existing `bestie llm` command behavior.
- Regression test that Gemini writes `GEMINI_API_KEY` and no `baseUrl`.
- Smoke test provider list and model test failure rendering with a fake provider.

## Milestone 4: Character Studio

Goal: make Bestie's identity editable without requiring file editing.

Scope:

- Edit character name, owner name, language, time zone, and tone intensity.
- Edit structured personality/tone fields from `character.json`.
- Edit `system-prompt.md` with preview and reset/regenerate actions.
- Add a test reply panel with sample messages.

Acceptance:

- Saves update local character files using the same writer/loader paths as onboarding.
- Empty prompt is rejected before write.
- Reset/regenerate asks for confirmation and preserves backup or diff visibility.
- Test reply uses unsaved draft prompt only when explicitly requested.

Validation:

- Character file read/write tests.
- Prompt empty-state tests.
- Visual smoke for long prompt and mobile width.

## Milestone 5: Memory Center

Goal: make local memory inspectable and governable.

Scope:

- List/search active memories.
- Filter by tier: core, project, session.
- Show pinned, confidence, source, created/updated timestamps, and governance labels.
- Pin/unpin, move scope, supersede, forget/delete.
- List pending approvals.
- Show hygiene analysis: duplicates, stale memories, conflicts, review-only items.
- Export memory data.

Acceptance:

- Delete/supersede actions require confirmation.
- Pending sensitive memories are clearly labelled.
- Secrets are never shown as saved memory content if redaction rules detect them.
- Hygiene recommendations distinguish auto-delete candidates from review-only items.

Validation:

- API tests against temporary SQLite stores.
- Redaction tests for secret-like memory content.
- UI smoke for empty, large, and pending-heavy memory states.

## Milestone 6: Channel And Runtime Hub

Goal: manage existing local runtimes without memorizing CLI commands.

Scope:

- Telegram setup/status/whoami summary.
- Zalo setup/status summary.
- Cron schedule list/add/remove/toggle.
- Daemon status/restart controls for `telegram`, `zalo`, `cron`, `all`.
- Service install/uninstall/restart/status for `bestie.service`.
- Voice/transcription setup status.

Acceptance:

- Channel secrets are entered once and never displayed again.
- Restart/install/uninstall actions require confirmation.
- Service status output is summarized and sanitized.
- Cron edits validate schedules before write.

Validation:

- API tests with temp runtime paths.
- No real Telegram/Zalo network calls unless explicitly requested.
- Smoke test disabled-channel state.

## Milestone 7: Chat Test Panel

Goal: test the configured Bestie in the browser without replacing Telegram/Zalo or terminal as primary channels.

Scope:

- Local chat test panel.
- Shows active model, provider, fallback status, and memory mode.
- Supports `/status`, provider diagnostics, and normal messages.
- Displays fallback/provider failure summaries.

Acceptance:

- Failed provider attempts are not persisted as successful turns.
- Chat output does not expose raw tool JSON or secret values.
- User can choose whether the test session writes memory.

Validation:

- Reuse terminal chat tests where possible.
- UI smoke for provider failure and normal reply states.

## API Surface Draft

Initial API routes:

```text
GET  /api/health
GET  /api/status
GET  /api/config/summary
GET  /api/providers
POST /api/providers/setup
POST /api/providers/test
POST /api/providers/primary
POST /api/providers/fallbacks
GET  /api/doctor
POST /api/doctor/fix
GET  /api/character
PUT  /api/character
GET  /api/memory
GET  /api/memory/search
POST /api/memory/action
GET  /api/channels
POST /api/channels/action
GET  /api/approvals
POST /api/approvals/action
GET  /api/mcp
GET  /api/tools
GET  /api/settings
PUT  /api/settings
```

Response rules:

- JSON only.
- Return structured `ok`, `error`, `code`, and `detail` fields for failures.
- Redact secret-like strings before serializing errors.
- Avoid passing raw command output unless it is already known to be sanitized.

## Implementation Order

Recommended first PR sequence:

1. Add shared UI server command and `/api/health`.
2. Add status API from existing runtime/config/provider summary services.
3. Add static Home screen and package asset build path.
4. Add Doctor API/screen.
5. Add Provider Hub.
6. Add Character Studio.
7. Add Memory Center.
8. Add Channel Hub.
9. Add Approvals, MCP, Tools, and Settings panels.
10. Add richer Logs/Chat Test panels after the operational console is stable.

## Testing Requirements

Minimum for every UI milestone:

- `npm run build`
- focused API unit tests
- smoke test for `bestie ui --port 0 --no-open`
- `npm run smoke:ui` for API/static UI coverage
- `npm run smoke:ui:all` before release or risky UI changes
- redaction test for any route that can surface errors or logs

Before release:

- `npm test`
- `npm run smoke`
- browser smoke and manual browser check for desktop and mobile widths
- package dry run after UI assets are added

## Open Decisions

1. Whether to keep evolving the plain static shell or introduce Vite/React for future form-heavy panels.
2. Whether `bestie ui` should open the browser automatically by default on Linux server environments.
3. Whether to add a local one-time session token in Milestone 1 or defer until remote bind is considered.
4. Whether Doctor safe fixes should call shared functions directly or go through a UI-specific confirmation wrapper around existing Doctor fix logic.
5. Whether the Chat Test Panel should persist conversation turns by default or use an isolated scratch session.

## Recommended Decision Defaults

- Keep the plain static shell until it creates real maintenance drag; introduce Vite/React only when it simplifies Provider, Character, Memory, or Chat Test work.
- Auto-open browser only when stdout is TTY and `--no-open` is absent.
- Bind localhost only and defer token auth until a real remote-bind feature is proposed.
- Persist chat test turns only when explicitly enabled by the user.
- Implement Provider Hub before Character Studio because provider setup is the current highest-friction workflow.