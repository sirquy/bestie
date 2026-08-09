# Bestie - UI Plan

The local Web UI is part of the shipped local MVP through `bestie ui`. This document tracks the implemented localhost console and the future product UI direction. `PROJECT.md` remains the source of truth when scope or priority conflicts appear.

## Goal

Keep improving the local Web UI for configuring, managing, diagnosing, and embodying Bestie.

The UI should feel like a character studio plus runtime cockpit, not a generic SaaS admin dashboard.

## Current Stack

The current UI is no longer the original static shell. It is a Vite/React/TypeScript app under `web/src`, built into `dist/ui/web`, and served by the local Node UI API server in `src/ui/server.ts`.

```text
web/src                 React frontend
src/ui/server.ts         localhost HTTP server + JSON API + static asset serving
src/ui/api/*.ts          UI-facing service adapters around runtime modules
dist/ui/web              built frontend assets included in npm package
```

The server still exposes the same local runtime APIs and binds to localhost only by default.

## Command Surface

```bash
bestie ui
bestie ui --port 8717
bestie ui --port 0 --no-open
```

Current behavior:

- Binds to `127.0.0.1` unless explicitly passed `--host localhost`.
- Rejects non-local hosts for the current milestone.
- Prints the local URL; automatic browser opening remains conservative.
- Uses the same runtime paths as CLI, normally `~/.bestie/`.

## Current Panels

- Chat: sessions, markdown messages, attachments, model selection, auto-scroll, enter-to-send, retry/copy/fork message actions, session title editing, fullscreen chat, pinned sessions, session list and inspector collapse state.
- Doctor: diagnostics, JSON-backed report, confirmation-gated safe fixes, update-safe user-facing copy.
- Providers: tabbed model management, provider setup, saved profiles/models, primary/fallback management, tests, and presets including OpenAI, Anthropic, Groq, OpenRouter, QuotaCheap, Gemini, and Ollama.
- Character: editable identity/tone/prompt files. This owns character personality; Settings should not duplicate those controls.
- Memory: tabbed active memory, pending review, and conversation summaries.
- Knowledge: 3D knowledge graph map plus inventory/review controls.
- Channels: tabbed Telegram/Zalo daemon controls, cron schedule CRUD, and cron logs. Channel start/stop/restart affects channel daemons only and does not stop the Web UI daemon.
- Approvals: pending permission decisions and guarded execution for queued local UI actions.
- MCP: server cards, transports, auth/env metadata, classifications, and tool names.
- Tools & Permissions: policy counts, per-tool policy rows, workspace external paths, and exec timeout configuration.
- Skills: installed skill grid, modal editor for installed skills, remote official registry preview in modal, verification/cache controls, install/update/uninstall/rollback/enable/disable confirmations.
- Settings: low-risk system settings such as memory write policy; identity/tone belongs to Character.

## UX Conventions

- User-facing Vietnamese copy by default.
- Modal confirmations for actions that replace legacy `prompt`/`alert` flows.
- Toast notifications for transient success/error messages.
- Responsive app shell with mobile sidebar behavior.
- PWA manifest/service worker support so mobile users can add the Web UI to their home screen.
- Update banner when a newer npm version is available, with CTA to run the update flow.
- Secret values are never rendered; the UI only reports env var names and presence.
- UI Local Unlock requires an exact six-digit owner PIN. The PIN is stored only as a salted `scrypt` hash in local runtime data; browser sessions are in-memory at the server, use `HttpOnly`/`SameSite=Strict` cookies, expire after 12 hours or 30 minutes idle, and reset when the UI process stops. State-changing requests require same-origin and CSRF validation. Recovery is local-only through `bestie ui auth reset`.
- The sidebar includes `Khóa Bestie`, which ends the current UI session and returns to the PIN screen without stopping channel or daemon runtimes.
- Settings includes a `Bảo mật UI` card for changing the unlock PIN. It requires the current PIN, a confirmed new PIN, same-origin/CSRF validation, and revokes all active UI sessions on success.
- The same card shows that the local UI is unlocked, the remaining idle and absolute-session lifetime, and a `Khóa Bestie` action without requiring the user to understand browser cookies or timeout rules.
- The client also monitors real user interactions. It sends a bounded activity heartbeat so the browser and server share the 30-minute idle limit, warns 60 seconds before auto-lock, and offers `Vẫn ở đây` or `Khóa ngay`.

## Non-Goals For The Local UI

- No hosted/SaaS deployment.
- No public network listener by default.
- No multi-user auth model.
- No plugin marketplace.
- No avatar/body layer beyond future visual direction.
- No broad external/destructive action without explicit confirmation and permission review.

## Architecture Rule

The frontend should stay a shell around shared runtime services.

```text
runtime services -> CLI
runtime services -> src/ui/api -> React Web UI
runtime services -> future hosted UI
```

Do not duplicate core business logic inside React components. Add reusable behavior in `src/runtime`, `src/chat`, `src/channels`, `src/memory`, `src/tools`, `src/mcp`, or `src/skills` as appropriate, then expose a focused UI API.

## Validation

```bash
npm run build
npm run smoke:ui
npm run smoke:ui:all
```

`npm run build` compiles TypeScript and builds the Vite UI. `npm run smoke:ui` validates API/static UI routes. `npm run smoke:ui:all` also uses Playwright for browser checks and desktop/mobile layout regressions.

## Future Direction

- Continue local UI polish before hosted UI.
- Improve first-run onboarding and provider setup for non-technical users.
- Add richer backup/restore/migration surfaces after CLI/runtime support is solid.
- Keep hosted/product UI, marketplace, avatar/body, optional Zep, and broader external action execution as later scoped milestones.
