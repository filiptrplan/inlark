#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./apps/desktop/package.json').version")
directory=apps/desktop/release/linux-unpacked
test -x "$directory/inlark"
test -f "$directory/resources/app.asar"
install -m644 LICENSE "$directory/resources/LICENSE.inlark"
mkdir -p apps/desktop/release/flatpak
archive="apps/desktop/release/flatpak/inlark-$version-x64.tar.gz"
tar -czf "$archive" -C "$directory" .
node scripts/prepare-flatpak.mjs "$version" "$archive"
