# Bestie - Cross-Cutting Requirements

These requirements protect the product from becoming a fragile toy. They are not all immediate MVP work, but they must shape architecture. `PROJECT.md` remains the source of truth when scope or priority conflicts appear.

## 1. Security And Secrets

- never print API keys after entry
- redact secrets from logs
- use shared secret-like detection/redaction across logs, Doctor JSON contracts, and channel summaries
- `.env` for MVP, encrypted/keychain storage later
- config export excludes secrets by default
- doctor checks presence, not values
- audit logs for external/write/destructive actions

## 2. Privacy And Memory Control

Users need control over memory:

- inspect
- edit
- delete
- export
- clear all
- `forget this`
- disable memory temporarily
- never-remember topics
- approve sensitive memories

Memory must not feel creepy.

## 3. Plugin System

Future native plugins should support:

- manifest
- declared permissions
- enable/disable
- doctor checks
- plugin logs
- safe uninstall

Example plugins: reminders, notes, journal, calendar, music helper, coding helper.

## 4. Persona Templates

Users should be able to start from templates:

- Funny Savage Bestie
- Soft Emotional Bestie
- Productivity Coach Bestie
- Chaotic Gen Z Friend
- Calm Brutally Honest Mentor
- Vietnamese/Bilingual Bestie

Support import/export/fork/reset later.

## 5. Update, Migration, Backup, Rollback

Current local command:

```bash
bestie update
bestie update --apply
```

Future commands:

```bash
bestie backup
bestie restore <backup-file>
bestie migrate
bestie rollback
```

Always backup before risky update/migration.

## 6. Observability And Debugging

Current local development includes readable redacted operational logs, Doctor diagnostics, JSON Doctor report contracts, smoke scripts, Telegram redacted transcript smoke, local UI smoke/browser visual checks, provider fallback diagnostics, and permission audit logs. The rest of this section is future observability scope.

Future requirements:

- readable logs
- debug mode
- trace per reply
- token/cost tracking
- latency tracking
- provider error tracking
- tool/MCP call logs
- memory retrieval trace

Useful future command:

```bash
bestie debug last-reply
```

## 7. Safety And Abuse Prevention

- owner allowlist
- rate limits
- prompt-injection awareness
- dangerous tool classification
- confirmations for public/external/destructive actions
- no blind trust in external content
- reject shell-command-shaped tool JSON instead of executing it
- keep write/external/destructive tools out of normal channel use until permission UX is mature

## 8. Backup, Restore, Portability

Users should be able to move their bestie between machines:

- export character
- export memory
- export config without secrets
- import on new machine
- restore broken installs

## 9. Public Packaging

Needed if public/open-source:

- README
- quickstart
- install/uninstall docs
- configuration docs
- troubleshooting
- Telegram guide
- MCP guide
- contribution guide

## 10. Optional Product Analytics

Only opt-in, privacy-first telemetry:

- install success/fail
- doctor issue types
- feature usage counts
- crash categories

Never collect chat content, memories, or API keys.

## Priority

1. Security/secrets
2. Privacy/memory control
3. Observability/debugging
4. Update/backup/migration. Npm update checks and `bestie update` are implemented locally; backup/restore/migration remain future hardening.
5. Plugin system
6. Persona templates
7. Analytics
