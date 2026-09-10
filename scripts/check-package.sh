#!/bin/bash
# 打包前的凭据闸门：任何一条私有凭据出现在待发布的包里就拒绝发布。
# 私有凭据只放在 ~/.claude-maint/tinghuitai-private/preset.json，永远不进这个目录。
set -u
ZIP="${1:?用法: check-package.sh <待发布的 zip>}"
PRIV="$HOME/.claude-maint/tinghuitai-private/preset.json"
[ -f "$PRIV" ] || { echo "找不到私有凭据文件，无法比对，拒绝发布"; exit 2; }
TMP=$(mktemp -d) || exit 2
unzip -qo "$ZIP" -d "$TMP" || { echo "解压失败"; rm -rf "$TMP"; exit 2; }
python3 - "$TMP" "$PRIV" <<'PY'
import json,sys,pathlib
root=pathlib.Path(sys.argv[1]); priv=json.load(open(sys.argv[2]))
secrets={k:priv[k] for k in ['VOLC_APP_KEY','VOLC_ACCESS_KEY','DEEPSEEK_API_KEY','RELAY_TOKEN'] if priv.get(k)}
hits=[]
for f in root.rglob('*'):
    if not f.is_file(): continue
    try: t=f.read_text(errors='ignore')
    except Exception: continue
    for k,v in secrets.items():
        if v in t: hits.append(f'{f.relative_to(root)} 含 {k}')
if any(p.name=='preset.json' for p in root.rglob('*')): hits.append('包里出现了 preset.json')
if hits:
    print('拒绝发布，包里有凭据：'); [print('  '+h) for h in hits]; sys.exit(1)
print(f'凭据闸门通过：扫了 {sum(1 for f in root.rglob("*") if f.is_file())} 个文件，0 条凭据')
PY
rc=$?
rm -rf "$TMP"
exit $rc
