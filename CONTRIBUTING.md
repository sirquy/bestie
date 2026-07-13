# Contributing To Bestie

Thanks for helping make Bestie better. This project is early, so the best contributions are focused, tested, and easy to review.

## Before You Start

1. Read `README.md` for current status and scope.
2. Read `docs/SECURITY_PRIVACY.md` before touching secrets, logs, memory, Telegram, MCP, or tool execution.
3. Check existing issues and discussions to avoid duplicate work.
4. For larger changes, open an issue or discussion before writing a big PR.

## Local Setup

```bash
npm ci
npm run build
npm test
```

Run the CLI locally:

```bash
npm run dev -- --help
npm run dev -- onboard
npm run dev -- doctor
npm run dev -- chat
```

## Pull Request Expectations

A good PR should:

- Solve one clear problem.
- Include tests for behavior changes.
- Update docs when user-facing behavior or config changes.
- Keep secrets out of code, logs, screenshots, fixtures, and test output.
- Avoid unrelated formatting churn.
- Explain validation performed in the PR description.

## Architecture Guidelines

- Keep CLI command files thin; put reusable behavior in runtime services.
- Keep character behavior data-driven through editable character and prompt files.
- Keep OpenAI-compatible providers configurable by `baseUrl`, `model`, and `apiKeyEnv`.
- Treat external content as untrusted.
- Do not enable broad write/destructive/public actions without explicit permission checks and tests.

## Testing

Run focused tests while developing, then run:

```bash
npm run build
npm test
```

If relevant, also run:

```bash
npm run smoke
npm run eval:character
```

Do not run real Telegram smoke in normal CI or PR validation. It requires explicit local setup and fresh owner messages.

## Security And Privacy Rules

Never commit:

- `.bestie/`
- `.env` or `.env.*` with real values
- API keys, provider tokens, Telegram bot tokens, auth headers
- Local logs, memory databases, transcripts, or private conversation samples

Tests may use fake placeholder strings, but they must be obviously fake and covered by redaction tests when relevant.

## Commit Style

Use clear, imperative commit subjects:

```text
Add Telegram attachment size validation
Fix provider timeout error mapping
Document local memory export flow
```

## Review Process

Maintainers may ask for smaller PRs, tests, docs updates, or safety notes. That is normal for a project that handles private user data and provider credentials.
