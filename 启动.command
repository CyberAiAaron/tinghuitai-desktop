#!/bin/bash
set -euo pipefail
THT_INSTALL_ROOT="${THT_DATA_DIR:-$HOME/Library/Application Support/Tinghuitai}"
if [[ ! -f "$THT_INSTALL_ROOT/node-path" ]]; then echo '请先打开 安装.command。';exit 1;fi
THT_NODE_EXEC="$(cat "$THT_INSTALL_ROOT/node-path")"
export THT_PYTHON="$(cat "$THT_INSTALL_ROOT/python-path")"
cd "$THT_INSTALL_ROOT/program"
exec "$THT_NODE_EXEC" scripts/launch.js
