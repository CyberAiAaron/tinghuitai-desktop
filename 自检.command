#!/bin/bash
set -euo pipefail
THT_INSTALL_ROOT="${THT_DATA_DIR:-$HOME/Library/Application Support/Tinghuitai}"
export THT_DATA_DIR="$THT_INSTALL_ROOT"
THT_NODE_EXEC="$(cat "$THT_INSTALL_ROOT/node-path" 2>/dev/null || true)"
if [[ ! -x "$THT_NODE_EXEC" ]]; then echo '运行路径失效，请从最新下载包打开 修复并打开.command。';exit 1;fi
if [[ -f "$THT_INSTALL_ROOT/python-path" ]]; then export THT_PYTHON="$(cat "$THT_INSTALL_ROOT/python-path")";fi
cd "$THT_INSTALL_ROOT/program"
"$THT_NODE_EXEC" scripts/doctor.js
if [[ -t 0 ]]; then read -r -p '按回车关闭。' _THT_DONE;fi
