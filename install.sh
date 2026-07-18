#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${BESTIE_INSTALL_PACKAGE:-bestie-agent}"
BIN_DIR="${BESTIE_INSTALL_BIN_DIR:-$HOME/.local/bin}"
NPM_PREFIX="${BESTIE_INSTALL_NPM_PREFIX:-$(dirname "$BIN_DIR")}"
SKIP_ONBOARD=0

fail() {
  local what="$1"
  local fix="$2"
  local data="$3"
  printf 'Cài đặt Bestie thất bại: %s\n' "$what" >&2
  printf 'Cách xử lý gợi ý: %s\n' "$fix" >&2
  printf 'Dữ liệu người dùng: %s\n' "$data" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Trình cài đặt Bestie

Cách dùng: ./install.sh [--skip-onboard] [--package <gói-npm>] [--bin-dir <đường-dẫn>]

Tùy chọn:
  --skip-onboard             Không hỏi chạy bestie onboard sau khi cài.
  --package <gói-npm>        Gói npm để cài. Mặc định: bestie-agent.
  --bin-dir <đường-dẫn>      Thư mục chứa lệnh bestie. Mặc định: ~/.local/bin.
  --help                     Hiện trợ giúp này.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-onboard)
      SKIP_ONBOARD=1
      shift
      ;;
    --package)
      PACKAGE_NAME="${2:-}"
      [[ -n "$PACKAGE_NAME" ]] || fail "Thiếu giá trị cho --package" "Truyền tên gói npm, ví dụ bestie-agent." "Chưa chạm vào dữ liệu người dùng."
      shift 2
      ;;
    --bin-dir)
      BIN_DIR="${2:-}"
      [[ -n "$BIN_DIR" ]] || fail "Thiếu giá trị cho --bin-dir" "Truyền đường dẫn thư mục bin của người dùng." "Chưa chạm vào dữ liệu người dùng."
      NPM_PREFIX="$(dirname "$BIN_DIR")"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Không hỗ trợ tùy chọn: $1" "Chạy ./install.sh --help để xem các tùy chọn được hỗ trợ." "Chưa chạm vào dữ liệu người dùng."
      ;;
  esac
done

run_step() {
  local description="$1"
  shift
  printf '\n==> %s\n' "$description"
  "$@" || fail "Lệnh thất bại: $*" "Sửa lỗi ở trên rồi chạy lại trình cài đặt." "Dữ liệu .bestie hiện có đã được giữ nguyên."
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

sudo_prefix() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    return 0
  fi
  has_command sudo || fail "Thiếu sudo để cài gói hệ thống" "Cài git, curl/wget, Node.js 24 và npm thủ công rồi chạy lại; hoặc chạy script trên môi trường có sudo." "Chưa chạm vào dữ liệu người dùng."
  printf 'sudo'
}

install_system_packages() {
  local packages=("$@")
  [[ "${#packages[@]}" -gt 0 ]] || return 0

  if has_command apt-get; then
    local sudo_cmd
    sudo_cmd="$(sudo_prefix)"
    run_step "Cài gói hệ thống: ${packages[*]}" ${sudo_cmd:+$sudo_cmd} apt-get update
    run_step "Cài gói hệ thống: ${packages[*]}" ${sudo_cmd:+$sudo_cmd} apt-get install -y "${packages[@]}"
    return 0
  fi

  if has_command dnf; then
    local sudo_cmd
    sudo_cmd="$(sudo_prefix)"
    run_step "Cài gói hệ thống: ${packages[*]}" ${sudo_cmd:+$sudo_cmd} dnf install -y "${packages[@]}"
    return 0
  fi

  if has_command yum; then
    local sudo_cmd
    sudo_cmd="$(sudo_prefix)"
    run_step "Cài gói hệ thống: ${packages[*]}" ${sudo_cmd:+$sudo_cmd} yum install -y "${packages[@]}"
    return 0
  fi

  if has_command pacman; then
    local sudo_cmd
    sudo_cmd="$(sudo_prefix)"
    run_step "Cài gói hệ thống: ${packages[*]}" ${sudo_cmd:+$sudo_cmd} pacman -Sy --noconfirm "${packages[@]}"
    return 0
  fi

  if has_command brew; then
    run_step "Cài gói hệ thống: ${packages[*]}" brew install "${packages[@]}"
    return 0
  fi

  fail "Không tìm thấy trình quản lý gói được hỗ trợ" "Cài thủ công các lệnh còn thiếu: ${packages[*]}, rồi chạy lại trình cài đặt." "Chưa chạm vào dữ liệu người dùng."
}

ensure_system_command() {
  local command_name="$1"
  local package_name="${2:-$1}"
  if has_command "$command_name"; then
    return 0
  fi
  install_system_packages "$package_name"
  has_command "$command_name" || fail "Không cài được lệnh bắt buộc: $command_name" "Cài $package_name thủ công rồi chạy lại trình cài đặt." "Chưa chạm vào dữ liệu người dùng."
}

ensure_download_command() {
  if has_command curl || has_command wget; then
    return 0
  fi
  install_system_packages curl
  has_command curl || has_command wget || fail "Thiếu curl hoặc wget" "Cài curl hoặc wget thủ công rồi chạy lại trình cài đặt." "Chưa chạm vào dữ liệu người dùng."
}

assert_node_version() {
  local major
  major="$(node -p 'Number(process.versions.node.split(".")[0])')" || fail "Không đọc được phiên bản Node.js" "Cài Node.js 24." "Chưa chạm vào dữ liệu người dùng."
  [[ "$major" -eq 24 ]]
}

install_node_with_nvm() {
  ensure_download_command
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    run_step "Cài nvm để dùng Node.js 24" bash -c 'if command -v curl >/dev/null 2>&1; then curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh; else wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh; fi | bash'
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" || fail "Không nạp được nvm" "Kiểm tra $NVM_DIR/nvm.sh rồi chạy lại trình cài đặt." "Chưa chạm vào dữ liệu người dùng."
  run_step "Cài Node.js 24 và npm" nvm install 24 --latest-npm
  nvm use 24 >/dev/null
}

reload_bashrc() {
  if [[ -f "$HOME/.bashrc" ]]; then
    printf '\n==> Nạp lại ~/.bashrc\n'
    set +u
    # shellcheck disable=SC1090
    . "$HOME/.bashrc" || fail "Không source được ~/.bashrc" "Kiểm tra lỗi trong ~/.bashrc rồi chạy lại trình cài đặt." "Chưa chạm vào dữ liệu người dùng."
    set -u
  else
    printf '\n==> Không tìm thấy ~/.bashrc, bỏ qua bước nạp lại bash\n'
  fi
}

ensure_node_runtime() {
  if has_command node && assert_node_version && has_command npm; then
    return 0
  fi
  printf 'Node.js 24/npm chưa sẵn sàng; Bestie sẽ cài Node.js 24 qua nvm.\n'
  install_node_with_nvm
  reload_bashrc
  # shellcheck disable=SC1091
  [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]] && . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" && nvm use 24 >/dev/null
  has_command node || fail "Không tìm thấy node sau khi cài" "Mở shell mới hoặc nạp ~/.nvm/nvm.sh rồi chạy lại trình cài đặt." "Chưa chạm vào dữ liệu người dùng."
  has_command npm || fail "Không tìm thấy npm sau khi cài" "Chạy nvm install 24 --latest-npm rồi chạy lại trình cài đặt." "Chưa chạm vào dữ liệu người dùng."
  assert_node_version || fail "Phiên bản Node.js vẫn chưa đúng yêu cầu: $(node -v)" "Cài Node.js 24 rồi chạy lại trình cài đặt." "Chưa chạm vào dữ liệu người dùng."
}

install_bestie_package() {
  mkdir -p "$NPM_PREFIX" "$BIN_DIR"
  run_step "Cài Bestie từ npm package: $PACKAGE_NAME" npm install -g --prefix "$NPM_PREFIX" "$PACKAGE_NAME"
  [[ -x "$BIN_DIR/bestie" ]] || fail "Không tìm thấy lệnh bestie sau khi cài" "Kiểm tra npm global prefix $NPM_PREFIX hoặc chạy npm install -g --prefix $NPM_PREFIX $PACKAGE_NAME." "Dữ liệu .bestie hiện có đã được giữ nguyên."
  printf 'Đã cài lệnh bestie tại %s\n' "$BIN_DIR/bestie"
}

ensure_bestie_command() {
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) export PATH="$BIN_DIR:$PATH" ;;
  esac
  hash -r 2>/dev/null || true
  if ! has_command bestie; then
    fail "Shell hiện tại chưa chạy được lệnh bestie" "Thêm $BIN_DIR vào PATH rồi chạy lại: export PATH=\"$BIN_DIR:\$PATH\"." "Dữ liệu .bestie hiện có đã được giữ nguyên."
  fi
  if [[ -f "$HOME/.bashrc" ]] && ! grep -Fqs "$BIN_DIR" "$HOME/.bashrc"; then
    printf '\n# Bestie CLI\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$HOME/.bashrc"
    reload_bashrc
  fi
  printf 'Lệnh bestie đã sẵn sàng: %s\n' "$(command -v bestie)"
}

run_doctor_preview() {
  printf '\n==> Chạy Doctor\n'
  if "$BIN_DIR/bestie" doctor; then
    return 0
  fi
  printf 'Doctor phát hiện vấn đề thiết lập. Điều này bình thường trước khi onboard ở lần cài mới.\n'
}

maybe_run_onboard() {
  if [[ "$SKIP_ONBOARD" -eq 1 ]]; then
    return 1
  fi
  if [[ ! -t 0 ]]; then
    printf 'Bỏ qua onboarding vì stdin không tương tác. Chạy bestie onboard khi sẵn sàng.\n'
    return 1
  fi
  printf '\nChạy bestie onboard ngay bây giờ? [y/N] '
  local answer
  read -r answer || true
  case "${answer,,}" in
    y|yes) bestie onboard ;;
    *) printf 'Bỏ qua onboarding. Chạy bestie onboard khi sẵn sàng.\n'; return 1 ;;
  esac
}

run_onboard_first() {
  if maybe_run_onboard; then
    run_doctor_preview
  fi
}

main() {
  ensure_system_command git git
  ensure_node_runtime
  reload_bashrc
  install_bestie_package
  ensure_bestie_command
  run_onboard_first

  printf '\nCài đặt Bestie hoàn tất. Thử chạy: bestie chat\n'
}

main