#!/bin/bash
set -euo pipefail
THT_INSTALL_ROOT="${THT_DATA_DIR:-$HOME/Library/Application Support/Tinghuitai}"
THT_NODE_EXEC="$(cat "$THT_INSTALL_ROOT/node-path")"
export THT_PYTHON="$(cat "$THT_INSTALL_ROOT/python-path")"
cd "$THT_INSTALL_ROOT/program"
"$THT_NODE_EXEC" scripts/doctor.js
read -r -p '按回车关闭。' _THT_DONE
