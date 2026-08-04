# Bestie - UI Implementation Plan

This plan reflects the current shipped Web UI implementation. `PROJECT.md`, `docs/IMPLEMENTATION_PRIORITY.md`, and `docs/ROADMAP.md` remain higher-priority sources when scope conflicts appear.

## Direction

Build a local companion cockpit, not a hosted SaaS dashboard.

The UI helps the owner answer three questions quickly:

1. Who is my Bestie right now?
2. Is it healthy and connected?
3. How do I tune it without exposing secrets, breaking memory, or killing channel runtime state?

## Implemented Stack

The current UI is a Vite/React/TypeScript app served by the local Node UI server.

```text
web/src/App.tsx                         app shell and route selection
web/src/features/*                      panel implementations
web/src/components/ui/*                 small UI primitives
web/src/lib/api.ts                      JSON API helper
web/src/lib/dialogs.tsx                 modal alert/confirm/prompt replacement
web/src/lib/toasts.tsx                  toast notifications
web/src/lib/pwa.ts                      service worker registration
web/src/assets/bestie-app-icon.png      app icon
src/ui/server.ts                        local HTTP server, API routing, static asset serving
src/ui/api/*.ts                         UI API adapters over runtime services
```

Build output:

```text
dist/ui/web/index.html
dist/ui/web/assets/*
dist/ui/web/sw.js
```

The legacy `src/ui/home-page.ts`, `src/ui/home/client-script.ts`, and related static-shell helpers may still exist for compatibility/history, but the active Web UI frontend is the Vite build under `web/src`.

## Server Contract

`bestie ui` starts a local HTTP server that:

- binds to localhost only for this milestone;
- serves the Vite-built app and app icons;
- exposes JSON APIs under `/api/*`;
- serves route fallbacks for `/chat`, `/doctor`, `/providers`, `/character`, `/memory`, `/knowledge`, `/channels`, `/approvals`, `/mcp`, `/tools`, `/skills`, and `/settings`;
- never returns raw `.env` values;
- routes write/destructive actions through confirmation-aware APIs.

## Implemented API Surfaces

- `/api/status`
- `/api/update`, `/api/update/apply`
- `/api/chat/*`
- `/api/doctor`, `/api/doctor/fix`
- `/api/providers`, `/api/providers/setup`, `/api/providers/test`, `/api/providers/primary`, `/api/providers/fallbacks`
- `/api/character`
- `/api/memory`, `/api/memory/search`, `/api/memory/action`
- `/api/knowledge-graph`, `/api/knowledge-graph/search`, `/api/knowledge-graph/action`
- `/api/channels`, `/api/channels/action`
- `/api/approvals`, `/api/approvals/action`
- `/api/mcp`
- `/api/tools`, `/api/tools/policy`, `/api/tools/config`
- `/api/skills`, `/api/skills/item`, `/api/skills/library`, `/api/skills/library/item`, `/api/skills/library/diff`, `/api/skills/install`, `/api/skills/delete`, `/api/skills/toggle`, `/api/skills/rollback`, `/api/skills/registry/test`, `/api/skills/registry/cache/clear`
- `/api/settings`

## Panel Implementation Notes

### Chat

The chat panel is the primary owner workflow surface. It supports attachments, markdown rendering, model selection, auto-session creation on first send, enter-to-send, shift-enter newline, auto-scroll, fullscreen chat, session pinning, inline title editing, and message overflow actions.

### Providers

Providers are tabbed by task: model management, adding providers, and saved inventory. QuotaCheap is treated as an OpenAI-compatible built-in provider in the runtime catalog.

### Character vs Settings

Character owns identity, language, tone, and prompt files. Settings intentionally avoids duplicating those fields and focuses on low-risk system options such as memory write policy.

### Memory and Channels

Memory and Channels use tabbed layouts to keep tall operational sections manageable. Channels daemon buttons are state-aware: running channels disable start/restart, stopped channels disable stop, and stale channels keep recovery actions available.

### Tools

Tools exposes both per-tool policies and runtime configuration for `workspace.externalPaths` and `internalTools.exec.timeoutMs`.

### Skills

The installed skill editor opens only for installed skills. Skill library preview opens in a modal. Remote registry installs require verified registry state, ask-before-install policy, and user confirmation.

## PWA / Responsive

The UI includes app icon assets, manifest/service-worker support, mobile responsive layout, and compact sidebar behavior. Mobile sidebar should not consume layout width when closed.

## Safety Requirements

- Do not show secrets.
- Do not call native destructive actions without confirmation.
- Use toast for transient notifications, not persistent page alerts.
- Keep page-level load failures inline because they block page content.
- Keep Doctor fixes and permission decisions explicit.
- Keep channel daemon actions scoped so they do not unintentionally stop the Web UI daemon.

## Validation

During UI work:

```bash
npm run build
npm run smoke:ui
npm run smoke:ui:browser
```

Before release:

```bash
npm test
npm run smoke
npm run smoke:ui:all
npm pack --dry-run
```

Known normal warning: the 3D knowledge graph bundle can exceed Vite's default 500KB chunk warning. That warning is not by itself a failed build.

## Open Decisions

- Whether to code-split the 3D knowledge graph bundle.
- Whether `bestie ui` should auto-open the browser again after enough platform-specific reliability checks.
- Whether to add a local one-time session token before any future non-local bind option.
- How much backup/restore/migration UX belongs in Web UI versus CLI.
