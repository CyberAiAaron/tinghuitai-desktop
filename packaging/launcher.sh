#!/bin/bash
# 听会台.app 的入口：首次双击 = 安装，之后双击 = 启动。
# 程序仍然装到 ~/Library/Application Support/Tinghuitai/program，
# 这样现有的更新器、守护进程、回滚机制一行都不用改。
set -uo pipefail
BUNDLE="$(cd "$(dirname "$0")/../.." && pwd)"
RES="$BUNDLE/Contents/Resources"
ROOT="${THT_DATA_DIR:-$HOME/Library/Application Support/Tinghuitai}"
LOG="$ROOT/launcher.log"
mkdir -p "$ROOT" && chmod 700 "$ROOT"
exec 2>>"$LOG"
say(){ printf '[%s] %s\n' "$(date +%H:%M:%S)" "$1" >>"$LOG"; }
die(){ osascript -e "display alert \"听会台\" message \"$1\" as critical" >/dev/null 2>&1; exit 1; }
note(){ osascript -e "display notification \"$1\" with title \"听会台\"" >/dev/null 2>&1; }

if [[ "$(uname -s)" != Darwin ]] || [[ "$(sw_vers -productVersion | cut -d. -f1)" -lt 13 ]]; then
  die "需要 macOS 13 或更新版本。"
fi

# ---------- 1. 运行环境：找一个 Node 22+，找不到就从 Node 官方下载一份自用的 ----------
valid_node(){ [[ -x "$1" ]] && "$1" -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)' >/dev/null 2>&1; }
NODE=""
[[ -f "$ROOT/node-path" ]] && NODE="$(cat "$ROOT/node-path")"
if ! valid_node "$NODE"; then
  for c in "$ROOT"/runtime/node-*/bin/node /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node || true)"; do
    valid_node "$c" && { NODE="$c"; break; }
  done
fi
if ! valid_node "$NODE"; then
  case "$(uname -m)" in
    arm64)  ARCH=arm64; SHA=61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6;;
    x86_64) ARCH=x64;   SHA=58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026;;
    *) die "此芯片暂不支持。";;
  esac
  PKG="node-v22.23.2-darwin-$ARCH"
  mkdir -p "$ROOT/runtime"
  if [[ ! -x "$ROOT/runtime/$PKG/bin/node" ]]; then
    note "首次启动，正在准备运行环境（约 50MB，不需要密码）…"
    say "downloading $PKG"
    DL="$(mktemp -d "$ROOT/runtime/download.XXXXXX")"
    curl --fail --location --proto '=https' --tlsv1.2 \
      "https://nodejs.org/dist/v22.23.2/$PKG.tar.gz" -o "$DL/node.tar.gz" \
      || die "下载运行环境失败，请检查网络后重新打开听会台。"
    [[ "$(shasum -a 256 "$DL/node.tar.gz" | cut -d' ' -f1)" == "$SHA" ]] \
      || die "运行环境校验未通过，已中止安装。"
    tar -xzf "$DL/node.tar.gz" -C "$ROOT/runtime" || die "解压运行环境失败。"
    rm -rf "$DL"
  fi
  NODE="$ROOT/runtime/$PKG/bin/node"
fi
printf '%s\n' "$NODE" > "$ROOT/node-path"

# ---------- 2. 会后整理要用的 Python（缺了不挡录音） ----------
PY=""
for c in /opt/homebrew/bin/python3 /usr/local/bin/python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3; do
  [[ -x "$c" ]] && "$c" -c 'import sys; assert sys.version_info >= (3,9)' >/dev/null 2>&1 && { PY="$c"; break; }
done
if [[ -z "$PY" ]] && /usr/bin/xcode-select -p >/dev/null 2>&1 \
   && /usr/bin/python3 -c 'import sys; assert sys.version_info >= (3,9)' >/dev/null 2>&1; then PY=/usr/bin/python3; fi
printf '%s\n' "$PY" > "$ROOT/python-path"

# ---------- 3. 程序文件：.app 里的版本比已装的新就铺一遍 ----------
BUNDLED_VER="$("$NODE" -p "require('$RES/program/version.json').version" 2>/dev/null || echo 0)"
INSTALLED_VER="$("$NODE" -p "require('$ROOT/program/version.json').version" 2>/dev/null || echo 0)"
NEWER="$("$NODE" -e "
const a=String(process.argv[1]).split('.').map(Number),b=String(process.argv[2]).split('.').map(Number);
for(let i=0;i<3;i++){const x=a[i]||0,y=b[i]||0;if(x!==y){console.log(x>y?1:0);process.exit(0);}}
console.log(0);" "$BUNDLED_VER" "$INSTALLED_VER" 2>/dev/null || echo 1)"
# 同版本号重新打包（修复包不 bump 版本）时，version.json 里的 sha256 会变：也要铺一遍。
SAME_BUILD=1
if [[ "$BUNDLED_VER" == "$INSTALLED_VER" ]] && ! /usr/bin/cmp -s "$RES/program/version.json" "$ROOT/program/version.json"; then SAME_BUILD=0; fi
if [[ ! -f "$ROOT/program/scripts/launch.js" || "$NEWER" == "1" || "$SAME_BUILD" == "0" ]]; then
  say "installing program $BUNDLED_VER over $INSTALLED_VER"
  mkdir -p "$ROOT/program"
  /usr/bin/ditto "$RES/program" "$ROOT/program" || die "复制程序文件失败。"
fi

# ---------- 4. 起服务 ----------
cd "$ROOT/program" || die "程序文件不完整，请重新下载听会台。"
export THT_DATA_DIR="$ROOT"
[[ -n "$PY" ]] && export THT_PYTHON="$PY"
say "launch node=$NODE ver=$BUNDLED_VER"
exec "$NODE" scripts/launch.js
