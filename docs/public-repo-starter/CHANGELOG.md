# Changelog

All notable changes to Bestie will be documented in this file.

This project follows semantic versioning after the first public package release. Before `1.0.0`, minor versions may include breaking changes.

## [Unreleased]

### Added

- Initial public repository documentation.
- Local TypeScript CLI/runtime foundation with terminal chat, onboarding, status, logs, and Doctor diagnostics.
- Config v2 provider profiles for OpenAI/ChatGPT, Anthropic Claude, OpenAI-compatible endpoints, Groq, OpenRouter, Ollama, and native Gemini API-key mode.
- Local SQLite memory, knowledge graph, approvals, governance, and inspection commands.
- Telegram, Zalo, cron, daemon, and one-service Linux user runtime foundations.
- Local web console through `bestie ui` with chat, Doctor, providers, character, memory, knowledge graph, channels, approvals, MCP, tools, skills, and settings panels.
- Permission-gated local tools, image/video generation tools, bounded internal subagents, installed skills, SDK-backed MCP setup/read foundations, and npm update checks.
- Character regression evals and smoke scripts for CLI, Doctor, channels, installer, MCP, and UI.

### Security

- Secrets are expected to live in local `.env` files, not config files.
- Public/external/destructive actions require explicit permission checks.
