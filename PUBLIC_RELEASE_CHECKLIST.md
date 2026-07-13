# Public Release Checklist

Use this before making the new repository public.

## Must Do

- [ ] Decide canonical repo name and package name. Prefer `bestie` naming; avoid legacy `ai-bestie` unless intentionally kept for migration.
- [ ] Add `LICENSE`.
- [ ] Add `README.md` public quickstart.
- [ ] Add `CONTRIBUTING.md`.
- [ ] Add `SECURITY.md`.
- [ ] Add `CODE_OF_CONDUCT.md`.
- [ ] Add issue templates.
- [ ] Add pull request template.
- [ ] Add CI workflow.
- [ ] Add CodeQL workflow.
- [ ] Add Dependabot config.
- [ ] Add `.env.example` with empty values only.
- [ ] Ensure `.gitignore` excludes `.bestie/`, `.env*`, logs, databases, build outputs, and `node_modules/`.
- [ ] Replace placeholder repository URLs in install scripts, templates, and docs.
- [ ] Remove raw vendor notes, scraped docs, private planning notes, and local transcripts.
- [ ] Confirm generated build output such as `dist/` is not tracked.
- [ ] Run a secret scan before first push.
- [ ] Confirm Security Scan workflow passes on the public default branch.
- [ ] Run `npm ci`, `npm run build`, and `npm test` from a clean checkout.

## Should Do

- [ ] Add `CHANGELOG.md`.
- [ ] Add `CODEOWNERS` once maintainers are defined.
- [ ] Enable GitHub secret scanning and push protection.
- [ ] Enable Dependabot alerts and security updates.
- [ ] Enable private vulnerability reporting.
- [ ] Enable branch protection for `main`.
- [ ] Create labels: `bug`, `docs`, `good first issue`, `help wanted`, `security`, `privacy`, `telegram`, `memory`, `provider`, `mcp`.
- [ ] Create 3-5 good first issues before announcing publicly.
- [ ] Enable Copilot code review or another auto-review gate for new pull requests.
- [ ] Confirm release automation for `v*` tags and document who can publish packages.

## Nice Later

- [ ] Confirm npm publish workflow uses provenance and a protected `npm` environment.
- [ ] Docs site.
- [ ] Community discussions.
- [ ] Project board.

## Pre-Public Scan Commands

```bash
git status --short
git ls-files | rg '(^\.bestie/|\.env$|\.env\.|\.pem$|\.key$|\.sqlite$|\.db$|\.log$|raw|transcript)'
rg -n "(API_KEY|TOKEN|SECRET|PASSWORD|BEGIN (RSA|OPENSSH|PRIVATE)|sk-[A-Za-z0-9]|xox[baprs]-|ghp_|github_pat_|AIza)" -g '!node_modules' -g '!dist' -g '!package-lock.json'
npm ci
npm run build
npm test
```

Secret scans often catch placeholder names. Review hits manually and remove anything real.
