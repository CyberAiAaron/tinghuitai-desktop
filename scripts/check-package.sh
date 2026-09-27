#!/bin/bash
# 打包前的凭据闸门。
#
# 两类凭据，规则不同（2026-09-24 Aaron 定「试用版默认带上火山，给所有人用」）：
#   私有  ~/.claude-maint/tinghuitai-private/preset.json        永远不许进包。
#   试用  ~/.claude-maint/tinghuitai-private/trial-preset.json  只有 --trial 才许进包，
#                                                               且包里的 preset.json 必须与它逐字一致。
# 没有 --trial 时行为和以前一样：包里出现任何 preset.json 就拒。
set -u
TRIAL=0; ZIP=""
for a in "$@"; do case "$a" in --trial) TRIAL=1;; *) ZIP="$a";; esac; done
[ -n "$ZIP" ] || { echo "用法: check-package.sh <待发布的 zip 或 app 目录> [--trial]"; exit 2; }
PRIV="$HOME/.claude-maint/tinghuitai-private/preset.json"
TRIALF="$HOME/.claude-maint/tinghuitai-private/trial-preset.json"
[ -f "$PRIV" ] || { echo "找不到私有凭据文件，无法比对，拒绝发布"; exit 2; }
[ "$TRIAL" = 1 ] && [ ! -f "$TRIALF" ] && { echo "要发试用版，但找不到 $TRIALF，拒绝发布"; exit 2; }

TMP=$(mktemp -d) || exit 2
if [ -d "$ZIP" ]; then /usr/bin/ditto "$ZIP" "$TMP" || { echo "复制失败"; rm -rf "$TMP"; exit 2; }
else unzip -qo "$ZIP" -d "$TMP" || { echo "解压失败"; rm -rf "$TMP"; exit 2; }; fi

python3 - "$TMP" "$PRIV" "$TRIALF" "$TRIAL" <<'PY'
import json,sys,pathlib
root=pathlib.Path(sys.argv[1]); priv=json.load(open(sys.argv[2]))
trial_path=pathlib.Path(sys.argv[3]); trial_mode=sys.argv[4]=='1'
trial=json.load(open(trial_path)) if trial_path.exists() else {}
trial_bytes=open(trial_path,'rb').read() if trial_path.exists() else None
hits=[]

# 私有凭据：一个字都不许出现
# 私有文件里每个字段都必须归类：公开配置（代码默认值里本来就有）放行，其余一律当密钥。
# 密钥太短（<8）没法在包里可靠地搜，宁可拒发也不猜——以后私有文件多了字段，默认就是拒。
PUBLIC_CFG=('LLM_BASE_URL','LLM_MODEL','VOLC_RESOURCE_ID','PRESET_VERSION','JEV_GATE','JEV_THRESHOLD','JEV_MIN_GAP_MS')
secrets={}
for k,v in priv.items():
    if k in PUBLIC_CFG or v in (None,'',[],{}): continue
    sv=v if isinstance(v,str) else json.dumps(v)
    if len(sv.strip())<8: hits.append(f'私有文件字段 {k} 不是公开配置、值又太短没法可靠扫描：先把它归类再发布')
    else: secrets[k]=sv

# 试用凭据不能和私有的是同一套，否则「作废试用不影响自己」这条就是假的
for k,v in secrets.items():
    if trial.get(k)==v: hits.append(f'试用凭据的 {k} 和你自己那套是同一个，等于没隔离')

files=[f for f in root.rglob('*') if f.is_file()]
# 按字节扫，覆盖常见变形：原文 / UTF-16 / base64（三种对齐）/ hex / URL 编码；zip 与 gzip 解开再扫
import base64, binascii, gzip, zipfile, io, urllib.parse
def variants(v):
    b=v.encode(); out={b, v.encode('utf-16-le'), b.hex().encode(), b.hex().upper().encode(), urllib.parse.quote(v,safe='').encode()}
    for i in range(3):
        e=base64.b64encode(b'\0'*i+b)[4 if i else 0:]; e=e[:max(0,len(e)-4)]
        if len(e)>=8: out.add(e); out.add(e.replace(b'+',b'-').replace(b'/',b'_'))
    return [x for x in out if len(x)>=8]
needles={k:variants(v) for k,v in secrets.items()}
def scan(name, data, depth=0):
    for k,vs in needles.items():
        if any(x in data for x in vs): hits.append(f'{name} 含私有 {k}（原文或编码形式）')
    if depth>2: return
    if data[:2]==b'\x1f\x8b':
        try: scan(name+'!gunzip', gzip.decompress(data), depth+1)
        except Exception: pass
    if data[:4]==b'PK\x03\x04':
        try:
            z=zipfile.ZipFile(io.BytesIO(data))
            for m in z.namelist(): scan(f'{name}!{m}', z.read(m), depth+1)
        except Exception: pass
for f in files:
    try: data=f.read_bytes()
    except Exception as e: hits.append(f'{f.relative_to(root)} 读不了，无法证明干净：{e}'); continue
    scan(str(f.relative_to(root)), data)

presets=[p for p in files if p.name=='preset.json']
if not trial_mode:
    for p in presets: hits.append(f'包里出现了 preset.json（{p.relative_to(root)}）')
else:
    if not presets: hits.append('要发试用版，但包里没有 preset.json')
    elif len(presets)>1:
        hits.append('包里有 %d 份 preset.json，只许一份：%s' % (len(presets), [str(x.relative_to(root)) for x in presets]))
    for p in presets:
        rel=str(p.relative_to(root))
        if rel not in ('Contents/Resources/program/preset.json','preset.json','听会台.app/Contents/Resources/program/preset.json'):
            hits.append(f'preset.json 出现在预期之外的位置：{rel}')
    for p in presets:
        try: got=json.load(open(p))
        except Exception: hits.append(f'{p.relative_to(root)} 不是合法 JSON'); continue
        if trial_bytes is None: hits.append(f'{p.relative_to(root)}：找不到 trial-preset.json，无法逐字核对')
        elif open(p,'rb').read()!=trial_bytes: hits.append(f'{p.relative_to(root)} 与 trial-preset.json 不是逐字相同（字节级比对失败）')
        want={'VOLC_APP_KEY','VOLC_ACCESS_KEY','VOLC_RESOURCE_ID','PRESET_VERSION'}
        if not isinstance(got,dict) or set(got)!=want:
            hits.append(f'{p.relative_to(root)} 字段必须恰好是 {sorted(want)}，实际 {sorted(got) if isinstance(got,dict) else type(got).__name__}')
        else:
            empty=[k for k in want if not isinstance(got[k],str) or not got[k].strip()]
            if empty: hits.append(f'{p.relative_to(root)} 这些字段为空或不是字符串：{empty}')

if hits:
    print('拒绝发布：'); [print('  '+h) for h in hits]; sys.exit(1)
mode='试用版（带公开转写凭据）' if trial_mode else '标准版（0 凭据）'
print(f'凭据闸门通过 · {mode}：扫了 {len(files)} 个文件，0 条私有凭据')
PY
rc=$?
rm -rf "$TMP"
exit $rc
