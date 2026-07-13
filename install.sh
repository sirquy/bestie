#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${BESTIE_INSTALL_REPO_URL:-https://github.com/sirquy/bestie.git}"
INSTALL_DIR="${BESTIE_INSTALL_DIR:-$HOME/.local/share/bestie/source}"
BIN_DIR="${BESTIE_INSTALL_BIN_DIR:-$HOME/.local/bin}"
SKIP_ONBOARD=0
SOURCE_DIR=""

fail() {
  local what="$1"
  local fix="$2"
  local data="$3"
  printf 'Bestie install failed: %s\n' "$what" >&2
  printf 'Likely fix: %s\n' "$fix" >&2
  printf 'User data: %s\n' "$data" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Bestie installer

Usage: ./install.sh [--skip-onboard] [--dir <path>] [--bin-dir <path>] [--source-dir <path>]

Options:
  --skip-onboard      Do not offer to run bestie onboard after install.
  --dir <path>        Install source checkout here. Defaults to ~/.local/share/bestie/source.
  --bin-dir <path>    Place the bestie command here. Defaults to ~/.local/bin.
  --source-dir <path> Copy this local checkout instead of cloning. Intended for smoke tests.
  --help              Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-onboard)
      SKIP_ONBOARD=1
      shift
      ;;
    --dir)
      INSTALL_DIR="${2:-}"
      [[ -n "$INSTALL_DIR" ]] || fail "Missing value for --dir" "Provide an install directory." "No user data was touched."
      shift 2
      ;;
    --bin-dir)
      BIN_DIR="${2:-}"
      [[ -n "$BIN_DIR" ]] || fail "Missing value for --bin-dir" "Provide a user-local bin directory." "No user data was touched."
      shift 2
      ;;
    --source-dir)
      SOURCE_DIR="${2:-}"
      [[ -n "$SOURCE_DIR" ]] || fail "Missing value for --source-dir" "Provide a local Bestie checkout path." "No user data was touched."
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1" "Run ./install.sh --help for supported options." "No user data was touched."
      ;;
  esac
done

run_step() {
  local description="$1"
  shift
  printf '\n==> %s\n' "$description"
  "$@" || fail "Command failed: $*" "Fix the error above, then rerun the installer." "Existing .bestie data was preserved."
}

run_doctor_preview() {
  printf '\n==> Running Doctor\n'
  if bash -c 'cd "$1" && "$2" doctor' _ "$INSTALL_DIR" "$BIN_DIR/bestie"; then
    return 0
  fi
  printf 'Doctor found setup issues. This is expected before onboarding on a fresh install.\n'
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1" "Install $1 and rerun the installer." "No user data was touched."
}

assert_node_version() {
  local major
  major="$(node -p 'Number(process.versions.node.split(".")[0])')" || fail "Could not read Node.js version" "Install Node.js 20 or newer." "No user data was touched."
  if [[ "$major" -lt 20 ]]; then
    fail "Unsupported Node.js version: $(node -v)" "Install Node.js 20 or newer and rerun the installer." "No user data was touched."
  fi
}

assert_bestie_checkout() {
  local dir="$1"
  [[ -f "$dir/package.json" ]] || fail "$dir is not a Bestie checkout" "Choose an empty --dir or an existing Bestie checkout." "Existing files were preserved."
  node -e 'const pkg=require(process.argv[1]); if (pkg.name !== "bestie" || !pkg.bin || pkg.bin.bestie !== "dist/cli/index.js") process.exit(1)' "$dir/package.json" \
    || fail "$dir is not a recognized Bestie checkout" "Choose an empty --dir or an existing Bestie checkout." "Existing files were preserved."
}

copy_source_checkout() {
  local source="$1"
  [[ -d "$source" ]] || fail "Source directory not found: $source" "Pass a valid --source-dir path." "No user data was touched."
  assert_bestie_checkout "$source"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  if [[ -e "$INSTALL_DIR" ]]; then
    assert_bestie_checkout "$INSTALL_DIR"
  else
    mkdir -p "$INSTALL_DIR"
  fi
  run_step "Copying local Bestie checkout" rsync -a --delete \
    --exclude .git \
    --exclude node_modules \
    --exclude dist \
    --exclude .bestie \
    "$source/" "$INSTALL_DIR/"
}

clone_or_update_checkout() {
  mkdir -p "$(dirname "$INSTALL_DIR")"
  if [[ -e "$INSTALL_DIR" ]]; then
    assert_bestie_checkout "$INSTALL_DIR"
    if [[ -d "$INSTALL_DIR/.git" ]]; then
      run_step "Updating existing Bestie checkout" git -C "$INSTALL_DIR" pull --ff-only
    else
      printf 'Existing Bestie checkout is not a git repository; preserving it and skipping update.\n'
    fi
  else
    run_step "Cloning Bestie" git clone "$REPO_URL" "$INSTALL_DIR"
  fi
}

link_bestie_command() {
  mkdir -p "$BIN_DIR"
  local target="$BIN_DIR/bestie"
  cat >"$target" <<EOF
#!/usr/bin/env bash
exec node "$INSTALL_DIR/dist/cli/index.js" "\$@"
EOF
  chmod +x "$target"
  printf 'Bestie command installed at %s\n' "$target"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) printf 'Note: add %s to PATH if your shell cannot find bestie.\n' "$BIN_DIR" ;;
  esac
}

maybe_run_onboard() {
  if [[ "$SKIP_ONBOARD" -eq 1 ]]; then
    return 0
  fi
  if [[ ! -t 0 ]]; then
    printf 'Skipping onboarding because stdin is not interactive. Run bestie onboard when ready.\n'
    return 0
  fi
  printf '\nRun bestie onboard now? [y/N] '
  local answer
  read -r answer || true
  case "${answer,,}" in
    y|yes) "$BIN_DIR/bestie" onboard ;;
    *) printf 'Skipping onboarding. Run bestie onboard when ready.\n' ;;
  esac
}

main() {
  require_command git
  require_command node
  require_command npm
  if [[ -n "$SOURCE_DIR" ]]; then
    require_command rsync
  fi
  assert_node_version

  if [[ -n "$SOURCE_DIR" ]]; then
    copy_source_checkout "$SOURCE_DIR"
  else
    clone_or_update_checkout
  fi

  run_step "Installing dependencies" npm --prefix "$INSTALL_DIR" install
  run_step "Building Bestie" npm --prefix "$INSTALL_DIR" run build
  link_bestie_command
  run_doctor_preview
  maybe_run_onboard

  printf '\nBestie install complete. Try: bestie chat\n'
}

main