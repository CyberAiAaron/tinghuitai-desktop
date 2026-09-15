#!/usr/bin/env python3
"""Explicit archive of an immutable meeting snapshot; never edits recording files."""
import importlib.util, pathlib, sys, fcntl
spec=importlib.util.spec_from_file_location('pipeline',pathlib.Path(__file__).with_name('meeting-pipeline.py'))
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
f=pathlib.Path(sys.argv[1])
with f.with_suffix('.lock').open('a') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX)
    job=p.read(f)
    def save():p.write(f,job)
    try:
        job.update(status='running',archiveTargetRequest='lark');save()
        p.archive_version(job,job['session'],'会议归档',save)
        index=p.read(p.ROOT/'settings.json',{}).get('LARK_ARCHIVE_INDEX')
        if index:
            p.ensure_private(index)
            live=p.fetch(index)
            if job['docId'] not in live:
                p.cli(['docs','+update','--doc',index,'--command','append','--doc-format','xml','--content','-'],p.ptext(str(job['session'].get('start',''))[:10])+'<p><a href="'+p.html.escape(job['url'],quote=True)+'">'+p.html.escape(job.get('title') or '会议')+'</a></p>')
                live=p.fetch(index)
            if job['docId'] not in live:raise RuntimeError('会议档案索引回读失败，请重试')
        job.update(status='done',error='');save()
    except Exception as e:
        job.update(status='error',error=str(e)[:300]);save();sys.exit(1)
