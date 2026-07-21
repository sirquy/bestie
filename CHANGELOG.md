# Changelog

All notable changes to Bestie will be documented in this file.

This project follows semantic versioning after the first public package release. Before `1.0.0`, minor versions may include breaking changes.

## [Unreleased]

## [0.1.17] - 2026-07-21

### Fixed

- Gemini onboarding now uses `GEMINI_API_KEY` instead of falling back to `OPENAI_API_KEY`.
- Gemini onboarding no longer asks for or stores `baseUrl`, matching native `@google/genai` API-key setup.

## [0.1.16] - 2026-07-21

### Added

- Config v2 LLM provider profiles with canonical `provider/model` refs, model catalog entries, fallback ordering, and provider diagnostics.
- Native Gemini API-key adapter through `@google/genai`.
- LLM provider CLI management for providers, models, profiles, fallbacks, and model-specific tests.
- Built-in provider catalog entries for Anthropic Claude, OpenAI/ChatGPT, Groq, OpenRouter, Ollama, Gemini, and custom compatible providers.

### Changed

- Gemini setup no longer stores or passes `baseUrl`; native SDK defaults own Gemini endpoint selection.
- HTTP-backed providers still require `baseUrl` and fail with a clear provider response error when it is missing.

### Fixed

- Gemini responses with candidate text parts are normalized even when the SDK aggregate `text` field is absent.
- Gemini media-only responses now fail with a clear diagnostic instead of a generic missing-content error.

## [0.1.15] - 2026-07-18

### Added

- Installer support for installing Bestie from the published `bestie-agent` npm package.
- Installer smoke coverage for local npm tarball installs and reinstall preservation.

### Changed

- Onboarding defaults now use Vietnamese-friendly names and allow memory deletion by default.
- New onboarding configs now default internal local tools to `allow` with a longer execution timeout.
- Installer now provisions Node.js 24 through nvm when needed and reloads `~/.bashrc` before package installation.
- Installer and docs now describe npm-package installation instead of source checkout installation.
- Package engine requirement now targets Node.js 24+.

## [0.1.11] - 2026-07-15

### Added

- Cron job scheduling and execution with isolated agent chat sessions and CLI management (`bestie cron`).
- Cron tool definitions exposed to agent tool-use during scheduled runs.
- Diagnostic scripts for verifying Windows environment variable resolution.

### Changed

- Default memory write policy changed from `ask` to `allow` for smoother first-run experience.
- Increased LLM max retries for better transient failure resilience.

### Fixed

- Windows CLI entrypoint detection now uses `pathToFileURL` instead of manual URL construction, fixing silent no-output behavior on Windows CMD and PowerShell.
- Publish guardrails: `prepack` always rebuilds clean `dist/`, `prepublishOnly` runs full test suite, and `build` sets executable permission on `dist/cli/index.js`.

## [0.1.9] - 2026-07-15

### Added

- Declarative CLI command router (`command-router.ts`) with `CliCommandSpec` tree for consistent nested help.
- Separated command spec registry (`command-specs.ts`) from entrypoint for scalable command registration.
- Nested Commander help for `bestie channels`, `bestie mcp`, `bestie channels telegram`, and `bestie channels zalo`.
- Architecture rules documenting Commander routing ownership and command registration standards.

### Changed

- Removed manual help text from `channels` and `mcp` handlers; Commander is now the single source of CLI help.
- `bestie channels` without subcommand now shows channel status table instead of help text.
- Removed `channelHandlers` manual lookup map from `channels.ts`.
- Top-level CLI errors use shared UI badges (`[MOVED]`, `[ERROR]`) and `dim("Next")` hints.

## [0.1.8] - 2026-07-15

### Added

- `clean`, `pack:check`, `prepack`, and `prepublishOnly` scripts for safe npm packaging.
- `chmod 755` in build step to ensure CLI bin is executable after `tsc` compilation.

### Changed

- Replaced top-level manual command router with Commander 14.0.3 (Node >=20 compatible).
- Replaced manual `LANGUAGE_ALIASES` map with `iso-639-1` library for standards-backed language name resolution.
- Language normalization now resolves human-readable names (e.g., "English", "Tiếng Việt") via ISO 639-1 before falling back to BCP-47 canonical tags.
- Installed `commander@14.0.3` and `iso-639-1@3.1.6` as production dependencies.

## [0.1.7] - 2026-07-15

### Added

- Inquirer-based CLI prompt helper with TTY/non-TTY support and EOF-aware input.
- Shared CLI UI formatting helpers: `badge`, `title`, `keyValue`, `rule`, `table`, `statusBadge`, `spinner`.
- Animated CLI banner with `BESTIE_BANNER=static|animate` and `BESTIE_NO_BANNER=1` controls.
- Telegram `whoami` command to detect owner id/username from recent bot messages.
- Telegram voice CLI helpers: model listing, download, and local voice setup.
- CLI update check notices with npm version comparison and cache.
- Installed skills injected into system prompts.
- Explicit workspace paths for git read tools.
- Locale-aware onboarding with timezone support and `normalizeLanguageInput`.

### Changed

- Centralized CLI prompt handling into shared module with Inquirer backend.
- Bot token input hidden during channel setup prompts.
- CLI entrypoint resolution via `realpathSync` for npm symlink compatibility.
- Doctor report check fixes normalized.
- Channel and onboarding UIs refactored to use shared UI helpers.

### Fixed

- CLI entrypoint detection through npm global symlinks.
- Telegram owner matching now supports both user id and username.

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
