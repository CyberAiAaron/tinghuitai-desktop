#!/bin/bash
set -euo pipefail
THT_INSTALL_ROOT="${THT_DATA_DIR:-$HOME/Library/Application Support/Tinghuitai}"
export THT_DATA_DIR="$THT_INSTALL_ROOT"
THT_NODE_EXEC=""
if [[ -f "$THT_INSTALL_ROOT/node-path" ]]; then THT_NODE_EXEC="$(cat "$THT_INSTALL_ROOT/node-path")"; fi
valid_node() { [[ -x "$1" ]] && "$1" -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)' >/dev/null 2>&1; }
if ! valid_node "$THT_NODE_EXEC"; then
  for candidate in "$THT_INSTALL_ROOT"/runtime/node-*/bin/node /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node || true)"; do
    if valid_node "$candidate"; then THT_NODE_EXEC="$candidate"; break; fi
  done
fi
if ! valid_node "$THT_NODE_EXEC"; then echo '未找到可用的运行环境。请打开新下载包里的 安装.command 修复；原来的会议和设置会保留。'; exit 1; fi
if [[ ! -f "$THT_INSTALL_ROOT/program/scripts/launch.js" ]]; then echo '程序文件不完整。请打开新下载包里的 安装.command 修复；不要删除资料目录。'; exit 1; fi
printf '%s\n' "$THT_NODE_EXEC" > "$THT_INSTALL_ROOT/node-path"
if [[ -f "$THT_INSTALL_ROOT/python-path" ]]; then
  THT_PYTHON_CANDIDATE="$(cat "$THT_INSTALL_ROOT/python-path")"
  if [[ -x "$THT_PYTHON_CANDIDATE" ]]; then export THT_PYTHON="$THT_PYTHON_CANDIDATE"; fi
fi
cd "$THT_INSTALL_ROOT/program"
exec "$THT_NODE_EXEC" scripts/launch.js
