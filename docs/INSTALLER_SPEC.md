# Installer Spec

## Goal

Make Bestie installable by a technical-but-not-project-local user with one command, then hand off into the existing onboarding-first flow.

The installer should not add new product scope. It should only make the current local CLI, onboarding, Doctor, Telegram/Zalo, cron, memory, service command, local Vite/React Web UI, skills, update, MCP, and permission-gated tool foundation easier to bootstrap.

## MVP Command

```bash
curl -fsSL <bestie-install-url> | bash
```

Repo-local development may start with:

```bash
./install.sh
./install.sh --skip-onboard
```

## MVP Behavior

The installer should:

- install missing environment commands when possible: `git`, `curl` or `wget`, `node`, and `npm`
- install Node.js 24 through `nvm` when Node.js is missing or not version 24
- source `~/.bashrc` after environment installation so the current shell sees the updated runtime
- install Bestie through the npm package `bestie-agent`, not by cloning or copying a source checkout
- expose the `bestie` command in a predictable user-local bin directory
- ensure the current shell can run `bestie` before any Bestie command is invoked
- offer to run `bestie onboard` as the first Bestie command
- run `bestie doctor` only after onboarding actually runs
- print all installer-owned user-facing copy in Vietnamese

MVP flags:

```text
	--skip-onboard      Do not offer to run bestie onboard after install.
	--package <name>    Install this npm package. Defaults to bestie-agent.
	--bin-dir <path>    Place the bestie command here. Defaults to ~/.local/bin.
```

## Existing Install Detection

The installer does not own source checkouts anymore. Existing source directories should be left alone. Reinstalling should:

- preserve `~/.bestie/`, `.env`, config, character, memory database, logs, skills, daemon state, and transcripts
- update the globally installed npm package
- explain npm or environment failures without printing secrets

## Safety And Privacy

The installer must never print or collect API keys, Telegram tokens, or raw `.env` contents.

It should not run network checks beyond dependency installation and npm package installation unless the user explicitly chooses onboarding or later Doctor checks that already require them.

## Recovery Output

Failures should include:

- what failed
- the command that failed
- the likely fix
- whether user data was touched

Examples:

- unsupported Node version: install Node.js 24 with nvm
- missing `git`: install Git and rerun
- `npm install -g bestie-agent` failed: rerun after fixing network, npm auth, or npm cache issues

## Acceptance Checks

Local development acceptance:

```bash
npm run build
npm run smoke:installer
npm run smoke:onboard
npm run smoke:doctor
npm run smoke
```

The installer smoke must verify a fresh temporary npm-package install, onboarding handoff, reinstall preservation of `~/.bestie/`, and rejection of old source-install flags.

Installer acceptance once `install.sh` exists:

```bash
tmpdir=$(mktemp -d)
HOME="$tmpdir" ./install.sh --skip-onboard
HOME="$tmpdir" ~/.local/bin/bestie doctor
```

The smoke must not require real provider or Telegram secrets.

## Non-Goals

- installing or starting user services; that belongs to `bestie service install|uninstall|restart|status`
- auto-starting Telegram polling
- Zep setup
- hosted accounts
- GUI installer
- shell profile edits without clear user consent
