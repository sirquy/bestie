# Changelog

All notable changes to Bestie will be documented in this file.

This project follows semantic versioning after the first public package release. Before `1.0.0`, minor versions may include breaking changes.

## [Unreleased]

## [0.1.4] - 2026-07-14

### Added

- Zalo local text polling channel with setup, doctor checks, smoke transcripts, and response normalization.
- Channel command namespace with `bestie channels telegram`, `bestie channels zalo`, and channel status listing.
- Channel-focused doctor output, including machine-readable `bestie channels doctor --json` smoke coverage.
- Provider retry logging and channel error replies that expose sanitized provider failure details.

### Changed

- Moved Telegram and Zalo CLIs under the scalable `channels` command hierarchy.
- Isolated smoke scripts from the developer's real `~/.bestie` runtime by using temp runtimes where appropriate.

### Added

- Initial public repository documentation.
- Local CLI foundation.
- Doctor diagnostics.
- Local memory foundation.
- Telegram local polling foundation.
- Character evaluation tests.

### Security

- Secrets are expected to live in local `.env` files, not config files.
- Public/external/destructive actions require explicit permission checks.
