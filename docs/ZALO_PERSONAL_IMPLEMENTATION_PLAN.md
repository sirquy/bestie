# Zalo Personal Channel Implementation Plan

## Status

Implemented as an experimental local runtime slice. It does not replace the
existing official Zalo Bot transport at `channels.zalo`. Automated coverage
verifies the local adapter, configuration, CLI lifecycle, QR/session handling,
and text/media pipeline integration; a dedicated-account live smoke test is
still required before relying on it in production.

## Decision

Add a separate, experimental channel with:

- runtime id: `zalo-personal`
- config key: `channels.zaloPersonal`
- CLI: `bestie channels zalo-personal ...`
- daemon selection: `bestie daemon ... --channel zalo-personal`
- transport dependency: exact `zca-js@2.1.2`

Do **not** overload `channels.zalo`. That channel uses a Zalo Bot token and
HTTP `getUpdates`; Zalo Personal automates a normal user account through an
unofficial WebSocket client and QR login. The authentication, lifecycle,
failure modes, terms-of-service risk, and sender identity model are different.

The name intentionally makes the risk visible. The UI and CLI must describe it
as experimental and unofficial, and warn that automation can suspend or ban an
account.

## Reference Findings

The `../openclaw` `zalouser` plugin is the useful reference, not its official
`zalo` Bot/webhook plugin.

- It pins `zca-js@2.1.2` and runs it in-process.
- QR callbacks supply a QR image plus `imei`, cookies, and user agent once
  login succeeds. Those three values restore a session with `Zalo.login(...)`.
- Inbound messages arrive from `api.listener` as direct or group events. The
  listener can emit errors or close, so a channel must own restart and cleanup.
- The library documents that only one Web listener can run for an account; a
  browser Zalo session can evict the listener.
- The reference records a callback durably before agent work, de-duplicates
  replayed message callbacks, serializes work per conversation, and reconnects
  after a listener failure.
- Its secure defaults are pairing/allowlist DMs, allowlisted groups, ID-based
  authorization, and mention gating. Bestie does not yet have pairing or a
  generic durable ingress queue, so those features cannot be copied verbatim.

The `zca-js` package is unofficial. Its QR/session behavior must be treated as
an external, volatile dependency rather than an official Zalo API contract.

## MVP Boundary

The first usable slice is a **single logged-in automation account**, owner-only
direct messages with text and supported media.

Included:

- QR login, session restore, logout, `doctor`, status, daemon lifecycle
- direct-message inbound and outbound text, chunked at 2,000 characters
- inbound image/document/audio/video download through the existing attachment
  policy/persistence pipeline, plus outbound generated images and files
- one controller user ID configured through a confirmation step
- self-message suppression, message de-duplication, per-chat serialization,
  retry/reconnect, and redacted diagnostics
- existing Bestie tools, permission reviews, memory, approvals, and response
  pipeline through a transport-specific adapter

Explicitly deferred:

- groups, pairing, open access, name-based identity matching, and multi-account
- reactions, delivery/seen acknowledgements, and streaming
- Web UI QR login flow, directory/contact search, and session cookie refresh

Deferring groups is a security boundary, not a compatibility shortcut. Group
support has different trust, routing, and mention semantics and must arrive as
a separately reviewed phase.

## Account Model

The QR-scanned account is the **automation account**. It is not the same thing
as the Bestie owner/controller.

`zca-js` labels messages sent by the logged-in account as `isSelf`; the monitor
must ignore them to avoid reply loops. Therefore a direct-message controller
needs another Zalo account that can message the automation account. Setup must
state this before login; it must not silently set `ownerUserId` to the
logged-in account returned by QR login.

Setup renders the short-lived QR directly in the local terminal and writes a
temporary `0600` PNG only as a fallback. After QR login, setup asks the
operator to send any direct message from the separate controller account to
the automation account. It resolves the sender's display name and stable Zalo
ID, shows both for confirmation, and only then stores the ID as `ownerUserId`.
The display name is only a human verification aid; authorization always uses
the confirmed stable ID. Setup must not infer the controller from the
QR-scanned account or require the operator to know an opaque Zalo ID in
advance. All other messages are ignored before any LLM, tool, memory, or
approval work.

## Configuration Contract

Add a separate schema in `src/runtime/config.ts`:

```json
{
  "channels": {
    "zaloPersonal": {
      "enabled": true,
      "sessionEnv": "BESTIE_ZALO_PERSONAL_SESSION",
      "ownerUserId": "stable-zalo-controller-id",
      "reconnect": {
        "initialDelayMs": 1000,
        "maxDelayMs": 30000
      }
    }
  }
}
```

Rules:

- `sessionEnv` is required and names an environment variable; configuration
  never contains the QR credential itself.
- Default `sessionEnv` is `BESTIE_ZALO_PERSONAL_SESSION` during setup.
- `ownerUserId` is required when enabled and accepts one stable identifier or
  an array of stable identifiers, never display names. `ownerUserId: ["*"]`
  permits every direct-message sender; it still ignores self messages and
  groups.
- Keep `reconnect` optional with conservative validated bounds. Do not make
  heartbeat or retry policies user-configurable in the initial setup wizard.
- Add group fields only in the later group phase: `groupPolicy`, `groups`,
  `groupAllowFrom`, and `requireMention`. Their safe defaults must be disabled
  or explicit allowlists, never open groups.

Do not reuse `botTokenEnv`, `pollingTimeoutSeconds`, or the existing Zalo Bot
config validator. Doing so would imply an HTTP bot token exists when this
transport instead owns a long-lived user session.

## Session and QR Login

Create `src/channels/zalo-personal/session.ts` with a narrow persisted value:

```ts
type ZaloPersonalSession = {
  version: 1;
  imei: string;
  cookie: unknown[] | { url: string; cookies: unknown[] };
  userAgent: string;
  language?: string;
  createdAt: string;
};
```

Persist this as versioned base64url JSON in the configured `.env` entry via
`writeEnvFile`. Base64url is only a robust single-line encoding, **not**
encryption. The protection remains Bestie's local `0600` `.env` file and its
existing secret-redaction rules.

Required commands:

```text
bestie channels zalo-personal setup
bestie channels zalo-personal login [--force]
bestie channels zalo-personal logout
bestie channels zalo-personal status [--connect]
bestie channels zalo-personal [--once]
```

`login` starts `Zalo.loginQR(...)` through a facade. On QR generation, use the
library callback's `saveToFile` action to write a `0600` temporary QR image below
the Bestie app directory, report only the local path, and remove it after the
login reaches a terminal state. Never print the QR payload, session JSON,
cookie, IMEI, or user agent. Handle QR expiry, decline, cancellation, timeout,
and Ctrl+C by aborting the active login and deleting the temporary image.

Once `GotLoginInfo` occurs, validate the newly stored session with a harmless
identity call before enabling the config. On `401`/`403` while restoring or
running, invalidate the in-memory API and report that the user must log in
again; do not repeatedly retry an invalid credential.

The first slice should not attempt undocumented cookie refresh. Re-login is
safer than mutating credential state based on private dependency internals.

## Transport Facade

Keep `zca-js` behind `src/channels/zalo-personal/client.ts`; application code
must not import the dependency directly elsewhere. The facade should expose
only Bestie's needs:

```ts
type ZaloPersonalClient = {
  restore(session: ZaloPersonalSession): Promise<void>;
  startLogin(callbacks: ZaloPersonalLoginCallbacks): Promise<ZaloPersonalSession>;
  getSelf(): Promise<{ id: string; displayName?: string }>;
  startListener(handlers: ZaloPersonalListenerHandlers): Promise<{ stop(): void }>;
  sendText(target: ZaloPersonalTarget, text: string, replyTo?: ZaloPersonalMessageRef): Promise<void>;
};
```

The mapper normalizes only direct text for MVP:

- `threadId`, `senderId`, `messageId`, `clientMessageId`, timestamp, and text
- a direct/group discriminator, while the monitor rejects groups in MVP
- `isSelf`, which is rejected before auth and queueing

Use quoted original-message metadata for replies when `zca-js` accepts it, but
treat it as a best-effort transport detail. Outbound text must use the shared
Bestie response controller and preserve the existing tool-activity/approval
behavior. Do not add a general-purpose Zalo account management tool in this
slice.

## Monitor, Durability, and Reconnect

Create `src/channels/zalo-personal/monitor.ts` and make it own one listener for
the configured personal session. It must:

1. Restore the saved session and validate it before listener startup.
2. Register `message`, `error`, and `closed` handlers exactly once.
3. Reject self, empty, group, and unauthorized events before agent dispatch.
4. Append a normalized inbound envelope to a local durable journal before
   calling the existing channel response/agent pipeline.
5. Serialize processing with one promise chain per `threadId`.
6. De-duplicate using a stable composite key, preferring
   `threadId + msgId + cliMsgId`; use a documented bounded fallback only when
   the library omits IDs.
7. Mark the journal record completed only after the final reply/handled result;
   leave failed work retryable with bounded retry metadata.
8. On listener error/close, stop and detach it, clear the client instance, and
   retry with exponential backoff plus jitter until aborted.
9. On daemon abort/logout, cancel retries, detach all callbacks, stop the
   listener, and wait for the active per-thread chains to settle or be recorded
   for replay.

The initial implementation uses bounded in-memory dedupe and per-thread
serialization. It prevents repeated listener callbacks from creating duplicate
responses during a running process, but it does not provide durable inbox
semantics across a crash. A focused `zalo-personal-inbox` SQLite service is a
future reliability enhancement; it must not persist raw callbacks in logs.

## CLI, Daemon, Doctor, and UI Integration

Changes by module:

| Area | Required change |
| --- | --- |
| `src/channels/registry.ts` | Add `ZALO_PERSONAL_CHANNEL`; it is listener-based, supports text/media, tool activity, and approvals. |
| `src/cli/commands/zalo-personal.ts` | Implement login/setup/logout/status/monitor commands and narrow terminal QR surface. |
| `src/cli/commands/channels.ts` | Register `zalo-personal` without changing the `zalo` command. |
| `src/cli/commands/daemon.ts` | Add `zalo-personal` as an independently managed daemon channel. |
| `src/runtime/config.ts` | Validate `channels.zaloPersonal` independently from `channels.zalo`. |
| `src/runtime/doctor.ts` | Check config/session presence; with `--connect`, restore and query self identity. Never print session values. |
| `src/ui/api/channels.ts`, `src/ui/server.ts`, `web/src/features/channels/` | Show status and daemon controls. Add QR login only after a CLI flow is proven; local UI actions require its existing unlock, CSRF, and explicit confirmation. |
| `src/channels/zalo-personal/*` | Own client facade, session codec, mapper, outbound adapter, monitor, and tests. |
| `package.json`, lockfile | Add exact `zca-js@2.1.2` and record the resolved integrity. |

The current `src/channels/zalo.ts` remains the official Zalo Bot transport.
Do not copy it and replace its HTTP client; extract only genuinely shared,
transport-neutral helpers if duplication is proven while implementing tests.

## Security and Privacy Requirements

- Display an explicit unofficial-automation/account-risk warning at setup and
  status; do not market it as official Zalo support.
- Keep all session material in `.env`, redact it from errors/transcripts/logs,
  and remove it on logout.
- Use stable numeric/string user and thread IDs for authorization. Never accept
  a mutable display name as an access-control identity.
- Default to one exact controller account and direct messages only.
- Ignore self messages. Do not provide a bypass that lets a logged-in account
  execute messages it sent itself.
- Preserve Bestie's existing tool permission gates and owner-only approval
  commands. A Zalo Personal sender cannot approve an action unless it is the
  configured controller ID.
- Rate-limit reconnect attempts and outbound error notifications to prevent
  account activity storms.
- Hash or omit account, sender, thread, and message identifiers in logs; never
  log message bodies or raw callbacks.
- QR images are sensitive short-lived credentials. Restrict them to a `0600`
  local file, delete them deterministically, and never serve them remotely.

## Phased Delivery

### Phase 1: Direct-message MVP

1. Add the exact dependency and facade with fake-client tests.
2. Add session codec, `.env` integration, QR login, logout, and connect probe.
3. Add config/registry/CLI/daemon/Doctor wiring.
4. Add text/media mapping, a 2,000-character chunked text sender, owner-only
   dispatch, and existing Bestie attachment/response adapter integration.
5. Add dedupe, per-thread serialization, listener cleanup, and reconnect
   backoff.
6. Document operation and run a dedicated non-primary Zalo account smoke test.

### Phase 2: Controlled group support

Only after Phase 1 is stable in daily use:

1. Add `groupPolicy: disabled | allowlist` with default `disabled`.
2. Support only explicit group IDs and controller/sender allowlists.
3. Require a mention by default; replying to a prior Bestie message may count
   as an explicit activation only after a test proves the metadata is stable.
4. Accumulate ignored group context only if a bounded, privacy-reviewed history
   policy is implemented.
5. Add group-specific tests for route access, sender access, mention gating,
   duplicate handling, and approval authorization.

### Phase 3: Operator UX

The pinned `zca-js@2.1.2` attachment API is now mapped through Bestie's
existing attachment policy/persistence pipeline. Consider local UI QR
status/start, directory search, reactions, and delivered/seen events only after
the dedicated-account smoke test proves text and media are stable. Each action
remains optional and must be rate-limited.

## Acceptance Tests

Unit and integration tests must cover:

- config rejects missing `sessionEnv` or owner ID for an enabled channel
- session encode/decode, schema version rejection, logout removal, no secret in
  diagnostic/error text
- QR generated/scanned/expired/declined/cancelled/success transitions and temp
  file cleanup
- client facade maps direct text, group text, empty content, and self events
- unauthorized, group, and self messages never reach LLM/tool/memory code
- one authorized text event produces a quoted/chunked final response
- duplicate event callbacks do not produce a second response
- different threads can progress independently while one thread stays ordered
- duplicate callbacks do not produce a second response during one listener run
- listener `error`/`closed` reattaches with bounded backoff; abort/logout leaves
  no active callback/listener/timer
- Doctor distinguishes missing session, expired session, and reachable account
- daemon/status/UI show `zalo` and `zalo-personal` as distinct channels

The live smoke test must use a dedicated non-primary automation account and a
separate controller account. Verify QR login, daemon restart/session restore,
one inbound direct message, one reply, controlled listener interruption and
reconnect, logout, and inability to restore after logout. Never include
credentials or QR data in fixtures or test transcripts.

## Go/No-Go Criteria

Proceed only if the owner accepts the unofficial-account risk and can test with
a dedicated automation account. Do not ship an “open” or group-enabled variant
before Phase 2. If `zca-js` changes its QR/session/listener contract, pause
implementation, re-inspect the exact pinned package, and update the facade and
tests before upgrading the dependency.
