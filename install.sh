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
  printf 'Cài đặt Bestie thất bại: %s\n' "$what" >&2
  printf 'Cách xử lý gợi ý: %s\n' "$fix" >&2
  printf 'Dữ liệu người dùng: %s\n' "$data" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Trình cài đặt Bestie

Cách dùng: ./install.sh [--skip-onboard] [--dir <đường-dẫn>] [--bin-dir <đường-dẫn>] [--source-dir <đường-dẫn>]

Tùy chọn:
  --skip-onboard              Không hỏi chạy bestie onboard sau khi cài.
  --dir <đường-dẫn>           Cài mã nguồn tại đây. Mặc định: ~/.local/share/bestie/source.
  --bin-dir <đường-dẫn>       Đặt lệnh bestie tại đây. Mặc định: ~/.local/bin.
  --source-dir <đường-dẫn>    Sao chép checkout local thay vì clone. Dùng cho smoke test.
  --help                      Hiện trợ giúp này.
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
      [[ -n "$INSTALL_DIR" ]] || fail "Thiếu giá trị cho --dir" "Truyền đường dẫn thư mục cài đặt." "Chưa chạm vào dữ liệu người dùng."
      shift 2
      ;;
    --bin-dir)
      BIN_DIR="${2:-}"
      [[ -n "$BIN_DIR" ]] || fail "Thiếu giá trị cho --bin-dir" "Truyền đường dẫn thư mục bin của người dùng." "Chưa chạm vào dữ liệu người dùng."
      shift 2
      ;;
    --source-dir)
      SOURCE_DIR="${2:-}"
      [[ -n "$SOURCE_DIR" ]] || fail "Thiếu giá trị cho --source-dir" "Truyền đường dẫn checkout Bestie local." "Chưa chạm vào dữ liệu người dùng."
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

run_doctor_preview() {
  printf '\n==> Chạy Doctor\n'
  if bash -c 'cd "$1" && "$2" doctor' _ "$INSTALL_DIR" "$BIN_DIR/bestie"; then
    return 0
  fi
  printf 'Doctor phát hiện vấn đề thiết lập. Điều này bình thường trước khi onboard ở lần cài mới.\n'
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

sudo_prefix() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    return 0
  fi
  has_command sudo || fail "Thiếu sudo để cài gói hệ thống" "Cài git, Node.js 20+, npm, rsync thủ công rồi chạy lại; hoặc chạy script trên môi trường có sudo." "Chưa chạm vào dữ liệu người dùng."
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

download_to_stdout() {
  local url="$1"
  if has_command curl; then
    curl -fsSL "$url"
    return
  fi
  wget -qO- "$url"
}

assert_node_version() {
  local major
  major="$(node -p 'Number(process.versions.node.split(".")[0])')" || fail "Không đọc được phiên bản Node.js" "Cài Node.js 20 trở lên." "Chưa chạm vào dữ liệu người dùng."
  if [[ "$major" -lt 20 ]]; then
    return 1
  fi
}

install_node_with_nvm() {
  ensure_download_command
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    run_step "Cài nvm để dùng Node.js 20" bash -c "download_to_stdout() { if command -v curl >/dev/null 2>&1; then curl -fsSL \"\$1\"; else wget -qO- \"\$1\"; fi; }; download_to_stdout https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" || fail "Không nạp được nvm" "Kiểm tra $NVM_DIR/nvm.sh rồi chạy lại trình cài đặt." "Chưa chạm vào dữ liệu người dùng."
  run_step "Cài Node.js 20 và npm" nvm install 20 --latest-npm
  nvm use 20 >/dev/null
}

ensure_node_runtime() {
  if has_command node && assert_node_version && has_command npm; then
    return 0
  fi
  printf 'Node.js 20+/npm chưa sẵn sàng; Bestie sẽ cài Node.js 20 qua nvm.\n'
  install_node_with_nvm
  has_command node || fail "Không tìm thấy node sau khi cài" "Mở shell mới hoặc nạp ~/.nvm/nvm.sh rồi chạy lại trình cài đặt." "Chưa chạm vào dữ liệu người dùng."
  has_command npm || fail "Không tìm thấy npm sau khi cài" "Chạy nvm install 20 --latest-npm rồi chạy lại trình cài đặt." "Chưa chạm vào dữ liệu người dùng."
  assert_node_version || fail "Phiên bản Node.js vẫn chưa được hỗ trợ: $(node -v)" "Cài Node.js 20 trở lên rồi chạy lại trình cài đặt." "Chưa chạm vào dữ liệu người dùng."
}

assert_bestie_checkout() {
  local dir="$1"
  [[ -f "$dir/package.json" ]] || fail "$dir không phải checkout Bestie" "Chọn --dir trống hoặc một checkout Bestie hiện có." "Các file hiện có đã được giữ nguyên."
  node -e 'const pkg=require(process.argv[1]); if (pkg.name !== "bestie-agent" || !pkg.bin || pkg.bin.bestie !== "dist/cli/index.js") process.exit(1)' "$dir/package.json" \
    || fail "$dir không phải checkout Bestie hợp lệ" "Chọn --dir trống hoặc một checkout Bestie hiện có." "Các file hiện có đã được giữ nguyên."
}

copy_source_checkout() {
  local source="$1"
  [[ -d "$source" ]] || fail "Không tìm thấy thư mục nguồn: $source" "Truyền đường dẫn --source-dir hợp lệ." "Chưa chạm vào dữ liệu người dùng."
  assert_bestie_checkout "$source"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  if [[ -e "$INSTALL_DIR" ]]; then
    assert_bestie_checkout "$INSTALL_DIR"
  else
    mkdir -p "$INSTALL_DIR"
  fi
  run_step "Sao chép checkout Bestie local" rsync -a --delete \
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
      run_step "Cập nhật checkout Bestie hiện có" git -C "$INSTALL_DIR" pull --ff-only
    else
      printf 'Checkout Bestie hiện có không phải git repository; giữ nguyên và bỏ qua cập nhật.\n'
    fi
  else
    run_step "Clone Bestie" git clone "$REPO_URL" "$INSTALL_DIR"
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
  printf 'Đã cài lệnh bestie tại %s\n' "$target"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) printf 'Ghi chú: thêm %s vào PATH nếu shell chưa tìm thấy lệnh bestie.\n' "$BIN_DIR" ;;
  esac
}

maybe_run_onboard() {
  if [[ "$SKIP_ONBOARD" -eq 1 ]]; then
    return 0
  fi
  if [[ ! -t 0 ]]; then
    printf 'Bỏ qua onboarding vì stdin không tương tác. Chạy bestie onboard khi sẵn sàng.\n'
    return 0
  fi
  printf '\nChạy bestie onboard ngay bây giờ? [y/N] '
  local answer
  read -r answer || true
  case "${answer,,}" in
    y|yes) "$BIN_DIR/bestie" onboard ;;
    *) printf 'Bỏ qua onboarding. Chạy bestie onboard khi sẵn sàng.\n' ;;
  esac
}

main() {
  ensure_system_command git git
  ensure_node_runtime
  if [[ -n "$SOURCE_DIR" ]]; then
    ensure_system_command rsync rsync
  fi

  if [[ -n "$SOURCE_DIR" ]]; then
    copy_source_checkout "$SOURCE_DIR"
  else
    clone_or_update_checkout
  fi

  run_step "Cài dependencies" npm --prefix "$INSTALL_DIR" install
  run_step "Build Bestie" npm --prefix "$INSTALL_DIR" run build
  link_bestie_command
  run_doctor_preview
  maybe_run_onboard

  printf '\nCài đặt Bestie hoàn tất. Thử chạy: bestie chat\n'
}

main