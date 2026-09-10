'use strict';
// 录音管理·删除与恢复：只动这台 Mac 上的记录，绝不碰飞书文档。
// manifest.json 既是清单也是事务日志：先写清单（moved:false）再逐项移动，中断后向前续做；
// 恢复按项对账（原路径/回收路径/内容哈希），原路径被不同内容占用时不覆盖。
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const settings = require('./config');
const DATA = process.env.THT_DATA_DIR || settings.dataDir;
const PENDING_DIR = process.env.THT_PENDING_DIR || path.join(DATA, 'pending');
const AUDIO_DIR = process.env.THT_AUDIO_DIR || path.join(DATA, 'audio');
const PIPE_DIR = process.env.THT_PIPELINE_DIR || path.join(DATA, 'state', 'meeting-pipeline');
const LIVE_DIR = path.join(DATA, 'state', 'live-sessions');
const TITLES = path.join(path.dirname(PIPE_DIR), 'meeting-titles.json');
const SESSIONS_DIR = path.join(DATA, 'sessions');
const INDEX_MD = path.join(DATA, 'meetings-index.md');
const ARCHIVE_DIR = process.env.THT_ARCHIVE_DIR || path.join(DATA, 'exports');
const TRASH = process.env.THT_TRASH_DIR || path.join(DATA, 'state', 'trash');
const RETAIN_MS = 30 * 24 * 3600 * 1000;
const HASH_MAX = 512 * 1024 * 1024;

const ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
function assertId(id){ if (!ID_RE.test(String(id))) throw Object.assign(new Error('会议编号不合法'), { status: 400 }); return String(id); }
const sha16 = id => crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 16);
const sha24 = id => crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 24);
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };
function writeAtomic(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp'; const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, p);
}
function fileHash(p) {
  try {
    const st = fs.statSync(p);
    if (st.size > HASH_MAX) return null;                 // 超大文件跳过哈希：恢复时按「无法证明相同」处理，保留两边
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  } catch (e) { return null; }
}
const manifestPath = id => path.join(TRASH, sha16(id), 'manifest.json');
const filesRoot = id => path.join(TRASH, sha16(id), 'files');

// ——— 精确文件清单：全部由 id/key 推出确定文件名，或按内容匹配；不用通配符 ———
function enumerate(id, session) {
  assertId(id);
  const key = sha16(id), items = [];
  // 每条都必须落在预期的基目录里，推导出来的路径也不例外
  const BASES = [PENDING_DIR, AUDIO_DIR, PIPE_DIR, LIVE_DIR, SESSIONS_DIR, ARCHIVE_DIR, path.dirname(TITLES), DATA];
  const add = (from, kind, extra) => {
    if (!BASES.some(b => insideDir(from, b))) return;
    let st = null; try { st = fs.statSync(from); } catch (e) {}
    items.push(Object.assign({ from, kind: kind || 'file', missing: !st, size: st ? st.size : 0, mtime: st ? Math.round(st.mtimeMs) : 0, sha256: st && st.isFile() ? fileHash(from) : null, moved: false, error: '' }, extra || {}));
  };
  for (const n of [`sess-${id}.json`, `sess-${id}.json.done`, `${offlineName(id)}`, `${offlineName(id)}.done`, `archive-${id}-lark.json`, `archive-${id}-notion.json`])
    if (fs.existsSync(path.join(PENDING_DIR, n))) add(path.join(PENDING_DIR, n));
  if (fs.existsSync(path.join(LIVE_DIR, id + '.json'))) add(path.join(LIVE_DIR, id + '.json'));
  let audio = session && session.audioPath ? String(session.audioPath) : '';
  if (!audio || !insideDir(audio, AUDIO_DIR)) audio = path.join(AUDIO_DIR, id + '.pcm');
  if (fs.existsSync(audio)) add(audio);
  try { for (const n of fs.readdirSync(PIPE_DIR)) if (n.startsWith(key + '.')) add(path.join(PIPE_DIR, n)); } catch (e) {}
  // sessKey 有 meeting: / assistant: / archive: / assistant:live-group: 等多种前缀，一律按「以 :<id>.md 结尾」匹配
  const sessNames = [];
  try { for (const n of fs.readdirSync(SESSIONS_DIR)) if (n.endsWith(':' + id + '.md') || n === id + '.md') { sessNames.push(n); add(path.join(SESSIONS_DIR, n)); } } catch (e) {}
  const idx = readJSON(path.join(SESSIONS_DIR, 'index.json'), null);
  if (idx) { const keys = Object.keys(idx).filter(k => k === id || k.endsWith(':' + id)); if (keys.length) items.push({ from: path.join(SESSIONS_DIR, 'index.json'), kind: 'sessindex', payload: keys.reduce((o, k) => (o[k] = idx[k], o), {}), moved: false, missing: false, error: '' }); }
  try { for (const n of fs.readdirSync(path.dirname(PIPE_DIR))) if (n.startsWith('archive-sent-' + id + '-')) add(path.join(path.dirname(PIPE_DIR), n)); } catch (e) {}
  try {
    for (const n of fs.readdirSync(ARCHIVE_DIR)) {
      if (!n.endsWith('.json')) continue;
      const j = readJSON(path.join(ARCHIVE_DIR, n), null);
      if (j && String(j.id) === String(id)) add(path.join(ARCHIVE_DIR, n));
    }
  } catch (e) {}
  const titles = readJSON(TITLES, {}) || {};
  if (titles[String(id)]) items.push({ from: TITLES, kind: 'titles', payload: titles[String(id)], key: String(id), moved: false, missing: false, error: '' });
  const line = indexLineFor(id);
  if (line) items.push({ from: INDEX_MD, kind: 'index', payload: line, moved: false, missing: false, error: '' });
  return items;
}
function offlineName(id) { return 'offline-' + sha24(id) + '.json'; }
function insideDir(p, dir) { try { return path.resolve(p).startsWith(path.resolve(dir) + path.sep); } catch (e) { return false; } }
// meeting-pipeline.py 写的是 `| {start} | {title} | {sid} | {one} |`，按 sid 精确匹配，别用标题子串（会误删别人的行）
function indexLineFor(id) {
  try {
    const body = fs.readFileSync(INDEX_MD, 'utf8');
    for (const l of body.split('\n')) if (l.includes('| ' + id + ' |')) return l;
  } catch (e) {}
  return '';
}
function jobFor(id) { return readJSON(path.join(PIPE_DIR, sha16(id) + '.job.json'), null); }

// ——— 删除：先写清单，再逐项移动，逐项落盘 ———
function remove(id, session, meta) {
  assertId(id);
  const dir = path.join(TRASH, sha16(id));
  let man = readJSON(manifestPath(id), null);
  if (!man) {
    const job = jobFor(id) || {};
    man = {
      v: 1, id: String(id), key: sha16(id), state: 'moving',
      title: (session && (session.topicTitle || session.title)) || (meta && meta.title) || '',
      start: (session && session.start) || null,
      deletedAt: Date.now(), expiresAt: Date.now() + RETAIN_MS,
      docId: job.docId || '', url: job.url || '',
      items: enumerate(id, session)
    };
    fs.mkdirSync(dir, { recursive: true });
    writeAtomic(manifestPath(id), JSON.stringify(man, null, 1));
  }
  return advance(man);
}
function advance(man) {
  for (const it of man.items) {
    if (it.moved || it.missing) continue;
    try {
      if (it.kind === 'file') {
        if (!fs.existsSync(it.from)) {
          // rename 成功但 manifest 未落盘就中断：回收路径已有它，纠正记录而不是当成丢失
          if (fs.existsSync(trashTarget(man, it))) { it.moved = true; it.error = ''; }
          else { it.missing = true; }
        } else {
          const to = trashTarget(man, it);
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.renameSync(it.from, to);
          it.moved = true; it.error = '';
        }
      } else if (it.kind === 'titles') {
        const t = readJSON(TITLES, {}) || {};
        if (t[it.key]) { delete t[it.key]; writeAtomic(TITLES, JSON.stringify(t, null, 1)); }
        it.moved = true;
      } else if (it.kind === 'index') {
        const body = fs.readFileSync(INDEX_MD, 'utf8');
        if (body.includes(it.payload)) writeAtomic(INDEX_MD, body.split('\n').filter(l => l !== it.payload).join('\n'));
        it.moved = true;
      } else if (it.kind === 'sessindex') {
        const idx = readJSON(it.from, {}) || {};
        let hit = false;
        for (const k of Object.keys(it.payload)) if (k in idx) { delete idx[k]; hit = true; }
        if (hit) writeAtomic(it.from, JSON.stringify(idx, null, 1));
        it.moved = true;
      }
    } catch (e) { it.error = String(e.message || e).slice(0, 200); }
    writeAtomic(manifestPath(man.id), JSON.stringify(man, null, 1));
  }
  man.state = man.items.every(it => it.moved || it.missing) ? 'deleted' : 'delete-partial';
  writeAtomic(manifestPath(man.id), JSON.stringify(man, null, 1));
  return man;
}
function trashTarget(man, it) {
  return path.join(filesRoot(man.id), path.basename(path.dirname(it.from)) + '__' + path.basename(it.from));
}

// ——— 恢复：逐项对账，原路径被不同内容占用时不覆盖 ———
function restore(id) {
  assertId(id);
  const man = readJSON(manifestPath(id), null);
  if (!man) throw Object.assign(new Error('回收里没有这一场'), { status: 404 });
  if (man.state === 'moving') throw Object.assign(new Error('这一场的删除还没做完，稍后再恢复'), { status: 409 });
  man.state = 'restoring'; writeAtomic(manifestPath(id), JSON.stringify(man, null, 1));
  const warnings = [];
  for (const it of man.items) {
    try {
      if (it.kind === 'file') {
        const to = trashTarget(man, it), here = fs.existsSync(it.from), there = fs.existsSync(to);
        if (!there) { if (!here && !it.missing) warnings.push('找不到回收副本：' + path.basename(it.from)); it.moved = false; continue; }
        if (!here) { fs.mkdirSync(path.dirname(it.from), { recursive: true }); fs.renameSync(to, it.from); it.moved = false; continue; }
        const same = it.sha256 && fileHash(it.from) === it.sha256;
        if (same) { fs.unlinkSync(to); it.moved = false; continue; }
        const alt = it.from + '.restored-' + new Date(man.deletedAt).toISOString().replace(/[:.]/g, '-');
        fs.renameSync(to, alt); it.moved = false;
        warnings.push('原位置已有别的文件，恢复成 ' + path.basename(alt));
      } else if (it.kind === 'titles') {
        const t = readJSON(TITLES, {}) || {};
        if (!t[it.key]) { t[it.key] = it.payload; writeAtomic(TITLES, JSON.stringify(t, null, 1)); }
        it.moved = false;
      } else if (it.kind === 'index') {
        const body = fs.existsSync(INDEX_MD) ? fs.readFileSync(INDEX_MD, 'utf8') : '';
        if (it.payload && !body.includes(it.payload)) {
          // meeting-pipeline.py 维护的是「表头 + 倒序行」，插回去要保持同样的顺序
          const lines = body.split('\n');
          const head = lines.filter(l => !l.startsWith('| ') || l.startsWith('| 日期'));
          const rows = lines.filter(l => l.startsWith('| ') && !l.startsWith('| 日期'));
          rows.push(it.payload); rows.sort().reverse();
          const headEnd = head.findIndex(l => l.startsWith('|---'));
          const top = headEnd >= 0 ? head.slice(0, headEnd + 1) : head.filter(Boolean);
          writeAtomic(INDEX_MD, top.concat(rows).join('\n').replace(/\n*$/, '\n'));
        }
        it.moved = false;
      } else if (it.kind === 'sessindex') {
        const idx = readJSON(it.from, {}) || {};
        let hit = false;
        for (const [k, v] of Object.entries(it.payload)) if (!(k in idx)) { idx[k] = v; hit = true; }
        if (hit) writeAtomic(it.from, JSON.stringify(idx, null, 1));
        it.moved = false;
      }
    } catch (e) { warnings.push(String(e.message || e).slice(0, 200)); }
    writeAtomic(manifestPath(id), JSON.stringify(man, null, 1));
  }
  const left = man.items.some(it => it.moved);
  if (!left) {
    man.state = 'restored';
    const log = path.join(TRASH, '_log'); fs.mkdirSync(log, { recursive: true });
    writeAtomic(path.join(log, sha16(id) + '.json'), JSON.stringify(man, null, 1));
    try { fs.rmSync(path.join(TRASH, sha16(id)), { recursive: true, force: true }); } catch (e) {}
  } else { man.state = 'restore-partial'; writeAtomic(manifestPath(id), JSON.stringify(man, null, 1)); }
  return { ok: !left, warnings, state: man.state };
}

function list() {
  const out = [];
  try {
    for (const d of fs.readdirSync(TRASH)) {
      if (d === '_log') continue;
      const man = readJSON(path.join(TRASH, d, 'manifest.json'), null);
      if (!man) continue;
      out.push({ id: man.id, title: man.title, start: man.start, deletedAt: man.deletedAt, expiresAt: man.expiresAt, state: man.state, daysLeft: Math.max(0, Math.ceil((man.expiresAt - Date.now()) / 86400000)) });
    }
  } catch (e) {}
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
}
const deletedIds = () => list().map(x => x.id);
// 启动时：把中断的删除向前续做，并清掉过了保留期的
function reconcile(log) {
  try {
    if (!fs.existsSync(TRASH)) return;   // 还没删过任何一场，正常情况
    for (const d of fs.readdirSync(TRASH)) {
      if (d === '_log') continue;
      const p = path.join(TRASH, d, 'manifest.json'), man = readJSON(p, null);
      if (!man) continue;
      try {
        // 删除没做完就向前续做；恢复没做完就继续恢复。两种状态严格分开，避免把刚恢复的文件又删一次。
        if (man.state === 'moving' || man.state === 'delete-partial' || man.state === 'partial') { advance(man); if (log) log('trash reconcile delete ' + man.id + ' -> ' + man.state); }
        else if (man.state === 'restoring' || man.state === 'restore-partial') { const out = restore(man.id); if (log) log('trash reconcile restore ' + man.id + ' -> ' + out.state); }
        if (fs.existsSync(path.join(TRASH, d, 'manifest.json')) && Date.now() > man.expiresAt) { fs.rmSync(path.join(TRASH, d), { recursive: true, force: true }); if (log) log('trash swept ' + man.id); }
      } catch (e) { if (log) log('trash reconcile one fail ' + man.id + ' ' + e.message); }
    }
  } catch (e) { if (log) log('trash reconcile fail ' + e.message); }
}
module.exports = { enumerate, remove, restore, list, deletedIds, reconcile, manifestPath, assertId, RETAIN_MS };
