#!/bin/bash
# 给子代理开 / 收一个独立的 git worktree。主会话只当调度：写施工单 → 子代理在 worktree 里干 → 主会话读 diff、合并、跑全量。
#   scripts/wt.sh new <名字>    建 /private/tmp/claude-501/wt-<名字>，分支 feat/<名字>，软链 node_modules，分一个没人占的端口
#   scripts/wt.sh done <名字>   拆掉软链 → 移除 worktree → 删分支（分支没合并会拒绝，加 --force 才强删）
#   scripts/wt.sh list
set -eu
cd "$(dirname "$0")/.."; REPO="$(pwd)"; BASE="/private/tmp/claude-501"
case "${1:-}" in
  new) N="$2"; W="$BASE/wt-$N"; git worktree add "$W" -b "feat/$N" HEAD > /dev/null
    ln -s "$REPO/node_modules" "$W/node_modules"
    PORT=47901; while lsof -ti:$PORT > /dev/null 2>&1 || grep -qs "PORT=$PORT" "$BASE"/wt-*/.wt-port 2>/dev/null; do PORT=$((PORT+2)); done
    echo "PORT=$PORT" > "$W/.wt-port"; echo "$W  分支 feat/$N  隔离端口 $PORT（停服务只按端口：lsof -ti:$PORT | while read p; do kill \"\$p\"; done）" ;;
  done) N="$2"; W="$BASE/wt-$N"; FORCE="${3:-}"
    if [ -f "$W/.wt-port" ]; then . "$W/.wt-port"; lsof -ti:"$PORT" 2>/dev/null | while read -r p; do kill "$p"; done; fi
    rm -f "$W/node_modules"; git worktree remove --force "$W"
    if [ "$FORCE" = "--force" ]; then git branch -D "feat/$N"; else git branch -d "feat/$N"; fi ;;
  list) git worktree list | cut -c1-160 ;;
  *) sed -n 2,6p "$0"; exit 2 ;;
esac
