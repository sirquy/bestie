# Bestie Backup And Restore Spec

## Status

Later milestone. This document specifies a local-first backup and restore system for Bestie. It does not change the currently shipped runtime.

## Source Of Truth And Scope

When requirements conflict, use the latest user instruction, then `PROJECT.md`, then `docs/IMPLEMENTATION_PRIORITY.md`, then this document.

This slice delivers encrypted, portable backups for a local Bestie installation. It protects character data, configuration, local SQLite state, skills, Agent Workforce data, cron data, and selected operational metadata. It is not hosted sync, multi-device conflict resolution, Zep backup, arbitrary workspace backup, or a plugin marketplace feature.

## Goals

- Recover a broken Bestie installation without manually rebuilding configuration and local data.
- Create a consistent SQLite snapshot while Bestie may be running.
- Keep backups encrypted at rest and safe to store on a remote repository.
- Make secret inclusion explicit and conservative.
- Support pre-update and pre-migration safety backups.
- Make restore inspectable, staged, verified, and hard to perform accidentally.
- Work on Windows, macOS, and Linux without requiring shell-specific backup scripts.

## Non-Goals

- Backing up arbitrary user workspaces, external paths, browser state, or files accessed through tools.
- Including raw attachments, temporary downloads, caches, PID files, daemon locks, or `dist/` artifacts by default.
- Automatically restoring in place.
- Exporting or printing API keys, tokens, backup passphrases, or raw `.env` contents.
- Replacing normal memory export/import or character-only export flows.
- Requiring a cloud provider. A local disk repository must work.

## Design Decision

Use [Restic](https://restic.net/) as the backup engine. Bestie invokes a discovered Restic executable using structured process arguments, never a shell command string.

Reasons:

- client-side authenticated encryption and deduplicated incremental snapshots
- repository integrity checking and retention policies
- portable repositories for local directories, SFTP, S3-compatible stores, Backblaze B2, and similar backends
- mature cross-platform binary support

The Bestie process owns input staging, manifest creation, policy enforcement, Restic invocation, redacted logging, and restore validation. Restic owns encrypted content storage and snapshot indexing.

## Terminology

- **Repository:** A Restic destination holding encrypted snapshots.
- **Snapshot:** One Restic point-in-time backup identified by its Restic snapshot ID.
- **Staging directory:** A newly created temporary or user-selected directory used to prepare a backup or restore before it affects live data.
- **Secret-inclusive backup:** A backup that includes `.env`; it remains Restic-encrypted but requires explicit command input and approval.
- **Portable backup:** A normal backup excluding `.env`, suitable for moving the agent to another machine after entering new credentials.

## User Outcome

An owner can configure one encrypted Restic repository, create and inspect backups, verify repository health, and restore a selected snapshot to a staging directory. They can then review it and explicitly apply it while Bestie is stopped.

## CLI Contract

Register a thin `src/cli/commands/backup.ts` command handler through `src/cli/command-specs.ts`. Reusable behavior belongs in `src/runtime/backup`.

```text
bestie backup configure
bestie backup status
bestie backup create [--reason <text>] [--include-secrets] [--keep]
bestie backup list [--limit <n>] [--json]
bestie backup verify [--read-data]
bestie backup restore <snapshot-id> [--staging-dir <path>] [--include-secrets]
bestie backup apply <staging-dir> [--replace] [--include-secrets]
bestie backup prune [--dry-run]
```

### `configure`

Interactive-only setup. It collects:

1. repository type and repository address/path
2. repository credential env-var names, never credential values in config
3. Restic password env-var name
4. retention values
5. whether scheduled backups are enabled later

The command validates that configured env-var names are syntactically safe. It checks whether `restic` is available and runs `restic snapshots` or `restic init` only after explicit confirmation. The command writes no secret values to `config.json`.

### `status`

Read-only. Reports:

- whether backup config exists and is valid
- Restic executable discovery result and version, when available
- repository reachability without printing repository credentials
- latest snapshot time, ID prefix, reason, and whether it includes secrets
- retention policy and next scheduled run when scheduling exists
- actionable safe fixes for missing executable, missing env vars, or inaccessible repository

### `create`

Creates a snapshot from a freshly staged backup bundle.

- `--reason` is a short user-visible audit label; cap at 256 characters and redact secret-like text.
- `--include-secrets` is opt-in and requires explicit confirmation. Without it, `.env` is excluded.
- `--keep` adds a `bestie:keep=true` snapshot tag for manual retention.
- Automatically tag snapshots with `bestie:version`, `bestie:backup-format=1`, platform, and UTC timestamp.
- Return snapshot ID prefix and a count/size summary without disclosing sensitive paths or values.

### `list`

Shows Bestie-tagged snapshots only by default. Each row includes snapshot ID prefix, creation time, host, reason, format version, and secret inclusion flag. `--json` must use the existing redacted JSON output conventions.

### `verify`

Runs `restic check` by default. `--read-data` additionally runs a bounded subset verification if Restic supports it; a full repository data read is intentionally a separate future option because it may be expensive. Never report repository credentials in errors.

### `restore`

Restores a snapshot only into a newly created staging directory. It must refuse a non-empty target and refuse `~/.bestie`, the live app directory, or any ancestor/descendant of it.

After Restic restore, Bestie validates `manifest.json`, verifies hashes, checks the backup format version, checks configuration schema, and runs SQLite integrity checks against the restored database. It prints the staging path and the next `apply` command. It does not modify the live installation.

`--include-secrets` is required to materialize a `.env` contained in a secret-inclusive snapshot. Without it, restore omits `.env` even if it exists in the selected snapshot.

### `apply`

Applies a previously validated restore staging directory to the live Bestie app directory.

Requirements:

- explicit interactive confirmation containing the exact live app path
- service/daemon/UI processes must be stopped; do not stop them automatically in v1
- create a fresh pre-apply backup unless `--replace` is explicitly confirmed after backup failure is reported
- atomically rename the existing app directory into an adjacent rollback directory when the filesystem supports it
- copy/rename the restored application state into place only after all validation succeeds
- preserve live `.env` unless both the staging directory contains it and `--include-secrets` is supplied
- leave the rollback directory in place and print its path; do not delete it automatically
- run `bestie doctor` advice after apply, but do not auto-fix without separate confirmation

`apply` is intentionally separate from `restore` so a user can inspect staged files before overwriting local state.

### `prune`

Runs Restic forget/prune for Bestie-tagged snapshots using configured retention. It is destructive and always first prints a dry-run result. `--dry-run` is default behavior; a future explicit `--apply` is required to delete snapshots. Repositories shared with other applications must be rejected unless the user confirms an advanced override during configuration.

## Configuration

Extend `AppConfig` with optional backup configuration. Config stores only endpoint metadata and environment variable names; it never stores passphrases, API keys, access keys, or repository credentials.

```json
{
  "backup": {
    "enabled": true,
    "provider": "local",
    "repository": "D:/BestieBackups/restic",
    "passwordEnv": "BESTIE_RESTIC_PASSWORD",
    "credentialsEnv": [],
    "retention": {
      "daily": 7,
      "weekly": 4,
      "monthly": 12
    },
    "schedule": {
      "enabled": false,
      "cron": "30 2 * * *"
    }
  }
}
```

Supported initial providers:

- `local`: absolute local repository path
- `sftp`: Restic SFTP repository string; credentials by SSH agent/key reference outside `config.json`
- `s3`: S3-compatible repository string; access credentials referenced through `credentialsEnv`
- `b2`: Backblaze B2 repository string; credentials referenced through `credentialsEnv`

Validation rules:

- `repository` must be a valid provider-specific repository value and must not contain a password-like URL userinfo segment.
- `passwordEnv` and all `credentialsEnv` values must be safe environment variable names.
- retention values are integers from `0` to `3650`; at least one is positive.
- scheduling is disabled by default and must not create a cron schedule until a later scheduler integration is explicitly approved.
- no provider has an implicit cloud default.

## Data Set

Create a staging root containing only the following paths:

```text
manifest.json
config.json
character.json
system-prompt.md
skills/
data/memory.sqlite
data/agents/                 (if used by workforce implementation)
data/cron/                   (if used outside SQLite in a future migration)
metadata/backup-info.json
.env                         (only when --include-secrets was approved)
```

The implementation must derive actual paths from `RuntimePaths` and existing module ownership rather than hardcode a home directory. SQLite already contains current memory, messages, pending approvals, knowledge graph, cron, and workforce records; do not duplicate it into separate exports.

Exclude by default:

```text
logs/
workspace/
attachments and temporary downloads
*.lock
daemon-*.json
ui/tunnel runtime state and temporary credentials
node_modules/
dist/
```

Installed skills are included because they shape assistant behavior. Remote skill library caches are excluded; they can be safely rebuilt. Log backup is a future optional diagnostic feature with its own retention policy.

## Consistent SQLite Snapshot

Never pass the live `memory.sqlite` file directly to Restic while SQLite may be writing WAL data.

1. Create an owned temporary staging directory with restrictive permissions.
2. Open the live database through the project SQLite dependency.
3. Use SQLite's online backup API or `VACUUM INTO` with a bound/generated destination to write `data/memory.sqlite` inside staging.
4. Close the database, then run `PRAGMA integrity_check` on the snapshot.
5. Include only the validated snapshot in the Restic input.
6. Remove the temporary staging directory in a `finally` path even when Restic fails.

The backup command may briefly acquire SQLite resources but must not stop message channels. If snapshot creation reports `SQLITE_BUSY`, retry with bounded exponential backoff, then fail with an actionable message. Do not fall back to copying the live database file.

## Manifest And Format Compatibility

`manifest.json` is required in every backup and is not secret. Proposed format:

```json
{
  "formatVersion": 1,
  "createdAt": "2026-08-12T00:00:00.000Z",
  "bestieVersion": "0.1.47",
  "platform": "win32",
  "includesSecrets": false,
  "files": [
    { "path": "config.json", "sha256": "..." },
    { "path": "data/memory.sqlite", "sha256": "..." }
  ]
}
```

Rules:

- calculate SHA-256 after staging and before Restic backup
- reject unknown future `formatVersion` values during restore
- permit older supported formats through explicit migrations inside `src/runtime/backup/migrations.ts`
- never downgrade a live config/database schema automatically
- use `metadata/backup-info.json` for diagnostic details that do not belong in the stable manifest contract

## Security And Permissions

Backup data can contain private memories, channel transcripts, owner identifiers, skills, MCP settings, and optionally secrets. It is therefore a privileged feature.

### Secrets

- Portable backups exclude `.env` by default, matching `PROJECT.md`.
- Secret-inclusive backup and restore require an explicit CLI flag plus interactive confirmation.
- The Restic passphrase must be supplied through an environment variable named by config. Bestie never prompts for it in a way that echoes it and never writes it to logs/config.
- Errors, manifests, JSON, and audit logs must redact secrets and must not list raw `.env` values.
- Backup metadata may report `includesSecrets: true|false`, but never secret names or values beyond configured env-var names already visible in config.

### Permission categories

- `backup status`, `list`, and `verify`: read operations; local repositories are trusted reads, remote checks require owner approval unless explicitly configured as trusted.
- `backup create`: `local_write` plus remote write when the repository is remote; always require owner confirmation in v1.
- `backup restore`: `local_write`; always require owner confirmation.
- `backup apply` and `backup prune`: destructive; always require owner confirmation and cannot be configured to auto-allow in normal channel operation.
- Future Agent tools must use the same permission gate and must not call Restic through `internal.exec`.

### Agent boundary

Do not add Agent backup tools in the first implementation slice. The Agent may explain backup status through normal CLI/UI data, but `create`, `restore`, `apply`, and `prune` require direct owner CLI/UI initiation until the approval UX has recovery-oriented previews and typed confirmations.

## Runtime Architecture

Keep command files thin and place reusable logic in a new `src/runtime/backup/` directory:

```text
src/cli/commands/backup.ts             CLI parsing and user output
src/runtime/backup/types.ts            stable input/output contracts
src/runtime/backup/config.ts           config validation and env resolution
src/runtime/backup/restic.ts           executable discovery and structured Restic calls
src/runtime/backup/staging.ts          curated staging bundle and cleanup
src/runtime/backup/sqlite-snapshot.ts  consistent SQLite snapshot + integrity check
src/runtime/backup/manifest.ts         manifest creation and validation
src/runtime/backup/service-state.ts    detects active Bestie service/daemons for apply
src/runtime/backup/restore.ts          staging restore, validation, and apply/rollback
src/runtime/backup/retention.ts        snapshot tags and forget/prune planning
src/runtime/backup/index.ts            orchestration façade
```

Integrations:

- `src/runtime/paths.ts`: add only explicit backup staging/rollback path helpers if needed; do not expand `RuntimePaths` with remote credentials.
- `src/runtime/config.ts`: validate the optional `backup` section and migrate config versions safely.
- `src/runtime/doctor.ts`: check Restic availability, backup config, required env-var presence, repository reachability when requested, and latest snapshot age. Doctor fixes must not initialize a repository, upload data, or restore data.
- `src/cli/commands/update.ts`: create a portable pre-update backup before any package/config/database mutation once backup is configured; if backup fails, halt the update unless the user explicitly chooses an unsafe override.
- `src/cron`: a later integration may schedule `backup create`; it must use a dedicated system-owned schedule and the same retention/permission rules, not a model-generated tool call.
- `src/ui/api`: later UI support can expose status, list, and verify first. Create/restore/apply must present clear privacy and destructive-action confirmation screens.

## Restic Invocation Contract

Use `spawn`/`execFile` with an argument array and `windowsHide: true`. Do not set `shell: true`.

Expected operations:

```text
restic -r <repository> snapshots --tag bestie:backup-format=1 --json
restic -r <repository> backup <staging-root> --tag bestie:backup-format=1 ...
restic -r <repository> check
restic -r <repository> restore <snapshot-id> --target <staging-dir>
restic -r <repository> forget --keep-daily <n> --keep-weekly <n> --keep-monthly <n> --prune --dry-run
```

Pass repository password and provider credentials through the child process environment only. Build a minimal environment by copying only required variables plus platform essentials. Never include raw environment values in thrown errors or logs. Bound stdout/stderr capture and redact it before displaying diagnostics.

## Backup Workflow

1. Validate backup config and resolve required env vars without logging values.
2. Discover Restic and validate its version/availability.
3. Ask for required approval and secret inclusion confirmation.
4. Create restrictive staging directory.
5. Generate a consistent SQLite snapshot and copy curated files using path containment checks.
6. Generate manifest and file hashes.
7. Invoke Restic backup with Bestie tags.
8. Parse the resulting snapshot ID and record a redacted audit event.
9. Remove staging data even on error.
10. Print summary and suggested `verify` command.

No successful backup result is reported until Restic exits successfully and a snapshot ID is available.

## Restore And Apply Workflow

1. List/select a Bestie-tagged snapshot.
2. Require explicit owner confirmation and create an empty staging directory.
3. Invoke Restic restore into staging.
4. If secrets were not explicitly requested, remove/omit staging `.env` before any inspection output.
5. Validate manifest hashes, config schema, SQLite integrity, character files, and skill path containment.
6. Print a redacted restore report and the explicit apply command.
7. For apply, verify no managed Bestie service/daemon/UI process is running.
8. Make a pre-apply backup; then move live state to an adjacent rollback directory.
9. Move/copy validated restore contents to live state, retaining live secrets unless secret replacement was explicitly requested.
10. Verify live config/database; if verification fails, restore rollback state automatically when safe and report both paths.
11. Do not start services automatically. Tell the user to run `bestie doctor` and then start the desired service/daemon.

## Failure Handling

| Situation | Required behavior |
| --- | --- |
| Restic unavailable | Fail before staging with install guidance; Doctor reports it. |
| Missing password/credential env var | Fail with the env-var name only, never its value. |
| Repository unreachable | Fail without modifying local Bestie data; offer `backup status` / `verify` guidance. |
| Snapshot SQLite integrity failure | Delete staging and fail; never backup a raw live DB fallback. |
| Backup upload fails | Delete staging, preserve live data, write redacted audit failure. |
| Manifest/hash/config validation fails | Refuse apply and preserve staging for inspection unless it contains secrets; secret staging is removed unless user explicitly requests secure retention. |
| Service/daemon still running | Refuse apply and identify the management command; never kill processes automatically. |
| Apply fails after live move | Restore the adjacent rollback directory when safe; preserve both locations if automated rollback also fails. |
| Restic repository corrupted | `verify` reports it; never attempt `prune` or overwrite repository automatically. |

## Retention And Storage Guidance

Default retention: `7` daily, `4` weekly, `12` monthly. Users should maintain a 3-2-1 posture: a local encrypted repository, an encrypted remote repository, and a separate off-device copy.

Bestie must not assume a remote location is private merely because it is authenticated; Restic encryption is required for every repository. Documentation should recommend keeping the Restic passphrase in a password manager separate from the backed-up machine.

## Logging And Observability

Append redacted structured events:

```text
backup_configured
backup_started
backup_completed
backup_failed
backup_verified
backup_restore_staged
backup_apply_started
backup_apply_completed
backup_apply_rolled_back
backup_prune_planned
backup_prune_completed
```

Log snapshot ID, format version, duration, size/count summaries, operation type, and error category. Do not log repository passwords, provider credential values, `.env` values, file content, full remote URLs with embedded credentials, or unredacted Restic output.

## Doctor Requirements

Add non-destructive checks:

- backup config parses and uses valid env-var names
- Restic executable is available
- required secret env vars are present, without checking/displaying values
- backup repository is reachable only when a user invokes an extended/deep Doctor check
- latest successful backup age is below configurable threshold
- snapshot DB/staging cleanup leftovers are detected and can be safely deleted only after confirmation

`bestie doctor --fix` may clean abandoned non-secret staging directories and explain missing configuration. It must not initialize repositories, create backups, upload data, run prune, or apply restores.

## Test Plan

Use injected Restic process runners and temporary `RuntimePaths`; no test contacts a real cloud repository.

- config parser rejects embedded credentials, invalid env names, and invalid retention.
- staging includes each curated asset and excludes logs/workspace/runtime state.
- SQLite snapshot survives concurrent writes and passes `integrity_check`.
- a failed snapshot never invokes Restic backup.
- backup default excludes `.env`; `--include-secrets` requires explicit approval.
- Restic arguments are structured, have no shell, and redact stdout/stderr.
- list filters non-Bestie snapshots by default.
- restore refuses live/non-empty/unsafe staging paths.
- manifest hash, config schema, SQLite integrity, and path traversal failures block apply.
- apply refuses while service/daemon/UI is running.
- apply preserves live `.env` by default and produces rollback state.
- simulated post-move failure restores rollback state.
- prune defaults to dry-run and never deletes non-Bestie snapshots.
- Doctor reports missing Restic/config/env vars without leaking values.
- command spec tests cover help, invalid flags, confirmation rejection, and machine-readable redaction.

## Acceptance Criteria

- A user can initialize/configure an encrypted local Restic repository without secrets entering `config.json` or logs.
- `bestie backup create` produces a Restic snapshot containing a validated SQLite copy and curated Bestie state.
- Default snapshots do not contain `.env`; secret inclusion has a separate explicit confirmation.
- `bestie backup list` and `verify` work without mutating Bestie data.
- `bestie backup restore` only creates a validated staging restore and never overwrites live state.
- `bestie backup apply` refuses active services, creates rollback protection, and preserves secrets by default.
- All Restic invocation uses argument arrays with bounded, redacted output.
- Tests cover successful paths, permission rejection, redaction, SQLite consistency, restore validation, rollback, and destructive retention safeguards.

## Implementation Order

1. Add config types/validation, Restic discovery, and read-only `backup status` Doctor checks.
2. Implement curated staging, manifest hashing, and consistent SQLite snapshots with tests.
3. Implement `backup create`, portable-only, with redacted logs and integration tests using a fake Restic runner.
4. Add secret-inclusive opt-in flow and retention planning/dry-run.
5. Implement list and verify.
6. Implement staging-only restore plus validation.
7. Implement apply/rollback after service-state detection is thoroughly tested.
8. Integrate pre-update backup and optional scheduling only after the core restore path is proven.

## Open Questions

- Which remote providers should the first release document as supported and test in CI, beyond local repositories?
- Should Restic be auto-downloaded by an installer, or only discovered from PATH to minimize supply-chain surface?
- What maximum backup age should Doctor flag by default for daily versus manual-only users?
- Should portable exports use the same Restic repository mechanism or a separate user-selected archive format?
- What operating-system credential-store support, if any, is appropriate after the `.env` MVP?
