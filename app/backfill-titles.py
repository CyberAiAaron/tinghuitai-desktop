#!/usr/bin/env python3
"""为已有历史场次补生成主题标题，写入 state/meeting-titles.json。只读会议数据，不改原件。
用法：python3 backfill-titles.py [--dry-run] [--limit N]
"""
import argparse, importlib.util, json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('mp', ROOT / 'meeting-pipeline.py')
# 独立版：数据目录来自 THT_DATA_DIR（config.js 同款默认值）
import os; os.environ.setdefault('THT_DATA_DIR', str(pathlib.Path.home()/'Library/Application Support/Tinghuitai'))
mp = importlib.util.module_from_spec(spec); spec.loader.exec_module(mp)

def candidates():
    seen = {}
    for job_path in sorted((mp.STATE).glob('*.job.json')):
        job = mp.read(job_path, {}) or {}
        sid = str(job.get('sessionId') or '')
        if not sid: continue
        enhanced = mp.read(job_path.with_suffix('.enhanced.json')) or mp.read(pathlib.Path(job.get('input', '')), {}) or {}
        if enhanced: seen[sid] = enhanced
    pending = mp.ROOT / 'pending'
    if pending.is_dir():
        for f in sorted(pending.iterdir()):
            if not (f.name.startswith(('sess-', 'offline-')) and '.json' in f.name): continue
            try: s = json.loads(f.read_text())
            except Exception: continue
            sid = str(s.get('id') or '')
            if sid and sid not in seen: seen[sid] = s
    return seen

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--dry-run', action='store_true'); ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args()
    titles = mp.read(mp.TITLES, {}) or {}
    todo = [(sid, s) for sid, s in candidates().items() if not (titles.get(sid) or {}).get('topicTitle') and (s.get('summary') or any(r.get('text') for r in s.get('transcript', [])))]
    print(f'已有标题 {len(titles)}，待生成 {len(todo)}')
    if a.dry_run:
        for sid, s in todo: print(' ', sid, str(s.get('start'))[:16], (s.get('title') or '')[:24])
        return
    ok = fail = 0
    for sid, s in (todo[:a.limit] if a.limit else todo):
        try:
            t = mp.title_for(s, s.get('summary', '')); mp.save_title(sid, t); ok += 1; print('  ✓', sid, t)
        except Exception as e:
            fail += 1; print('  ✗', sid, e, file=sys.stderr)
    print(f'完成：成功 {ok}，失败 {fail}')

if __name__ == '__main__': main()
