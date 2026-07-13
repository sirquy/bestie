# Installer Spec

## Goal

Make Bestie installable by a technical-but-not-project-local user with one command, then hand off into the existing onboarding and Doctor flow.

The installer should not add new product scope. It should only make the current local CLI, onboarding, Doctor, Telegram, memory, and read-tool foundation easier to bootstrap.

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

- verify required commands: `git`, `node`, `npm`
- require Node.js 20 or newer
- choose a local install directory, defaulting to `~/.local/share/bestie/source`
- clone the repository when missing, or update only after confirming an existing install is a Bestie checkout
- run `npm install` and `npm run build`
- link or expose the `bestie` command in a predictable user-local bin directory
- run `bestie doctor` after install
- offer to run `bestie onboard` after Doctor succeeds

MVP flags:

```text
	--skip-onboard      Do not offer to run bestie onboard after install.
	--dir <path>        Install source checkout here. Defaults to ~/.local/share/bestie/source.
	--bin-dir <path>    Place the bestie command here. Defaults to ~/.local/bin.
	--source-dir <path> Copy this local checkout instead of cloning. Intended for smoke tests.
```

## Existing Install Detection

If the target directory already exists, the installer should:

- refuse to overwrite unknown directories
- detect an existing Bestie checkout by package name and CLI entrypoint
- preserve `.bestie/`, `.env`, config, character, memory database, logs, and transcripts
- explain how to update manually if automatic update is not safe

## Safety And Privacy

The installer must never print or collect API keys, Telegram tokens, or raw `.env` contents.

It should not run network checks beyond dependency installation and repository download unless the user explicitly chooses onboarding or Doctor checks that already require them.

## Recovery Output

Failures should include:

- what failed
- the command that failed
- the likely fix
- whether user data was touched

Examples:

- unsupported Node version: install Node.js 20+
- missing `git`: install Git and rerun
- `npm install` failed: rerun from the checkout after fixing network or npm cache issues
- build failed: run `npm run build` in the checkout and inspect TypeScript errors

## Acceptance Checks

Local development acceptance:

```bash
npm run build
npm run smoke:installer
npm run smoke:onboard
npm run smoke:doctor
npm run smoke
```

The installer smoke must verify a fresh temporary install, onboarding handoff, reinstall preservation of `.bestie/`, and refusal to overwrite an unknown existing directory.

Installer acceptance once `install.sh` exists:

```bash
tmpdir=$(mktemp -d)
HOME="$tmpdir" ./install.sh --skip-onboard
HOME="$tmpdir" ~/.local/bin/bestie doctor
```

The smoke must not require real provider or Telegram secrets.

## Non-Goals

- system service installation
- auto-starting Telegram polling
- Zep setup
- hosted accounts
- GUI installer
- shell profile edits without clear user consent