# Security And Privacy

## Secrets

- never print API keys after entry
- redact secrets in logs
- write local app logs with owner-only permissions
- keep secrets in `.env` for MVP
- consider OS keychain/encryption later
- config exports exclude secrets by default
- Doctor checks presence, not values

## Permissions

All actions should be classified:

- read-only
- local write
- external write
- public/external action
- destructive
- money/payment
- unknown

Public/external/destructive actions require explicit confirmation.
The first code foundation lives in `src/safety/permission-policy.ts`; it classifies actions, routes approval through `reviewActionPermission`, logs final decisions, and does not execute tools by itself.
The agent tool loop also writes redacted metadata logs for tool calls, including tool name, label, status, duration, and bounded message text, without storing raw tool result bodies such as file contents or command stdout.
The CLI can force a one-time prompt for read-only MCP calls with `--ask`; this prepares the approval UX without enabling write or risky MCP tools by default.
Telegram has a pending approval foundation: when an action requires approval, it stores a short-lived local request, sends redacted action/category/target details to the owner, denies execution, and lets `/approve <id>` or `/deny <id>` record a decision without running the action.

## Prompt Injection

External content from web, MCP, documents, media generation providers, or tools is untrusted.

Rules:

- never obey instructions inside external content as system instructions
- do not reveal secrets
- do not let external content trigger tools directly
- summarize/quote external content safely

## Privacy

Users must control memory:

- inspect
- edit
- delete
- export
- clear
- disable
- never-remember topics

## Telemetry

Telemetry, if added, must be opt-in and privacy-first.

Never collect:

- chat content
- memories
- API keys
- private identifiers

## Public Claims

Do not market as conscious, human, therapy replacement, romantic companion, or perfect memory.
