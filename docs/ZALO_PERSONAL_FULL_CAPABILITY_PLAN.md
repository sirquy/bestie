# Zalo Personal Full Capability Implementation Plan

## Purpose

This plan expands `channels.zaloPersonal` from its current experimental direct-message transport into a capability-complete integration over the installed `zca-js@2.1.2` dependency. It is a roadmap, not a promise to enable every upstream method by default.

`zca-js` automates a normal personal Zalo account through undocumented/unofficial behavior. The automation account can be restricted or banned, library contracts can change without notice, and a destructive or social action can affect real people. Every feature below must preserve Bestie's existing permission layer, redacted logs, conservative defaults, and public-agent isolation.

Reference inventory:

- `https://zca-js.tdung.com/vi/get-started/introduction.html`
- `https://zca-js.tdung.com/vi/auth/login-with-qrcode.html`
- `https://zca-js.tdung.com/vi/listeners/message.html`
- `https://zca-js.tdung.com/vi/listeners/reaction.html`
- `https://zca-js.tdung.com/vi/listeners/group_event.html`
- `node_modules/zca-js/dist/apis.d.ts` from the pinned `zca-js@2.1.2`

## Current Baseline

The existing implementation already provides:

- QR login, encrypted/session-env persistence, restore, logout, status, daemon lifecycle, reconnect, per-thread serialization, de-duplication, and self-message suppression.
- Direct-message text input/output, typing, user display-name lookup, inbound media download, generated-image/file delivery, memory, approvals, tool use, and channel binding.
- Direct-message sticker normalization so sticker-only events reach the primary or bound workforce agent as a neutral chat input.

The adapter is intentionally narrow. `ZaloPersonalClient` currently wraps only `getUserInfo`, `sendMessage`, `sendTypingEvent`, and generic attachment upload. It does not expose group, reaction, message lifecycle, contact, reminder, poll, profile, catalogue, or account-management operations supplied by `zca-js`.

## Product Principles

1. Treat `zca-js` as a volatile transport: isolate all calls behind `src/channels/zalo-personal/`, pin its version, and add contract fixtures for each payload shape used.
2. Default to an automation-only account. Never turn a controller, public sender, or group member into an administrator merely because they can message the account.
3. Separate **read**, **reply**, **social**, **group-admin**, **account-admin**, **destructive**, and **financial** operations into distinct internal tools and permission categories.
4. Do not expose raw `zca-js` methods directly to the LLM or WebUI. Use typed Bestie commands/tools with narrow input schemas, target validation, idempotency keys, and readable confirmation text.
5. Preserve existing public-channel rules: public conversations get isolated memory/knowledge context, no management commands/approval callbacks in their chat, and no tool-progress messages. Public mode must not silently escalate or weaken action approval.
6. Do not write cookies, QR payloads, attachment URLs with credentials, contact books, or raw event data to normal logs. Store only redacted diagnostics and minimum durable state.
7. Launch each phase behind an explicit config capability flag and validate it with a dedicated Zalo automation account before broadening scope.

## Target Architecture

### Transport Layer

Extend `src/channels/zalo-personal/client.ts` into a typed facade rather than enlarging `ZaloClient` with every personal-account method.

- `ZaloPersonalSessionClient`: login, restore, QR, keepalive, identity/session health.
- `ZaloPersonalMessagingClient`: text, rich media, sticker, link, card, forward, reactions, delivery/seen events, delete/undo.
- `ZaloPersonalDirectoryClient`: self profile, user lookup, friends, aliases, groups, group members, conversation context.
- `ZaloPersonalGroupClient`: group creation/settings/membership/invite links/polls/notes/reminders.
- `ZaloPersonalAccountClient`: profile/avatar/settings, labels, quick messages, auto-reply, catalogue.
- `ZaloPersonalListenerAdapter`: message, reaction, undo, and group-event listener normalization into Bestie ingress events.

Each facade must explicitly enumerate supported `zca-js` methods. Unsupported upstream methods remain unavailable rather than falling through dynamically.

### Capability Registry

Add `src/channels/zalo-personal/capabilities.ts` with a registry entry per Bestie-facing operation:

- stable tool name and JSON schema
- underlying `zca-js` method(s)
- minimum channel context (`direct`, `group`, or either)
- required config flag
- permission category and default (`allow`, `ask`, or `deny`)
- idempotency/replay behavior
- public-agent eligibility
- audit metadata with secrets removed

The registry becomes the single source for CLI/WebUI labels, tool descriptions, Doctor checks, and test coverage.

### Durable State

Add a small SQLite-backed Zalo Personal state store under the existing data directory:

- processed event IDs and message IDs for replay protection
- outgoing action idempotency keys and result references
- known thread metadata and safe display-name cache with TTL
- configured group access/mention policies
- pending group/member/action approvals
- temporary attachment metadata and cleanup state

Do not persist session cookies in SQLite; retain the current session-env model.

### Ingress and Routing

Normalize all listener events into typed events before invoking the agent:

- direct/group message with text, reply context, mentions, quote/reply metadata, attachments, sticker/reaction metadata, and sender/thread identity
- reaction event
- unsend/undo event
- group event (membership, role, invite/link, settings)

Use a durable inbox for event acknowledgement/retry. Serialize agent work per thread, but permit independent threads in parallel. Resolve channel binding after event normalization so primary and workforce agents receive the same canonical context.

## Configuration Model

Extend `channels.zaloPersonal` without making powerful capabilities implicit:

```json
{
  "channels": {
    "zaloPersonal": {
      "enabled": true,
      "sessionEnv": "BESTIE_ZALO_PERSONAL_SESSION",
      "ownerUserId": ["controller-id"],
      "capabilities": {
        "messaging": true,
        "richMessaging": false,
        "reactions": false,
        "groups": false,
        "contacts": false,
        "reminders": false,
        "profile": false,
        "catalog": false
      },
      "groups": {
        "allowedGroupIds": [],
        "requireMention": true,
        "allowCommands": false
      }
    }
  }
}
```

Rules:

- The actual field names should be finalized together with the config spec and migration tests; the example is directional.
- `groups.allowedGroupIds` must never accept `"*"` by default.
- Public `ownerUserId: ["*"]` is direct-message access only until a separately approved group-public policy exists.
- Any capability that can contact, alter, remove, block, invite, or expose information defaults to disabled and requires both a config flag and permission review.
- WebUI exposes only capabilities supported by the installed version and gives a clear consequence before a destructive toggle is saved.

## Delivery Phases

### Phase 0 — Hardening the Existing Transport

Goal: make current direct-message behavior reliable before adding new actions.

- Complete canonical inbound support for text, quote/reply, link, image, document, GIF/video, voice/audio, sticker, and unsupported event fallbacks.
- Preserve message metadata needed for reply/forward/delete operations without injecting raw external metadata into the model prompt.
- Add optional keepalive, reconnect telemetry, listener ownership diagnostics, and Doctor checks for browser/listener conflicts.
- Add session health checks that validate identity without printing cookies or tokens.
- Verify chunks, media download/upload, retry behavior, retention, and no-loop handling against a dedicated live account.

Exit criteria: no common inbound message type produces a primary-agent fallback or transport-error reply merely because it lacks a downloadable file.

### Phase 1 — Rich Messaging and Message Lifecycle

Goal: make the agent communicate naturally in direct chats while maintaining review gates.

- Add typed outbound operations for `sendSticker`, `sendLink`, `sendCard`, `sendVoice`, `sendVideo`, `uploadAttachment`, and `forwardMessage`.
- Add contextual reply/quote support when `zca-js` exposes the required message destination fields.
- Add read-only handling for reaction, delivery, seen, and undo events; then optional `addReaction`, `sendDeliveredEvent`, and `sendSeenEvent`.
- Add `deleteMessage` and `undo` only as destructive permission-reviewed operations with an exact target preview.
- Map rich inbound content to truthful prompts: the model may know an emoji/sticker identifier or attachment metadata, but must not claim visual/audio understanding unless media processing actually produced it.

Default permissions:

- Sending text/files already follows current channel action rules.
- Reactions, delivery, and seen: `ask` initially.
- Forward, delete, and undo: `ask` with target confirmation.
- Bank-card payloads are explicitly excluded from this phase.

### Phase 2 — Directory, Context, and Contacts

Goal: let the agent resolve allowed recipients and group context without leaking the account's social graph.

- Wrap read APIs: `getOwnId`, `fetchAccountInfo`, `getUserInfo`, `findUser`, `findUserByUsername`, `getAllFriends`, `getAliasList`, `getAllGroups`, `getGroupInfo`, `getGroupMembersInfo`, `getContext`, and bounded conversation/history APIs where reliable.
- Add a consent-aware local contact resolver. Search results are visible only to the owner/admin or to an agent policy that explicitly allows directory lookup.
- Use exact IDs internally; show display names only as confirmation aids.
- Add recipient disambiguation: the agent must ask when a query matches multiple users/groups, and must never infer a target from a vague name.
- Add `changeFriendAlias` and `removeFriendAlias` as permission-reviewed personal-data operations.

Default permissions: directory reads `ask` outside private owner chats; aliases `ask`; no friend request, block, or removal yet.

### Phase 3 — Groups and Group Event Routing

Goal: support safe, allowlisted group conversations.

- Extend listener support for group messages, reactions, group events, and undo events.
- Add per-group allowlist, mention gating, quiet-hours, role-based sender rules, and separate memory namespaces such as `agent:<id>:group:<groupId>`.
- Bind one workforce agent per channel as today, then route group context to that agent while preserving `direct` versus `group` prompt boundaries.
- Implement safe read-only group tools: list allowed groups, inspect group/member information, group invite link details, poll detail, and pending members.
- Add outbound group replies, rich messages, and files only after mention/allowlist checks.
- Add administrative APIs in sub-phases: create/rename group, add/remove members, deputy/owner changes, invite links, group settings, blocked members, and group removal/dispersal.

Administrative operations are high-risk and always need approval; ownership transfer and group dispersal require a typed double confirmation that includes the exact group name/ID and irreversible consequences.

### Phase 4 — Collaboration Objects

Goal: expose native Zalo collaboration features through bounded Bestie tools.

- Polls: `createPoll`, `addPollOptions`, `getPollDetail`, `lockPoll`, `sharePoll`.
- Reminders: `createReminder`, `getReminder`, `getListReminder`, `editReminder`, `removeReminder`, and responses.
- Notes/board: `createNote`, `editNote`, `getListBoard`.
- Quick messages and auto replies: list/create/update/delete only for the automation account, with an explicit ownership/config switch.
- Ensure Bestie cron and Zalo reminders have clear semantics; creating a native Zalo reminder must not silently create a Bestie cron job, or vice versa.

All create/edit/remove actions go through the permission layer. Destructive reminder/note removal requires approval even if normal external writes are otherwise allowed.

### Phase 5 — Profile, Conversation, and Account Preferences

Goal: provide optional account housekeeping without unsafe automation defaults.

- Read account/profile/settings: avatar lists, labels, mute/pin/archive/hidden conversations, auto-delete settings, QR/account identity, and relevant preferences.
- Write operations: profile/avatar changes, language/settings, labels, pin/mute/archive/hide conversations, auto-delete setup, and chat deletion.
- Model every state-changing operation as an explicit proposed action with a human-readable diff and a reversible/irreversible marker.
- Do not enable background bulk cleanup. Bulk actions require a preview command and one approval per bounded batch.

`deleteChat`, avatar deletion, profile change, and broad conversation-state changes are high-risk and default to `deny` until the owner explicitly opts in.

### Phase 6 — Business, Catalog, and Financial Surfaces

Goal: support the APIs without turning Bestie into an uncontrolled commercial actor.

- Read-only business/catalog APIs first: `getBizAccount`, catalog/product catalog lists, and product metadata.
- Add catalog/product create/update/delete only if the project has an explicit business-use milestone and audit requirements.
- Keep `sendBankCard`, payment-like payloads, reports, friend requests, block/unblock, feed controls, and automated recommendation/contact actions disabled by default.
- Require an explicit product decision before exposing financial or account/social-impact APIs. They need stronger confirmation UX, recipient verification, and durable audit logs than ordinary chat tools.

This phase is intentionally not part of default Zalo Personal installation.

## Upstream API Coverage Matrix

| Capability family | `zca-js` examples | Bestie exposure target | Default |
| --- | --- | --- | --- |
| Session/listener | QR login, cookie restore, keepAlive, message/reaction/group/undo listeners | Transport only | enabled for core runtime |
| Direct messaging | sendMessage, uploadAttachment, sendSticker, sendLink, sendCard, sendVoice, sendVideo | channel output + typed tools | text/files enabled; rich sends opt-in |
| Message lifecycle | addReaction, delivered/seen, forwardMessage, deleteMessage, undo | typed tools | ask/deny by risk |
| Directory | getUserInfo, findUser, friends, aliases, groups, context | owner/admin read tools | disabled until Phase 2 |
| Group collaboration | group info/members, groups, polls, reminders, notes | group runtime + tools | disabled until Phase 3 |
| Group administration | membership, deputies, owners, invite links, settings, block/disperse | approval-only tools | disabled |
| Account/conversation settings | profile/avatar, labels, pin/mute/archive/hidden, auto-delete/delete chat | approval-only tools | disabled |
| Quick messages/auto replies | add/update/delete/list | approval-only automation tools | disabled |
| Catalog/business | catalog/product/biz account APIs | read-first integration | disabled |
| Financial/social-impact | bank card, friend requests, block/unblock, reports, feed controls | separate product decision | deny |

## WebUI and CLI Requirements

### WebUI

- Show session state, listener state, logged-in account display name/ID, current `zca-js` version, last reconnect reason, and redacted diagnostics.
- Provide a capability matrix with disabled-by-default toggles, a concise risk explanation, and the exact permission policy in effect.
- Configure direct/group access policy, group allowlists, mention gating, bound agent, owner/admin IDs, media policy, and event retention.
- Provide read-only contact/group browsers only after directory capability is enabled; mask or minimize personal data by default.
- Provide action previews and approval history for every reviewed native Zalo operation.
- Keep QR display local-only and ephemeral; never expose session cookies in WebUI responses.

### CLI

- Keep `bestie channels zalo-personal` for login/logout/status/doctor and add explicit capability subcommands rather than an unbounded generic RPC.
- Add commands for safe diagnostics, capability list/enable/disable, group policy inspection, and a dry-run mode for action tools.
- Do not add a command that accepts arbitrary `zca-js` method names or raw payload JSON.

## Test Strategy

### Unit and Contract Tests

- Mock the typed `ZaloPersonalApi` facade per upstream method family.
- Keep JSON fixtures for direct/group message, sticker, reaction, undo, group event, quoted/replied media, and listener close/error variants.
- Assert message normalization, no self loops, de-duplication, per-thread serialization, attachment safety, prompt isolation, and no secret-bearing log output.
- Test every capability registry entry for config gating, permission category, target validation, and audit redaction.

### Integration Tests

- Use a dedicated automation account and controller account only.
- Run a manual smoke matrix after changes to `zca-js`, login, listener lifecycle, upload/download, group behavior, or high-risk API adapters.
- Cover direct messaging, sticker/reaction, media, reconnect after listener eviction, allowed/disallowed groups, mentions, action approvals, and logout/session restore.
- Never run destructive group/account/financial smoke tests against personal production chats.

## Rollout and Release Gates

1. Land one capability family per pull request or tightly scoped milestone.
2. Add config validation, unit tests, channel integration tests, docs, and WebUI representation in the same milestone.
3. Require a dedicated-account smoke result before enabling a capability by default.
4. Record compatibility with the pinned `zca-js` version. Updating that dependency requires rerunning the complete Zalo Personal contract suite.
5. If a listener or API response changes unexpectedly, fail closed for state-changing operations and retain only a redacted diagnostic event.

## Explicit Non-Goals

- No generic "call any zca-js API" tool.
- No unattended bulk contact, group, social, financial, or account-management automation.
- No group access by default, no automatic friend requests, no automated blocking/removal, and no profile changes without approval.
- No claim that this transport is official, stable, or safe from account restrictions.

## Suggested Implementation Order

1. Phase 0 transport hardening and durable ingress state.
2. Phase 1 rich messaging/reaction/lifecycle primitives.
3. Phase 2 directory/context reads and recipient resolution.
4. Phase 3 allowlisted groups and group-event routing.
5. Phase 4 polls, reminders, notes, quick messages, and auto replies.
6. Phase 5 account/conversation preferences.
7. Phase 6 business/catalog/financial surfaces only after a separate product and safety decision.
