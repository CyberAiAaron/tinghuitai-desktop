#!/bin/bash
# Build the public source ZIP from an explicit allowlist. No local settings,
# credentials, caches, agent instructions, or repository metadata are copied.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
V="$(node -p "require('$SRC/package.json').version")"
OUT="${1:-/tmp/tinghuitai-desktop-v${V}.zip}"
STAGE="$(mktemp -d /tmp/tinghuitai-release.XXXXXX)"
ROOT="$STAGE/tinghuitai-desktop"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$ROOT"

for item in app web scripts docs tests node_modules version.json CHANGELOG.json package.json package-lock.json README.md AI-SETUP.md 开始用.md 安装.command 启动.command 修复并打开.command 自检.command; do
  [ -e "$SRC/$item" ] && /usr/bin/ditto "$SRC/$item" "$ROOT/$item"
done
find "$ROOT" -name '.DS_Store' -delete
find "$ROOT" \( -name 'preset.json' -o -name '.env' -o -name '*.pem' \) -delete
rm -f "$OUT"
(cd "$STAGE" && /usr/bin/ditto -c -k --sequesterRsrc tinghuitai-desktop "$OUT")
echo "$OUT"
