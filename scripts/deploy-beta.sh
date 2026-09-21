#!/bin/bash
# 把源码装到 Aaron 本机的安装目录（beta，只他一个人用）。不改版本号、不打包、不推远端。
# 顺序写死：有会在开就拒绝 → 全量测试 fail 0 → 存回退快照 → 备份设置 → 同步文件 → 重启 → 等健康检查 → 逐文件比对。
#   scripts/deploy-beta.sh            真装
#   scripts/deploy-beta.sh --check    只做前两步，什么都不改
set -u
cd "$(dirname "$0")/.." || exit 2
export PATH="/Users/aaron.wang/.local/bin:$PATH"
DATA="$HOME/Library/Application Support/TinghuitaiAaron"; PROG="$DATA/program"; PORT=47823; LABEL="com.aaron.tinghuitai-desktop"
health() { curl -s -m 3 "http://127.0.0.1:$PORT/health"; }
field() { python3 -c "import sys,json; print(json.load(sys.stdin).get('$1',''))" 2>/dev/null; }
ACTIVE=$(health | field activeSessions)
[ "$ACTIVE" = "0" ] || { echo "拒绝：activeSessions=${ACTIVE:-读不到}，有会在开或服务没起，不重启"; exit 1; }
[ -z "$(git status --porcelain -- app web scripts tests)" ] || { echo "拒绝：有没提交的改动，装上去的必须是一个提交"; exit 1; }
scripts/t.sh --all || { echo "拒绝：测试没过"; exit 1; }
[ "${1:-}" = "--check" ] && { echo "检查通过，没有改任何东西"; exit 0; }
( cd "$PROG" && node scripts/snapshot-prev.js ) || { echo "回退快照失败，停"; exit 1; }
cp "$DATA/settings.json" "$DATA/settings.json.before-deploy-$(date +%Y%m%d-%H%M%S)"
for d in app web scripts tests; do rsync -a --delete --exclude '__pycache__' "$d/" "$PROG/$d/"; done
BEFORE=$(health | field pid)
launchctl kickstart -k "gui/$(id -u)/$LABEL"
for i in $(seq 1 30); do sleep 1; NOW=$(health | field pid); [ -n "$NOW" ] && [ "$NOW" != "$BEFORE" ] && break; done
[ -n "${NOW:-}" ] && [ "$NOW" != "$BEFORE" ] || { echo "重启后 30 秒健康检查没回来（旧 pid $BEFORE）。回退：在设置里点「回到上一版」或把 .prev 拷回"; exit 1; }
DIFF=0; for d in app web scripts; do diff -rq -x '__pycache__' "$d" "$PROG/$d" > /dev/null || DIFF=1; done
echo "已装 $(git log --oneline -1 | cut -c1-70) · pid $BEFORE → $NOW · 文件比对 $([ $DIFF = 0 ] && echo 一致 || echo 不一致)"
health | python3 -c "import sys,json; j=json.load(sys.stdin); print({k:j.get(k) for k in ['version','activeSessions','llmChain','llmDegraded','tools']})"
[ $DIFF = 0 ]
