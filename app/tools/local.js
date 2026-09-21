'use strict';
// 本机读类工具：会议、记忆、项目资料、工作台、找人。
// 全部只读本机数据目录和设置项里配好的文件，不联网（people.lookup 找不到人时才会走一次飞书通讯录）。
const fs = require('fs'), path = require('path');
const reg = require('./index');
const larkCli = require('./lark-cli');

const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));

// ===== 关键词：中文按二字切，英文按词切。和 memory-ops.terms 同口径，避免两处检索结果打架 =====
const STOP = new Set('的 了 和 与 在 是 我 你 他 我们 你们 会议 讨论 一下 这个 那个 the a an of and to for is are this that'.split(/\s+/));
function terms(q) {
  const out = new Set();
  for (const w of String(q || '').split(/[^\p{L}\p{N}]+/u)) {
    if (!w || STOP.has(w.toLowerCase())) continue;
    if (/^[\p{Script=Han}]+$/u.test(w)) { for (let i = 0; i + 2 <= w.length; i++) out.add(w.slice(i, i + 2)); if (w.length <= 6) out.add(w); }
    else if (w.length >= 2) out.add(w.toLowerCase());
  }
  return [...out];
}
function score(text, ts) {
  const hay = String(text || '').toLowerCase();
  let hit = 0;
  for (const t of ts) if (hay.includes(t)) hit++;
  return hit;
}

// ===== 会议索引 =====
// 真源有两处：会后整理结果 state/meeting-pipeline/*.job.enhanced.json（有总结和 brief），
// 和还没整理的 pending/sess-*.json(.done)。同一场会两处都有时以整理结果为准。
// 坏掉的单个文件只跳过自己，不让整次搜索失败。
const MAX_FILE = 24 * 1024 * 1024, MAX_MEETINGS = 40;
const CACHE = new Map();

function iso(v) {
  if (typeof v === 'number' && isFinite(v) && v > 0) { const d = new Date(v); return isNaN(d) ? '' : d.toISOString(); }
  if (typeof v === 'string' && v) { const d = new Date(v); return isNaN(d) ? '' : d.toISOString(); }
  return '';
}
function listFiles(dataDir) {
  const out = [];
  const push = (dir, filter, kind) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { return; }
    for (const n of names) {
      if (!filter(n)) continue;
      const f = path.join(dir, n);
      try { const st = fs.statSync(f); if (st.size > MAX_FILE) continue; out.push({ file: f, mtime: st.mtimeMs, kind }); } catch (e) {}
    }
  };
  push(path.join(dataDir, 'state', 'meeting-pipeline'), n => n.endsWith('.job.enhanced.json'), 'enhanced');
  push(path.join(dataDir, 'pending'), n => /^(sess|offline)-.*\.json(\.done)?$/.test(n), 'pending');
  return out.sort((a, b) => b.mtime - a.mtime);
}
function compact(j, row) {
  const id = String(j.id || '');
  if (!id) return null;
  const brief = (j.brief && typeof j.brief === 'object') ? j.brief : null;
  const ov = (brief && brief.overview) || {};
  const segs = (Array.isArray(j.transcript) ? j.transcript : []).map((x, i) => ({
    i, text: String((x && x.text) || ''), at: (x && (x.t != null ? x.t : x.at)) || '', spk: String((x && (x.speaker != null ? x.speaker : x.spk)) || ''),
  })).filter(x => x.text);
  return {
    id, kind: row.kind, file: row.file, mtime: row.mtime,
    title: clip(j.topicTitle || j.title || id, 160),
    date: iso(j.start) || iso(row.mtime),
    summary: clip(j.summary || '', 20000),
    conclusions: (ov.conclusions || []).map(x => clip(x, 400)),
    briefTodos: (ov.todos || []).map(t => ({ what: clip(t && t.what, 300), owner: clip(t && t.owner, 60), due: clip(t && t.due, 40) })),
    topics: (ov.topics || []).map(t => ({ n: t && t.n, title: clip(t && t.title, 160) })),
    todos: (Array.isArray(j.todos) ? j.todos : []).map(t => ({ text: clip((t && (t.text || t.what)) || '', 300), owner: clip(t && t.owner, 60) })).filter(t => t.text),
    highlights: (Array.isArray(j.highlights) ? j.highlights : []).map(h => clip((h && h.text) || '', 300)).filter(Boolean),
    segments: segs,
    hasBrief: !!brief,
  };
}
function loadMeetings(dataDir, { max = MAX_MEETINGS } = {}) {
  const rows = listFiles(dataDir);
  const stamp = rows.slice(0, max * 2).map(r => r.file + ':' + Math.round(r.mtime)).join('|') + '|' + max;
  const hit = CACHE.get(dataDir);
  if (hit && hit.stamp === stamp) return hit.value;
  const byId = new Map();
  let skipped = 0;
  for (const row of rows) {
    if (byId.size >= max) break;   // 只看最近的这些场，别把几百场老会每次都读一遍
    let j;
    try { j = readJSON(row.file); } catch (e) { skipped++; continue; }   // 坏 JSON 只跳自己
    const m = compact(j, row);
    if (!m) { skipped++; continue; }
    const prev = byId.get(m.id);
    // 会后整理结果永远压过 pending 快照——哪怕 pending 文件后写、mtime 更新（会中还在落盘就是这样），
    // 引用旧快照里的原话会把已经改过的结论又抬回来。同一档之间才比 mtime。
    if (prev) {
      const better = (m.kind === 'enhanced' && prev.kind !== 'enhanced') || (m.kind === prev.kind && m.mtime > prev.mtime);
      if (!better) continue;
    }
    byId.set(m.id, m);
  }
  const value = { meetings: [...byId.values()].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, max), skipped, total: rows.length };
  CACHE.set(dataDir, { stamp, value });
  return value;
}

const meetingUrl = id => '/tinghuitai/archive.html?id=' + encodeURIComponent(id);

reg.register({
  name: 'meetings.search', title: '搜本机会议', level: 'read', source: 'local',
  description: '在本机已记录的会议里按关键词搜（逐字稿、要点、待办、结论、总结）。返回会议 id、标题、日期、命中的那段话和它在会里的时间。',
  input: { type: 'object', required: ['query'], properties: {
    query: { type: 'string', minLength: 1, maxLength: 200, description: '关键词，空格分隔多个' },
    limit: { type: 'integer', minimum: 1, maximum: 30, default: 8, description: '最多返回几条命中' },
    meetingId: { type: 'string', maxLength: 80, description: '只搜这一场会（可选）' },
  } },
  run(args, ctx) {
    const dataDir = ctx.dataDir;
    if (!dataDir) return { ok: false, error: '没有数据目录' };
    const ts = terms(args.query);
    if (!ts.length) return { ok: false, error: '关键词里没有可检索的词' };
    const { meetings, skipped } = loadMeetings(dataDir);
    const hits = [];
    for (const m of meetings) {
      if (args.meetingId && m.id !== args.meetingId) continue;
      const add = (kind, text, extra) => {
        const s = score(text, ts);
        if (!s) return;
        hits.push({ score: s, meetingId: m.id, title: m.title, date: m.date, kind, text: clip(text, 400),
          source: 'local:meeting', url: meetingUrl(m.id), ...extra });
      };
      for (const c of m.conclusions) add('conclusion', c, { ref: 'meeting:' + m.id + '#结论', at: m.date });
      for (const t of m.briefTodos) add('todo', t.what + (t.owner ? '（' + t.owner + '）' : ''), { ref: 'meeting:' + m.id + '#待办', at: m.date });
      for (const t of m.todos) add('todo', t.text + (t.owner ? '（' + t.owner + '）' : ''), { ref: 'meeting:' + m.id + '#待办', at: m.date });
      for (const h of m.highlights) add('highlight', h, { ref: 'meeting:' + m.id + '#要点', at: m.date });
      if (m.summary) {
        for (const para of m.summary.split(/\n{2,}/)) add('summary', para, { ref: 'meeting:' + m.id + '#总结', at: m.date });
      }
      for (const s of m.segments) add('transcript', s.text, { ref: 'meeting:' + m.id + '#' + s.i, at: s.at, seg: s.i });
    }
    hits.sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)));
    const items = hits.slice(0, args.limit).map(({ score: _s, ...x }) => x);
    return { ok: true, items, scanned: meetings.length, ...(skipped ? { unreadableFiles: skipped } : {}) };
  },
});

reg.register({
  name: 'meetings.get', title: '取一场会的内容', level: 'read', source: 'local',
  description: '按会议 id 取这一场的总结 / 结论 / 议题 / 待办。逐字稿不整份给，要 section=transcript 并给段号范围 from、to。',
  input: { type: 'object', required: ['meetingId'], properties: {
    meetingId: { type: 'string', minLength: 1, maxLength: 80 },
    section: { type: 'string', enum: ['overview', 'summary', 'conclusions', 'topics', 'todos', 'transcript'], default: 'overview' },
    from: { type: 'integer', minimum: 0, default: 0, description: 'section=transcript 时的起始段号' },
    to: { type: 'integer', minimum: 0, description: 'section=transcript 时的结束段号（不含），一次最多 120 段' },
  } },
  run(args, ctx) {
    const { meetings } = loadMeetings(ctx.dataDir);
    const m = meetings.find(x => x.id === args.meetingId);
    if (!m) return { ok: false, error: '本机没有这场会：' + clip(args.meetingId, 60) };
    const head = { meetingId: m.id, title: m.title, date: m.date, ref: 'meeting:' + m.id, source: 'local:meeting', url: meetingUrl(m.id), at: m.date };
    if (args.section === 'transcript') {
      const from = Math.max(0, args.from || 0);
      const to = Math.min(m.segments.length, args.to != null ? args.to : from + 120, from + 120);
      return { ok: true, data: { ...head, segmentCount: m.segments.length, from, to,
        segments: m.segments.slice(from, to).map(s => ({ i: s.i, at: s.at, speaker: s.spk, text: s.text, ref: 'meeting:' + m.id + '#' + s.i })) } };
    }
    if (args.section === 'summary') return { ok: true, data: { ...head, summary: m.summary || '（这场还没有总结）' } };
    if (args.section === 'conclusions') return { ok: true, data: { ...head, conclusions: m.conclusions } };
    if (args.section === 'topics') return { ok: true, data: { ...head, topics: m.topics } };
    if (args.section === 'todos') return { ok: true, data: { ...head, todos: m.briefTodos.length ? m.briefTodos : m.todos } };
    return { ok: true, data: { ...head, segmentCount: m.segments.length, conclusions: m.conclusions, topics: m.topics,
      todos: m.briefTodos.length ? m.briefTodos : m.todos, summary: clip(m.summary, 2000) } };
  },
});

reg.register({
  name: 'memory.search', title: '搜会议记忆', level: 'read', source: 'local',
  description: '搜本机会议记忆库里的决定、承诺、未决问题、术语。这里存的是跨会沉淀下来的结论，不是某一场的原话。',
  input: { type: 'object', required: ['query'], properties: {
    query: { type: 'string', minLength: 1, maxLength: 200 },
    limit: { type: 'integer', minimum: 1, maximum: 30, default: 8 },
  } },
  run(args, ctx) {
    const memoryOps = require('../memory-ops');
    let rows = [];
    try { rows = memoryOps.retrieve(ctx.dataDir, args.query, { limit: args.limit }); }
    catch (e) { return { ok: false, error: '记忆库读不了：' + clip(e.message, 120) }; }
    const KIND = { decision: '决定', question: '未决', promise: '承诺', term: '术语', rule: '会中规矩' };
    return { ok: true, items: rows.map(r => ({
      kind: KIND[r.kind] || r.kind, state: r.state, text: clip(r.text, 400),
      owner: r.owner || '', due: r.due || '', meeting: r.meeting_title || '',
      needsReview: !!r.needs_review,
      ref: 'memory:' + r.id, source: 'local:memory', at: r.recorded_at,
      ...(r.meeting_id ? { meetingId: r.meeting_id, url: meetingUrl(r.meeting_id) } : {}),
    })) };
  },
});

// ===== 项目资料：设置项里配好的本机文件 =====
// 有哪些文件由 app/context-pack.js 说了算（资料设置项只许它一个文件认，通配规则也只有那一份）。
const contextPack = require('../context-pack');
const contextFiles = env => contextPack.sourceFiles(env || {});

reg.register({
  name: 'project.context', title: '搜本机项目资料', level: 'read', source: 'local',
  description: '在设置里配好的本机项目文件（需求总纲、决策板、项目状态等）里按关键词取相关段落，带文件路径和最后修改时间。',
  input: { type: 'object', required: ['query'], properties: {
    query: { type: 'string', minLength: 1, maxLength: 200 },
    limit: { type: 'integer', minimum: 1, maximum: 20, default: 6 },
  } },
  available(env) {
    return contextFiles(env || {}).length ? { ok: true }
      : { ok: false, reason: '未接：设置里还没配本机项目资料（项目背景目录 PROJECT_CONTEXT_DIR / 项目重点文件 / 事实源文件）' };
  },
  run(args, ctx) {
    const ts = terms(args.query);
    if (!ts.length) return { ok: false, error: '关键词里没有可检索的词' };
    const hits = [];
    let unreadable = 0;
    for (const f of contextFiles(ctx.env || {})) {
      let text = '', mtime = 0;
      try { const st = fs.statSync(f); if (!st.isFile() || st.size > 4e6) continue; mtime = st.mtimeMs; text = fs.readFileSync(f, 'utf8'); }
      catch (e) { unreadable++; continue; }
      const stamp = new Date(mtime).toISOString();
      let heading = '';
      for (const para of text.split(/\n{2,}/)) {
        const h = para.match(/^#{1,6}\s+(.+)$/m);
        if (h) heading = clip(h[1], 80);
        const s = score(para, ts);
        if (!s) continue;
        hits.push({ score: s, text: clip(para.trim(), 700), path: f, heading,
          ref: 'file:' + f + '@' + stamp, source: 'local:file', at: stamp });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return { ok: true, items: hits.slice(0, args.limit).map(({ score: _s, ...x }) => x), ...(unreadable ? { unreadableFiles: unreadable } : {}) };
  },
});

// ===== 工作台 =====
// 生产上 /hub/* 转给常驻服务（HUB_UPSTREAM），本机这份 work-hub.json 不是真源；配了就读上游。
function hubUpstream(env) {
  const up = String(process.env.THT_HUB_UPSTREAM || env.HUB_UPSTREAM || '').trim();
  const tok = String(process.env.THT_HUB_UPSTREAM_TOKEN || env.HUB_UPSTREAM_TOKEN || '').trim();
  return up ? { url: up.replace(/\/$/, ''), token: tok } : null;
}
function hubLocalFile(dataDir) { return path.join(process.env.THT_HUB_DIR || path.join(dataDir, 'state', 'work-hub'), 'work-hub.json'); }

reg.register({
  name: 'hub.search', title: '搜工作台', level: 'read', source: 'local',
  description: '搜工作台里的待办、资料和项目。待办是全量池（含还没认领的候选），资料是收进来的文档链接。',
  input: { type: 'object', required: ['query'], properties: {
    query: { type: 'string', minLength: 1, maxLength: 200 },
    kind: { type: 'string', enum: ['all', 'tasks', 'sources', 'projects'], default: 'all' },
    limit: { type: 'integer', minimum: 1, maximum: 30, default: 8 },
  } },
  available(env, ctx) {
    if (hubUpstream(env || {})) return { ok: true };
    const f = hubLocalFile((ctx && ctx.dataDir) || '.');
    try { fs.accessSync(f, fs.constants.R_OK); return { ok: true }; }
    catch (e) { return { ok: false, reason: '未接：本机还没有工作台数据（' + f + ' 不存在），也没配 HUB_UPSTREAM' }; }
  },
  async run(args, ctx) {
    const env = ctx.env || {};
    const up = hubUpstream(env);
    let data = null, where = 'local:hub';
    if (up) {
      const f = ctx.fetchImpl || globalThis.fetch;
      if (typeof f !== 'function') return { ok: false, error: '这个 Node 没有 fetch，读不了上游工作台' };
      try {
        const r = await f(up.url + '/hub' + (up.token ? '?token=' + encodeURIComponent(up.token) : ''), { signal: AbortSignal.timeout(10000) });
        data = await r.json();
        where = 'hub:upstream';
      } catch (e) { return { ok: false, error: '上游工作台连不上：' + clip(e.message, 120) }; }
    } else {
      try { data = readJSON(hubLocalFile(ctx.dataDir)); } catch (e) { return { ok: false, error: '工作台数据读不了：' + clip(e.message, 120) }; }
    }
    const ts = terms(args.query);
    if (!ts.length) return { ok: false, error: '关键词里没有可检索的词' };
    const hits = [];
    const want = args.kind || 'all';
    if (want === 'all' || want === 'tasks') for (const t of (data.tasks || [])) {
      const s = score([t.text, t.owner, t.notes].join(' '), ts); if (!s) continue;
      hits.push({ score: s, kind: 'task', text: clip(t.text, 400), owner: t.owner || '', status: t.status || '', bucket: t.bucket || '',
        due: t.due || '', ref: 'hub:task:' + t.id, source: where, at: t.updated || t.created || '' });
    }
    if (want === 'all' || want === 'sources') for (const s0 of (data.sources || [])) {
      const s = score([s0.title, s0.category, s0.notes, s0.preview].join(' '), ts); if (!s) continue;
      hits.push({ score: s, kind: 'source', text: clip(s0.title, 300), channel: s0.channel || '', url: s0.url || '',
        ref: 'hub:source:' + s0.id, source: where, at: s0.updated || s0.date || '' });
    }
    if (want === 'all' || want === 'projects') for (const p of (data.projects || [])) {
      const s = score([p.title, p.notes].join(' '), ts); if (!s) continue;
      hits.push({ score: s, kind: 'project', text: clip(p.title, 300), status: p.status || '', ref: 'hub:project:' + p.id, source: where, at: p.updated || p.created || '' });
    }
    hits.sort((a, b) => b.score - a.score);
    return { ok: true, items: hits.slice(0, args.limit).map(({ score: _s, ...x }) => x) };
  },
});

// ===== 找人 =====
// 先看本机团队名单（他自己维护的那份，带分组和约会顺序），再问飞书通讯录要 open_id。
// 「重名不猜」那条规则只有一份实现，在 app/tools/lark-cli.js 里；actions.js 的 resolveIds 现在也走这里。
function rosterLines(env, names) {
  const f = contextPack.rosterFile(env || {});
  if (!f) return [];
  let text = '';
  try { text = fs.readFileSync(f, 'utf8').slice(0, 200000); } catch (e) { return []; }
  const stamp = (() => { try { return new Date(fs.statSync(f).mtimeMs).toISOString(); } catch (e) { return ''; } })();
  const out = [];
  for (const n of names) {
    const low = String(n).toLowerCase();
    for (const line of text.split('\n')) {
      if (!line.trim() || !line.toLowerCase().includes(low)) continue;
      out.push({ query: n, text: clip(line.trim(), 300), from: 'roster', ref: 'file:' + f + '@' + stamp, source: 'local:file', at: stamp });
      break;
    }
  }
  return out;
}

reg.register({
  name: 'people.lookup', title: '找人', level: 'read', source: 'local',
  description: '按姓名查人：先查本机团队名单，再查飞书通讯录拿 open_id。重名或查不到一律落进 missing，不猜。',
  input: { type: 'object', required: ['names'], properties: {
    names: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 60 } },
    withIds: { type: 'boolean', default: true, description: '要不要顺带解析飞书 open_id' },
  } },
  async run(args, ctx) {
    const env = ctx.env || {};
    const items = rosterLines(env, args.names);
    let ids = [], missing = args.names.slice(), users = [], larkError = '';
    // 注入了 execImpl（测试里的桩）就按可用算，不要求这台机器真的装了 lark-cli
    if (args.withIds && (ctx.execImpl || larkCli.larkAvailable().ok)) {
      const r = await larkCli.resolveIds(args.names, { execImpl: ctx.execImpl, log: ctx.log });
      if (r.ok) { ids = r.ids; missing = r.missing; users = r.users; }
      else { larkError = r.error; ids = []; missing = args.names.slice(); }
    } else if (args.withIds) {
      larkError = larkCli.larkAvailable().reason;
    }
    for (const u of users) items.push({ query: u.query, name: u.name, openId: u.openId, from: 'lark', ref: 'lark:user:' + u.openId, source: 'lark:contact', at: '' });
    return { ok: true, items, data: { ids, missing, ...(larkError ? { larkError } : {}) } };
  },
});

module.exports = { terms, loadMeetings, contextFiles };
