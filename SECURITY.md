# Security Policy

Bestie handles local conversations, memory, provider credentials, Telegram tokens, and tool permissions. Please report security issues responsibly.

## Supported Versions

Bestie is pre-1.0. Security fixes target the default branch unless maintainers publish a versioned support policy later.

## Reporting A Vulnerability

Please do not open a public issue for a suspected vulnerability.

Report privately using GitHub Security Advisories if enabled for the repository. If advisories are not enabled yet, contact the maintainers through the private channel listed in the repository profile.

Include:

- A clear description of the issue
- Steps to reproduce
- Affected files or commands
- Impact and likely severity
- Whether any real secrets, chat content, or private logs were exposed

Do not include real API keys, bot tokens, private chat logs, or other sensitive data in the report. Use redacted examples.

## Security Boundaries

Bestie should:

- Store secrets in `.env`, not config files.
- Store config env var names, not secret values.
- Redact secrets in logs and errors.
- Treat external content as untrusted.
- Require explicit approval for public, external-write, destructive, payment, or unknown actions.
- Keep telemetry opt-in and privacy-first if telemetry is ever added.

Bestie should not:

- Print raw `.env` contents.
- Log API keys, bot tokens, auth headers, or provider secrets.
- Let Telegram messages, files, MCP content, websites, or documents override system/developer instructions.
- Execute broad tool actions without policy checks.

## Public Claims

Bestie must not be marketed as conscious, human, a therapist replacement, a romantic companion, or a system with perfect memory.
