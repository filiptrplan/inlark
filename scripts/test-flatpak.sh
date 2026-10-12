#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
id=com.inlark.Inlark
if [[ $# -gt 0 ]]; then
  bundle=$1
else
  version=$(node -p "require('./apps/desktop/package.json').version")
  bundle="apps/desktop/release/inlark-$version-x64.flatpak"
fi
bundle=$(realpath "$bundle")
# Keep both the installation and test data separate from the user's real app.
smoke_root=$(mktemp -d)
trap 'rm -rf "$smoke_root"' EXIT
export XDG_DATA_HOME="$smoke_root/data"
export XDG_CONFIG_HOME="$smoke_root/config"
export XDG_CACHE_HOME="$smoke_root/cache"
export XDG_RUNTIME_DIR="$smoke_root/runtime"
mkdir -m700 "$XDG_RUNTIME_DIR"
flatpak install --user --noninteractive --assumeyes --reinstall "$bundle"
# Use a disposable directory inside the sandbox: never read real account data.
# Zypak provides Chromium's sandbox; the test keeps it enabled.
result=0
env -u WAYLAND_DISPLAY -u ELECTRON_RUN_AS_NODE xvfb-run -a timeout --kill-after=10s 90s dbus-run-session -- flatpak run --user --branch=stable \
  --unset-env=FONTCONFIG_FILE --unset-env=FONTCONFIG_PATH \
  --env=INLARK_DATA_DIR=/tmp/inlark-flatpak-smoke \
  "$id" --smoke-test --ozone-platform=x11 --disable-gpu > "$smoke_root/output.log" 2>&1 || result=$?
cat "$smoke_root/output.log"
if [[ "$result" -ne 0 ]]; then exit "$result"; fi
grep -F 'Native IPC smoke test passed:' "$smoke_root/output.log"
