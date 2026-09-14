#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ "$(uname -s)" != Darwin ]] || [[ "$(sw_vers -productVersion | cut -d. -f1)" -lt 13 ]]; then echo '需要 macOS 13 或更新版本。'; exit 1; fi
THT_INSTALL_ROOT="${THT_DATA_DIR:-$HOME/Library/Application Support/Tinghuitai}"
mkdir -p "$THT_INSTALL_ROOT/runtime" "$THT_INSTALL_ROOT/program"
chmod 700 "$THT_INSTALL_ROOT"
if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)' >/dev/null 2>&1; then
 case "$(uname -m)" in
 arm64) THT_ARCH=arm64; THT_SHA=61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6;;
 x86_64) THT_ARCH=x64; THT_SHA=58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026;;
 *) echo '此芯片暂不支持。';exit 1;; esac
 THT_NODE="node-v22.23.2-darwin-$THT_ARCH"
 if [[ ! -x "$THT_INSTALL_ROOT/runtime/$THT_NODE/bin/node" ]]; then
  echo '首次安装：从 Node 官方下载运行环境，不需要管理员密码。'
  THT_DOWNLOAD="$(mktemp -d "$THT_INSTALL_ROOT/runtime/download.XXXXXX")"
  curl --fail --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v22.23.2/$THT_NODE.tar.gz" -o "$THT_DOWNLOAD/node.tar.gz"
  [[ "$(shasum -a 256 "$THT_DOWNLOAD/node.tar.gz" | cut -d' ' -f1)" == "$THT_SHA" ]] || { echo '下载校验未通过，未执行安装。';exit 1; }
  tar -xzf "$THT_DOWNLOAD/node.tar.gz" -C "$THT_INSTALL_ROOT/runtime"
 fi
 export PATH="$THT_INSTALL_ROOT/runtime/$THT_NODE/bin:$PATH"
fi
# Python is needed for post-processing, not to launch or record. Do not invoke the CLT stub.
THT_PYTHON_EXEC=""
for candidate in /opt/homebrew/bin/python3 /usr/local/bin/python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3; do
 if [[ -x "$candidate" ]] && "$candidate" -c 'import sys; assert sys.version_info >= (3,9)' >/dev/null 2>&1; then THT_PYTHON_EXEC="$candidate";break;fi
done
if [[ -z "$THT_PYTHON_EXEC" ]] && /usr/bin/xcode-select -p >/dev/null 2>&1 && /usr/bin/python3 -c 'import sys; assert sys.version_info >= (3,9)' >/dev/null 2>&1; then THT_PYTHON_EXEC=/usr/bin/python3;fi
if [[ -z "$THT_PYTHON_EXEC" ]]; then echo '可以先录音和转写。会后自动整理需要 Python 3.9+，未安装时原始记录保留。';fi
if [[ "$PWD" != "$THT_INSTALL_ROOT/program" ]]; then
for item in app web scripts docs tests node_modules version.json CHANGELOG.json 开始用.md package.json package-lock.json README.md AI-SETUP.md '安装.command' '启动.command' '自检.command'; do
 [[ -e "$item" ]] && /usr/bin/ditto "$item" "$THT_INSTALL_ROOT/program/$item"
done
fi
THT_NODE_EXEC="$(command -v node)"
printf '%s\n' "$THT_NODE_EXEC" > "$THT_INSTALL_ROOT/node-path"
printf '%s\n' "$THT_PYTHON_EXEC" > "$THT_INSTALL_ROOT/python-path"
cd "$THT_INSTALL_ROOT/program"
if ! node -e "require('ws');require('busboy')" >/dev/null 2>&1; then
 echo '修复缺失的运行依赖…'
 npm ci --ignore-scripts --no-audit --no-fund
fi
chmod +x ./*.command
export THT_DATA_DIR="$THT_INSTALL_ROOT"
export THT_PYTHON="${THT_PYTHON_EXEC:-/nonexistent/tinghuitai-python}"
node scripts/doctor.js
node scripts/launch.js
