# GitHub Repository Settings Checklist

Use this checklist after creating the new public GitHub repository.

## Repository Basics

- Description: `Self-hosted AI companion CLI with local-first memory, Telegram support, and safety-minded tool permissions.`
- Website: optional docs or project page URL.
- Topics: `ai`, `cli`, `typescript`, `telegram-bot`, `local-first`, `llm`, `openai-compatible`, `privacy`, `mcp`.
- Enable Issues.
- Enable Discussions if you want product/community Q&A separate from bugs.
- Disable Wiki unless you plan to maintain it.
- Enable Sponsorships later only if maintainers are ready.

## Features To Enable

- Dependabot alerts
- Dependabot security updates
- Secret scanning
- Push protection
- Private vulnerability reporting
- Code scanning with CodeQL

## Branch Protection For `main`

Recommended rules:

- Require a pull request before merging.
- Require at least 1 approving review.
- Dismiss stale pull request approvals when new commits are pushed.
- Require review from Code Owners if you add `CODEOWNERS`.
- Require conversation resolution before merging.
- Require status checks to pass before merging.
- Require branches to be up to date before merging.
- Required status checks:
  - `build-test (20.x)`
- Block force pushes.
- Block branch deletion.
- Restrict direct pushes to maintainers only, or disallow direct pushes completely.

Optional later:

- Require signed commits.
- Require linear history.
- Require deployment checks before release branches.

## Merge Strategy

Recommended defaults:

- Enable squash merge.
- Disable merge commits.
- Disable rebase merge unless maintainers prefer it.
- Auto-delete head branches after merge.

## Secrets

Do not add provider API keys for normal CI. The default CI should run without real secrets.

Only add secrets for opt-in maintainer workflows, such as release publishing or real integration smoke tests.

Potential future secrets:

- `NPM_TOKEN` for npm publish
- `BESTIE_TELEGRAM_REAL_SMOKE` only in a manual, protected workflow if ever needed

## Release Hygiene

Before first public release:

- Confirm package name and repository URL.
- Confirm license.
- Add `CHANGELOG.md`.
- Tag releases as `v0.x.y`.
- Use GitHub Releases for human-readable release notes.
