#!/bin/bash
# 打一个可以双击安装、双击打开的「听会台.app」，再装进 .dmg。
# 用法: packaging/make-app.sh [输出目录]   默认输出到 /tmp/tinghuitai-app
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
# --trial：把公开试用用的火山凭据放进包，装完不用填任何东西就能转写。
# 凭据只从 ~/.claude-maint/tinghuitai-private/trial-preset.json 取，
# Aaron 自己每天用的那套（preset.json）永远不进包，check-package.sh 会拦。
TRIAL=0; OUT=""
for a in "$@"; do case "$a" in --trial) TRIAL=1;; *) OUT="$a";; esac; done
OUT="${OUT:-/tmp/tinghuitai-app}"
TRIALF="$HOME/.claude-maint/tinghuitai-private/trial-preset.json"
[ "$TRIAL" = 1 ] && [ ! -f "$TRIALF" ] && { echo "❌ 要打试用版，但找不到 $TRIALF"; exit 1; }
VER="$(node -p "require('$SRC/package.json').version")"
APP="$OUT/听会台.app"
rm -rf "$OUT"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# 1. 程序文件（与 安装.command 同一份清单，preset.json 永远不带）
mkdir -p "$APP/Contents/Resources/program"
for item in app web scripts docs tests node_modules version.json CHANGELOG.md CHANGELOG.json 开始用.md \
            package.json package-lock.json README.md AI-SETUP.md; do
  [ -e "$SRC/$item" ] && /usr/bin/ditto "$SRC/$item" "$APP/Contents/Resources/program/$item"
done
find "$APP/Contents/Resources/program" -name preset.json -delete
if [ "$TRIAL" = 1 ]; then
  install -m 600 "$TRIALF" "$APP/Contents/Resources/program/preset.json"
fi

# 2. 入口
cp "$SRC/packaging/launcher.sh" "$APP/Contents/MacOS/听会台"
chmod +x "$APP/Contents/MacOS/听会台"

# 3. 图标
ICONSET="$OUT/icon.iconset"; mkdir -p "$ICONSET"
for s in 16 32 64 128 256 512; do
  sips -z $s $s "$SRC/web/icon-512.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$SRC/web/icon-512.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/app.icns"
rm -rf "$ICONSET"

# 4. Info.plist
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>听会台</string>
  <key>CFBundleDisplayName</key><string>听会台</string>
  <key>CFBundleExecutable</key><string>听会台</string>
  <key>CFBundleIdentifier</key><string>com.aaron.tinghuitai</string>
  <key>CFBundleVersion</key><string>$VER</string>
  <key>CFBundleShortVersionString</key><string>$VER</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>app.icns</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>听会台需要麦克风来转写你正在开的会。录音只留在这台电脑上。</string>
</dict></plist>
PLIST

# 5. ad-hoc 签名：没有开发者账号也能避免「已损坏」提示（首次仍需右键打开）
# 方案 B（苹果开发者签名 + 公证）：设了 THT_DEVELOPER_ID 就用正式身份签，没设照旧 ad-hoc。
# 例：THT_DEVELOPER_ID="Developer ID Application: Aaron Wang (TEAMID)" THT_NOTARY_PROFILE=tht-notary
if [ -n "${THT_DEVELOPER_ID:-}" ]; then
  codesign --force --deep --options runtime --timestamp --sign "$THT_DEVELOPER_ID" "$APP" || { echo "❌ Developer ID 签名失败"; exit 1; }
else
  codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || echo "⚠️ ad-hoc 签名失败，继续"
fi

# 6. .dmg：拖进 Applications 就算装好
STAGE="$OUT/dmg"; mkdir -p "$STAGE"
/usr/bin/ditto "$APP" "$STAGE/听会台.app"
ln -s /Applications "$STAGE/应用程序"
cp "$SRC/packaging/首次打开必读.txt" "$STAGE/首次打开必读.txt" 2>/dev/null || true
hdiutil create -volname "听会台 $VER" -srcfolder "$STAGE" -ov -format UDZO \
  "$OUT/听会台-$VER.dmg" >/dev/null
rm -rf "$STAGE"
# 最终交付物是 dmg，不是 .app 目录：挂出来对 dmg 里的内容再跑一遍闸门
MNT=$(mktemp -d)
hdiutil attach "$OUT/听会台-$VER.dmg" -nobrowse -readonly -mountpoint "$MNT" >/dev/null || { echo "❌ dmg 挂载失败"; exit 1; }
GATE_ARGS=("$MNT"); [ "$TRIAL" = 1 ] && GATE_ARGS+=(--trial)
GATE_RC=0; bash "$SRC/scripts/check-package.sh" "${GATE_ARGS[@]}" || GATE_RC=$?
hdiutil detach "$MNT" -quiet; rmdir "$MNT" 2>/dev/null
[ $GATE_RC = 0 ] || { rm -f "$OUT/听会台-$VER.dmg"; echo "❌ dmg 凭据闸门拒绝，已删掉这个 dmg"; exit 1; }
# 公证：凭据事先用 `xcrun notarytool store-credentials tht-notary` 存进钥匙串，脚本里不出现密码
if [ -n "${THT_DEVELOPER_ID:-}" ] && [ -n "${THT_NOTARY_PROFILE:-}" ]; then
  codesign --force --timestamp --sign "$THT_DEVELOPER_ID" "$OUT/听会台-$VER.dmg"
  xcrun notarytool submit "$OUT/听会台-$VER.dmg" --keychain-profile "$THT_NOTARY_PROFILE" --wait || { echo "❌ 公证没过"; exit 1; }
  xcrun stapler staple "$OUT/听会台-$VER.dmg" && echo "✅ 已公证并钉签"
fi

# 发布前的凭据闸门就在这里跑一次，漏配的包出不了这个脚本
if [ "$TRIAL" = 1 ]; then bash "$SRC/scripts/check-package.sh" "$APP" --trial || { echo "❌ 凭据闸门拒绝，产物留在 $OUT 供排查"; exit 1; }
else bash "$SRC/scripts/check-package.sh" "$APP" || { echo "❌ 凭据闸门拒绝"; exit 1; }; fi

echo "✅ $APP"
echo "✅ $OUT/听会台-$VER.dmg  ($(du -h "$OUT/听会台-$VER.dmg" | cut -f1))"
