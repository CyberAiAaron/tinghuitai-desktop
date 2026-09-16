#!/bin/bash
# 发行仓发布：走 PR 合入 main，不再管理员直推（Aaron 2026-09-16 定「留」PR 规则）。
# 用法: scripts/release-publish.sh <版本> [--dry-run]
# 前提: /tmp/tinghuitai-desktop-v<版本>.zip 已通过 check-package.sh；version.json/CHANGELOG.json 已更新。
set -euo pipefail
V="${1:?用法: release-publish.sh <版本> [--dry-run]}"; DRY="${2:-}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
ZIP="/tmp/tinghuitai-desktop-v${V}.zip"; [ -f "$ZIP" ] || { echo "❌ 缺 $ZIP"; exit 1; }
export GH_CONFIG_DIR="$HOME/.config/gh"
WORK=/tmp/rel-$V; mkdir -p "$WORK"
for R in CyberAiAaron GitAaronW; do
  D="$WORK/$R"
  if [ -d "$D/.git" ]; then git -C "$D" fetch -q origin main && git -C "$D" checkout -q -B main origin/main
  else gh repo clone "$R/tinghuitai-desktop" "$D" -- --depth 1 -q; fi
  cd "$D"; git checkout -q -B "release/v$V"
  cp "$ZIP" "tinghuitai-desktop-v$V.zip"; cp "$ZIP" tinghuitai-desktop.zip
  for f in version.json CHANGELOG.json README.md AI-SETUP.md 开始用.md; do [ -f "$SRC/$f" ] && cp "$SRC/$f" "$f"; done
  [ -d "$SRC/docs" ] && rsync -a --delete "$SRC/docs/" docs/
  git add -A
  git -c user.name="Aaron Wang" -c user.email="rangeraaronlol@gmail.com" commit -q -m "Publish $V" -m "$(python3 -c "import json;print(json.load(open('$SRC/CHANGELOG.json'))['items'][0]['notes'])")" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" || { echo "$R: 没有变化"; continue; }
  if [ "$DRY" = "--dry-run" ]; then echo "🧪 $R dry-run: $(git log --oneline -1) （未推送）"; continue; fi
  if [ "$R" = "GitAaronW" ]; then TOK="$(gh auth token --user GitAaronW)"; AUTH="-c credential.helper= -c http.extraheader=AUTHORIZATION:\ basic\ $(printf 'x-access-token:%s' "$TOK" | base64)"; else TOK="$(gh auth token --user CyberAiAaron)"; AUTH=""; fi
  eval git $AUTH push -q -f origin "release/v$V"
  PR=$(GH_TOKEN="$TOK" gh pr create -R "$R/tinghuitai-desktop" -B main -H "release/v$V" -t "Publish $V" -b "$(python3 -c "import json;print(json.load(open('$SRC/CHANGELOG.json'))['items'][0]['notes'])")

门禁：check-package 0 凭据 / npm test / 冒烟 / 全新安装 / 升级回滚（证据见 ~/Workbuddy/听会台日志）。

🤖 Generated with [Claude Code](https://claude.com/claude-code)")
  GH_TOKEN="$TOK" gh pr merge "$PR" -R "$R/tinghuitai-desktop" --squash --delete-branch
  echo "✅ $R 已合入 main：$PR"
done
sleep 4
for R in CyberAiAaron GitAaronW; do gh api -H "Accept: application/vnd.github.raw" "repos/$R/tinghuitai-desktop/contents/version.json" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  $R →',d['version'],'| sha',d['sha256'][:12])"; done
