# Bestie Web UI Cloudflare Tunnel Spec

## Purpose

Allow an owner to reach their local Bestie Web UI from another device through a stable random URL such as:

```text
https://swift-otter-3a3s.bestieagent.cloud
```

The implementation uses Cloudflare Tunnel so the owner's device keeps an outbound-only connection. It must never require opening an inbound port, binding the local UI to a public interface, or exposing the owner machine directly to the Internet.

This spec is a future hosted-infrastructure milestone. The existing `bestie ui` local-only behavior remains the default and is not weakened by this feature.

## Product Decisions

- Provider: Cloudflare Tunnel.
- Domain: `bestieagent.cloud`, with a Cloudflare-managed wildcard DNS record for `*.bestieagent.cloud`.
- URL shape: one random opaque subdomain per Bestie installation, issued by the control plane. User names, owner names, device names, sequential IDs, and predictable slugs must not appear in the hostname.
- URL lifetime: the hostname persists until the owner explicitly revokes it.
- `stop` disables remote reachability while retaining the hostname mapping for a later `start`.
- An offline connector must show an edge-hosted offline response and must not proxy to a stale or unrelated local service.
- `revoke` permanently removes the mapping and remote-access credential. It is intentionally destructive and requires confirmation.
- Local UI unlock remains mandatory. A tunnel must not bypass the six-digit UI PIN, `HttpOnly` session cookie, CSRF validation, same-origin rules, tool permission policy, or approval flows.
- Remote tunnel access is single-owner only in this milestone. It is not a hosted SaaS account system or a multi-user sharing feature.

## User Experience

The first remote setup should be explicit and short:

```text
bestie ui tunnel setup
  -> explain that Bestie will create a private remote URL
  -> register the authenticated BestieAgent instance
  -> create one managed tunnel and random hostname
  -> print the remote URL and privacy warning
```

Day-to-day commands:

```bash
bestie ui tunnel start
bestie ui tunnel status
bestie ui tunnel stop
bestie ui tunnel revoke
```

Expected human output:

```text
[TUNNEL] Remote Bestie UI is online.
URL: https://swift-otter-3a3s.bestieagent.cloud
Protection: Bestie PIN required
Stop: bestie ui tunnel stop
Revoke this URL: bestie ui tunnel revoke
```

The Web UI Settings page may later show the hostname, online/offline state, last connector heartbeat, copy-URL action, stop action, rotate action, and revoke action. It must never show Cloudflare API tokens, tunnel credentials, service tokens, or connector private keys.

## Scope

In scope:

- Cloudflare-managed named tunnel lifecycle for the Bestie UI.
- Stable random subdomain under `bestieagent.cloud`.
- Outbound local `cloudflared` connector lifecycle, health checks, reconnect behavior, and redacted logs.
- Edge-hosted offline behavior when no active connector is available.
- Remote origin support for the assigned HTTPS hostname without trusting arbitrary forwarded headers.
- CLI setup/start/status/stop/rotate/revoke commands.
- Doctor checks for local connector availability, local config, credential presence, assigned hostname, and active tunnel health where an explicit network check is requested.
- Focused tests for command parsing, config validation, origin validation, lifecycle state transitions, credential redaction, and an opt-in integration smoke against a controlled Cloudflare account.

Out of scope:

- Self-hosted relay, custom WebSocket proxy, or Bestie-operated edge infrastructure.
- A public listener, port forwarding, router setup, or LAN exposure.
- Multi-user identity, teams, invitation links, public sharing, OAuth login, or access policies supplied by a hosted Bestie account.
- Bypassing the local UI PIN, remote PIN auto-fill, or a weaker tunnel-specific auth path.
- Forwarding arbitrary TCP services, terminal shells, raw SQLite files, local filesystem browsing, or any route besides the Bestie Web UI.
- Cloudflare Access as a required first-run dependency. It can be evaluated as an optional additional edge control later.
- Automatic tunnel enablement during onboarding or service install.

## Architecture

```text
Remote browser
  -> HTTPS https://<random>.bestieagent.cloud
  -> Cloudflare edge and named tunnel routing
  -> cloudflared connector on owner device (outbound-only)
  -> http://127.0.0.1:<ui-port>
  -> Bestie UI server and existing UI Local Unlock
```

The connector must target exactly the loopback UI address chosen by Bestie. It must not accept an arbitrary URL supplied in config or CLI flags.

The local UI server remains bound to `127.0.0.1` or `localhost`. Cloudflare Tunnel reaches it through the local connector; `bestie ui --host 0.0.0.0` remains disallowed.

Cloudflare owns public DNS, TLS termination, edge routing, and the outbound tunnel transport. Bestie owns local UI authentication, authorization, tool approvals, application session state, and user-data privacy.

## Cloudflare Prerequisites

The production operator must provision:

1. A Cloudflare account controlling `bestieagent.cloud`.
2. A proxied wildcard DNS route for `*.bestieagent.cloud`, or an equivalent Cloudflare API flow that creates hostname routes per tunnel.
3. A least-privilege Cloudflare API/service credential limited to the required zone and tunnel lifecycle operations.
4. A documented credential distribution model. Initial development may use an operator-controlled account; production must not embed a broad Cloudflare API token in the npm package or local Bestie config.
5. `cloudflared` installed locally, bundled through a verified installer, or downloaded from an authenticated release source with checksum verification. Bestie must report the detected version and executable path without executing a shell command.

The operator's Cloudflare credential is infrastructure secret material. It must live outside the user-facing `config.json`, never appear in CLI output, and never be included in diagnostics, exports, logs, chat context, or UI API responses.

## Local State And Secrets

Non-secret local state belongs under `~/.bestie/data/`, for example:

```json
{
  "version": 1,
  "controlPlaneUrl": "https://tunnel.bestieagent.com",
  "deviceId": "bestie-local-public-id",
  "instanceId": "ins_opaque",
  "tunnel": {
    "id": "tun_opaque",
    "hostname": "swift-otter-3a3s.bestieagent.cloud",
    "status": "OFFLINE"
  },
  "createdAt": "2026-08-09T00:00:00.000Z",
  "lastStartedAt": null,
  "lastConnectedAt": null
}
```

Credentials must remain separate from this record:

- Instance token: returned once by `POST /v1/instances/register`, stored in owner-only local secret storage as `BESTIE_TUNNEL_INSTANCE_TOKEN`.
- Cloudflared run token: returned by `/v1/tunnels/{tunnelId}/launch-credential` only at connector start, held in memory only, passed to `cloudflared`, then discarded.
- Any identifier that Cloudflare treats as a bearer credential is a secret and must be redacted.
- Revoking a tunnel removes Bestie state, stops the connector, deletes the local instance token, and asks the control plane to disable the named tunnel/hostname route.

The random hostname is sensitive metadata. It may appear in owner-facing CLI/UI status and redacted operational logs, but it must not be sent to LLM prompts, public telemetry, or unrelated channel transcripts by default.

## CLI Contract

### `bestie ui tunnel setup`

- Requires explicit interactive confirmation before creating external Cloudflare resources.
- Validates `cloudflared`, local UI prerequisites, Cloudflare operator configuration, and the wildcard zone configuration.
- Registers an instance and creates a managed tunnel/random hostname route through `https://tunnel.bestieagent.com`.
- Does not start the connector unless the owner confirms a follow-up start prompt or passes `--start`.
- Must be idempotent when an active non-revoked tunnel record already exists; it should display the assigned hostname instead of silently issuing a second URL.

### `bestie ui tunnel start`

- Requires a configured, non-revoked tunnel record.
- Obtains a one-time launch credential in memory, then starts `cloudflared` as a managed child process.
- Restores the existing hostname. It must not allocate a new hostname.
- Records redacted lifecycle logs and connector PID/state without secrets.
- Uses bounded reconnect/backoff behavior. A connector crash must not spin or restart forever.

### `bestie ui tunnel status`

- Reports hostname, configured state, local connector state, last successful connection timestamp, and whether the local UI listener is reachable.
- Reports Cloudflare edge reachability only with an explicit `--connect` network check.
- Does not expose tunnel credential values, Cloudflare API values, headers, or internal routes.

### `bestie ui tunnel stop`

- Stops the connector and any tunnel-owned UI process.
- Keeps the hostname and Cloudflare mapping so `start` restores the same URL.
- Does not delete the instance token or UI Local Unlock PIN.

### `bestie ui tunnel revoke`

- Requires explicit confirmation and repeats the visible hostname in the prompt.
- Stops the connector, deletes the Cloudflare route/tunnel, removes local credential material and local state, and invalidates any tunnel-specific origin allowlist entry.
- Is irreversible from Bestie's perspective. A later setup creates a new hostname.

## Origin, Cookies, And Request Trust

The current local UI has a same-origin CSRF policy. Tunnel support must extend that policy without making it permissive.

Allowed browser origins are:

- Local mode: `http://127.0.0.1:<port>` and `http://localhost:<port>` only.
- Tunnel mode: exactly `https://<assigned-random-hostname>.bestieagent.cloud`.

Rules:

- Never accept a wildcard browser origin such as `https://*.bestieagent.cloud` at the local application server.
- Never infer the public hostname or scheme from untrusted client-supplied `X-Forwarded-*`, `Forwarded`, `Host`, or `Origin` headers.
- The local connector must attach an authenticated, non-forgeable request marker before Bestie treats a request as tunnel traffic. The marker design must be validated against Cloudflare's documented tunnel headers and origin behavior before implementation.
- The local UI server must maintain a narrow, configured origin policy built from its own loopback listener plus the assigned hostname. A request is accepted only when its origin matches one of those exact origins.
- Remote mode must use `Secure` in addition to existing `HttpOnly`, `SameSite=Strict`, and scoped cookie attributes. Local HTTP mode must retain a local-compatible cookie strategy without accidentally weakening remote cookies.
- PIN setup/login, logout, change-PIN, CSRF, session expiry, idle-lock, tool permission gates, approvals, and memory governance must have identical or stricter behavior through the tunnel.
- Browser cookies must never be reused across unrelated assigned hostnames after `revoke` and a later new setup.

## Security Controls

- Tunnel activation is opt-in and never enabled by default.
- The remote hostname is random, non-enumerable, and persistent only until owner revoke; it is not an authentication factor.
- UI Local Unlock remains required for every remote browser session.
- The edge must force HTTPS and redirect or reject HTTP according to Cloudflare configuration.
- Edge rate limits must protect PIN setup/login routes by hostname and client IP. The initial policy should be conservative and documented alongside the Cloudflare configuration.
- Do not expose an unauthenticated remote API health/config endpoint. The local server may expose a narrow connector-only health route if Cloudflare requires it; it must return no user data and be unreachable through public browser routing.
- Edge offline response must contain no owner identity, hostname history, Bestie config, local IP, connector error details, or credential hints.
- Remote requests are untrusted external input. They must not gain elevated tool permission, trusted-read status, filesystem access, or approval authority solely because they came through the assigned hostname.
- Do not add broad CORS headers. Same-origin fetches are sufficient.
- Logs include state transitions, hostname, timestamps, and sanitized Cloudflare error categories only. They exclude auth headers, cookies, tokens, request bodies, chat/memory data, and connector credential paths when those paths contain user identifiers.
- Doctor and status report secret presence/absence only.

## Offline And Failure Behavior

| Condition | Expected behavior |
| --- | --- |
| Owner stops tunnel | Cloudflare URL serves a generic offline response; local UI remains available on loopback. |
| Device sleeps or loses network | Connector reconnects with capped backoff; edge serves offline response until it reconnects. |
| `cloudflared` missing | Start fails before remote exposure and gives verified install/setup guidance. |
| Local UI unavailable | Connector does not proxy to another service; status reports local listener failure. |
| Cloudflare credential invalid | Setup/start fails with a sanitized error; local UI remains unaffected. |
| Hostname route conflict | Fail closed; never attach a tunnel to an unverified hostname. |
| PIN failures or auth rate limit | Existing UI Local Unlock protections apply; edge rate limits provide a second layer. |
| Revoke partially fails | Keep local connector stopped and state marked `revoke_pending`; Doctor provides retry guidance. |

## Runtime Module Boundaries

Proposed modules:

```text
src/ui/tunnel/
  cloudflare-client.ts       Cloudflare API adapter and typed sanitized errors
  cloudflared.ts             verified executable discovery and managed connector process
  state.ts                   local non-secret tunnel state read/write/validation
  lifecycle.ts               register/setup/start/status/stop/revoke orchestration
  origin-policy.ts           exact local and assigned remote origin validation
  doctor.ts                  focused tunnel diagnostic checks
  types.ts                   provider-neutral tunnel interfaces

src/cli/commands/ui.ts       thin `bestie ui tunnel ...` argument handling
src/cli/command-specs.ts     declarative nested UI tunnel command registration
src/ui/server.ts             consumes exact origin policy; does not manage Cloudflare lifecycle
```

The Cloudflare adapter must be replaceable at a future provider boundary, but this milestone should not build a generic multi-provider tunnel marketplace.

## Config Model

The initial application config may store only non-secret opt-in preferences:

```json
{
  "ui": {
    "tunnel": {
      "provider": "cloudflare",
      "enabled": false
    }
  }
}
```

Hostname, tunnel ID, lifecycle state, and timestamps live in local tunnel state under `~/.bestie/data/` rather than broadly edited user config. Cloudflare credentials remain outside `config.json` and must be represented by secret references or protected connector files.

The exact config schema must not be added until the Cloudflare credential ownership model is chosen and tested.

## Doctor Checks

When tunnel configuration exists, Doctor should check:

- `cloudflared` exists, has a supported version, and resolves to the expected executable.
- Tunnel state file is valid and owner-only readable.
- Assigned hostname has the expected `bestieagent.cloud` suffix and safe random format.
- Instance credential exists without printing it; launch credential is never persisted.
- Local UI listens only on loopback.
- Stored remote origin is exact and matches assigned hostname.
- Existing UI Local Unlock is configured before tunnel start.
- Connector process state and most recent sanitized failure.
- `bestie doctor --tunnel-connect` performs explicit edge/connector health checks; normal Doctor must not make external requests.

Safe fixes may stop a stale local connector or repair owner-only directory permissions. They must not create Cloudflare resources, revoke URLs, or modify remote DNS without explicit owner confirmation.

## Validation

Unit and contract tests:

- Random hostname generation has sufficient entropy and approved character format.
- Hostname state persists across stop/start and is removed only on revoke.
- Config/state parser rejects unexpected provider, foreign hostname, wildcard hostname, missing timestamps, or credential values in non-secret state.
- Origin policy allows only exact loopback origins and the currently assigned HTTPS hostname.
- Origin policy rejects arbitrary subdomains, spoofed `X-Forwarded-*`, HTTP remote origins, and stale hostnames after revoke.
- Session cookies are `Secure` for tunnel requests and retain `HttpOnly`/`SameSite=Strict`.
- Tunnel state transitions fail closed and do not leak connector credentials to logs/errors.
- Stop preserves hostname state; revoke removes it.

Local smoke:

```bash
npm run smoke:ui
npm run smoke:ui:browser
npm run smoke:tunnel
```

`smoke:tunnel` must use a fake Cloudflare client and fake `cloudflared` process by default. It validates CLI lifecycle, local state, origin policy, offline behavior, and redaction without creating external resources.

Opt-in integration smoke:

```bash
npm run smoke:tunnel:cloudflare
```

This command requires an explicitly supplied dedicated Cloudflare test account, test zone, and short-lived test credentials. It must create a disposable tunnel/hostname, confirm HTTPS Web UI access, verify UI PIN/auth/CSRF plus SSE chat streaming through the route, stop/restart persistence, revoke, and cleanup. It must never use a production owner tunnel or print credentials.

## Acceptance Criteria

- `bestie ui` continues to bind only loopback and works without any Cloudflare setup.
- Tunnel setup is explicit, creates one opaque random hostname, and does not print secrets.
- Stop/start retains exactly the same hostname until revoke.
- Revoke prevents future access through the old hostname and removes local credentials/state.
- Public traffic reaches only the Bestie UI through an outbound connector; no inbound local port is opened.
- The remote hostname uses HTTPS and remote UI access still requires the six-digit PIN.
- Existing session, CSRF, idle-lock, change-PIN, tool permission, and approval behavior pass through the tunnel without downgrade.
- Exact tunnel origin validation rejects spoofed forwarded headers and unrelated subdomains.
- Offline, reconnect, Cloudflare API, and credential failures fail closed and do not expose sensitive detail.
- Doctor, status, unit tests, local fake-provider smoke, and opt-in Cloudflare integration smoke provide actionable evidence.

## Delivery Order

1. Define operator credential ownership and Cloudflare API boundary; provision a dedicated test zone.
2. Add typed tunnel state, random hostname generator, fake Cloudflare client, and lifecycle unit tests.
3. Add exact UI origin policy and secure-cookie tunnel mode with server tests.
4. Add verified `cloudflared` discovery plus managed local connector lifecycle.
5. Add CLI `setup/start/status/stop/revoke` and Doctor diagnostics.
6. Add local fake-provider smoke and redaction tests.
7. Add controlled Cloudflare integration smoke for HTTPS, UI auth/CSRF, SSE, stop/start, and revoke.
8. Add optional Web UI status/control surface only after CLI lifecycle and Doctor are proven.

## Current Local Foundation

The repository now has a development foundation under `src/ui/tunnel/`:

- typed client requests to the production OpenAPI control plane;
- persistent local device ID and non-secret URL metadata under `~/.bestie/data/ui-tunnel.json`;
- instance token storage in `.env`; on-demand launch token remains memory-only;
- `bestie ui tunnel setup|status|start|stop|revoke` commands;
- `cloudflared tunnel run --token ...` launched without a shell, using a verified executable and local log file.

This foundation includes exact UI origin/cookie policy for the active assigned hostname: remote requests require the exact HTTPS origin and matching host, forwarded headers are ignored, and remote session cookies use `Secure` in addition to existing cookie protections. Remote requests now fail closed unless `Cf-Access-Jwt-Assertion` validates as an RS256 Cloudflare Access token against the configured team JWKS, issuer, audience, and time claims. It does not yet verify a real Cloudflare account, create production hostname routes, provide edge offline handling, prove the configured Access application with a live Cloudflare connector, or start the loopback Web UI automatically. Those controls remain required before remote access can be claimed as working.

For a configured remote deployment, `.env` must contain non-public Access metadata:

```bash
BESTIE_TUNNEL_ACCESS_TEAM_DOMAIN=https://your-team.cloudflareaccess.com
BESTIE_TUNNEL_ACCESS_AUD=cloudflare-access-application-audience-tag
```

These are not bearer secrets, but they must be configured only from the Cloudflare Access application created for the assigned hostname. The server retrieves signing keys from `${BESTIE_TUNNEL_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`; it does not trust Access headers without verifying their JWT signature.

## Open Questions Before Code

- Who owns and provisions the Cloudflare API credential in production: Bestie operator service, a user-supplied Cloudflare account, or a managed backend?
- Which Cloudflare documented mechanism will provide a connector-authenticated marker that the local UI can trust without trusting public forwarded headers?
- Does the remote edge show a generic offline page through Cloudflare configuration, Worker, Access, or another supported route mechanism?
- What are the exact edge rate-limit thresholds for PIN routes, including IPv6 and retry behavior?
- Is Cloudflare Access offered as optional second-factor/device identity after the first tunnel milestone, and how does it coexist with Bestie's local PIN UX?
- What retention period and access controls apply to infrastructure-only hostname/lifecycle audit events?