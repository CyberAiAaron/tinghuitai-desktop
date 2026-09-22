'use strict';
// 主动智能批 3（需求单 F3 / F4 / §5.3）：洞察卡上那一个按钮点下去之后，服务端替本人做的事。
//   open_source（conflict 卡）：按 source / refs 找到资料里那一段，摘 ≤200 字原文 + 文档链接，写回卡片；highlights 追加一条冲突条进会后总结。不改任何文档。
//   set_date  （recheck 卡） ：建一条飞书任务（负责人默认承诺人，截止默认今天 +7），承诺卡写 due / 状态，卡片显示任务链接。
// 出处解析（§5.3 表）：
//   决策板 D1–D8       → kb_backup 最新 决策板D1-D8_*.md 的对应 D 行（复用 app/decision-board.js 的表解析）
//   总纲 / 产品需求总纲 §x → kb_backup 最新 产品需求总纲_*.md 的对应小节
//   《会名》日期        → memory.db 的承诺 / 决定卡 → 会后台那场的页面（archive.html?id=）
//   其它文档名          → ~/.claude-maint/kb-map.json 查 token（只取 token，链接仍由工具层回读）；查不到只写来源名
// 链接一律由工具层回读（tools/ 的 docInspect），代码里不手拼域名；找不到原文就写「资料里没有这个数」，不编。命令行只在 tools/ 里拼，这里不出现。
// 这个文件不碰网络之外的副作用：文件只读，memory.db 只在 set_date 里写承诺卡。
const fs = require('fs'), path = require('path');
const board = require('./decision-board');
const larkCli = require('./tools/lark');   // 找人 / 文档链接 / 建任务：命令行只在工具层拼（tests/tools-architecture），这里只调函数

const SELF_OPEN_ID = 'ou_00c28e8ed0b15769a9a5f5e4ea36f7e8';   // 本人（需求单 §1）
const QUOTE_MAX = 200;
const NOT_FOUND = '资料里没有这个数';
// 命题文档：文件名前缀 → 飞书 token（需求单 §3 表）。
const DOCS = [
  { key: 'board', prefix: '决策板D1-D8', label: '决策板', token: 'A2hQdjgAUoIV1vxecJzlFw57gId', match: /决策板|decision board/i },
  { key: 'prd', prefix: '产品需求总纲', label: '产品需求总纲', token: 'COqzdiAr6oGyX3xZb6alPLxQghg', match: /总纲|PRD/i },
  { key: 'arch', prefix: '技术架构', label: '技术架构', token: 'UifYd8eGCoxyyuxEIZjlzBHNgae', match: /技术架构|架构文档/ },
  { key: 'ur', prefix: '用研', label: '用研', token: 'Rxi9djN7vo9FrwxWXhhlYsmQgAR', match: /用研|用户研究/ },
  { key: 'intel', prefix: '行业与竞品情报', label: '行业与竞品情报', token: 'SRLMdavSXoUyEnxhZyllQe9qgEh', match: /行业|竞品/ },
];
const expand = p => path.resolve(String(p).replace(/^~(?=\/)/, process.env.HOME || '~'));
const clip = (s, n) => { const a = [...String(s || '')]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
const flat = s => String(s || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
const todayISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
const plusDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isoDay = v => { const d = String(v || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return ''; const t = new Date(d + 'T00:00:00Z'); return (!isNaN(t) && t.toISOString().slice(0, 10) === d) ? d : ''; };

// ---------- 找文件 ----------
function kbDir(env = {}) {
  const explicit = String(env.DECISION_BOARD_DIR || '').trim();
  if (explicit) return expand(explicit);
  const ctx = String(env.PROJECT_CONTEXT_DIR || '').trim();
  return ctx ? path.join(expand(ctx), 'kb_backup') : '';
}
// 最新一份：按文件名日期排（和 decision-board.latestFile 同口径），返回 {file,date}
function latestKb(dir, prefix) {
  if (!dir) return null;
  let names; try { names = fs.readdirSync(dir); } catch (e) { return null; }
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_(\\d{4}-\\d{2}-\\d{2})\\.md$');
  const dated = names.map(n => { const m = n.match(re); return m ? { n, d: m[1] } : null; }).filter(Boolean).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
  return dated.length ? { file: path.join(dir, dated[0].n), date: dated[0].d } : null;
}
function readKbMap(p) {
  const file = expand(p || '~/.claude-maint/kb-map.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}
// kb-map.json：branches[].items[] 每条 {title,url,id:'d:<token>'}；按标题子串找，命中一条才认
function kbMapLookup(map, name) {
  const n = flat(name).replace(/[《》「」“”"]/g, '');
  if (!map || !n) return null;
  const items = [];
  for (const b of map.branches || []) for (const it of b.items || []) if (it && it.title) items.push(it);
  const norm = s => flat(s).replace(/[\s·、，。：:（）()①-⑩]/g, '').toLowerCase();
  const key = norm(n);
  if (key.length < 2) return null;
  const hits = items.filter(it => { const t = norm(it.title); return t.includes(key) || key.includes(t.replace(/v\d.*$/, '')) && t.replace(/v\d.*$/, '').length >= 2; });
  const it = hits.length === 1 ? hits[0] : hits.find(x => norm(x.title).startsWith(key)) || null;
  if (!it) return null;
  const token = (String(it.id || '').match(/^d:([A-Za-z0-9]{10,64})$/) || [])[1] || (String(it.url || '').match(/\/(?:docx|wiki|doc)\/([A-Za-z0-9]{10,64})/) || [])[1] || '';
  return token ? { title: flat(it.title), token, url: String(it.url || '') } : null;
}

// ---------- 摘原文 ----------
// markdown 按标题切段：[{level,title,body}]
function sections(md) {
  const out = []; let cur = null;
  for (const line of String(md || '').split('\n')) {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) { cur = { level: m[1].length, title: flat(m[2]), body: [] }; out.push(cur); continue; }
    if (cur) cur.body.push(line);
  }
  return out.map(s => ({ ...s, body: s.body.join('\n') }));
}
// 小节定位：「§3」「§3.2」「第三章」按编号或序号；否则按标题子串；再不然按 needle（claim 里的数字 / 关键词）找含它的段落
function findSection(md, hint, needles) {
  const secs = sections(md);
  const h = flat(hint);
  const num = (h.match(/§\s*([\d.]+)/) || h.match(/(\d+(?:\.\d+)*)\s*[节章]/) || [])[1];
  let hit = null;
  if (num) hit = secs.find(s => new RegExp('^(?:§\\s*)?' + num.replace(/\./g, '\\.') + '(?![\\d.])').test(s.title) || s.title.includes('§' + num));
  if (!hit && h) { const title = h.replace(/^.*?(总纲|产品需求总纲|技术架构|用研|行业与竞品情报)\s*/, '').replace(/^[§\s\d.]+/, '').trim(); if (title.length >= 2) hit = secs.find(s => s.title.includes(title) || (s.title.length >= 2 && title.includes(s.title))); }
  if (!hit && needles && needles.length) hit = secs.find(s => needles.some(n => s.body.includes(n)));
  return hit;
}
// 段落里优先摘含 needle 的那一段（表格行 / 列表项 / 自然段），没有就从头摘
// 表格的表头行和分隔行不算原文（只剩它们时才拿表头顶着）；没有 needle 命中就优先带数字的那一段
function quoteFrom(body, needles, hints) {
  const raw = String(body || '').split(/\n{2,}|\n(?=[-*|#]|\d+\.)/).map(flat).filter(Boolean);
  const isSep = p => /^\|?\s*:?-{2,}/.test(p) || /^\|(?:\s*:?-+:?\s*\|)+$/.test(p);
  const paras = raw.filter((p, i) => !isSep(p) && !(p.startsWith('|') && raw[i + 1] && isSep(raw[i + 1])));
  const hit = (needles && needles.length) ? paras.find(p => needles.some(n => p.includes(n))) : null;
  if (hit) return clip(hit, QUOTE_MAX);
  // 没有 needle：按和 claim / 原话共用的词（2 字片段 / 英文词）打分，挑最像在说同一件事的那一段；再退到带数字的那一段
  if (hints && hints.length) { let best = null, bestN = 0; for (const p of paras) { const low = p.toLowerCase(); let n = 0; for (const h of hints) if (low.includes(h)) n++; if (n > bestN) { best = p; bestN = n; } } if (best) return clip(best, QUOTE_MAX); }
  return clip(paras.find(p => /\d/.test(p)) || paras[0] || raw[0] || '', QUOTE_MAX);
}
// claim 里「记的是 Y」那一半：Y 就是要写回卡片的正确值
function recordedValue(claim) {
  const m = String(claim || '').match(/(?:记的是|记录是|记录为|记为|记着|资料是|资料里是|写的是|文档里是|口径是|定的是|应为|实为)\s*[：:]?\s*([^，。；,;）)]{1,30})/);
  return m ? m[1].trim() : '';
}
const NUM_RE = /\d{4}-\d{2}-\d{2}|\d{1,2}[-/月]\d{1,2}日?|\d+(?:\.\d+)?\s*(?:%|％|万|亿|k|K|台|天|周|周|美元|元|USD|W|mm|寸|GB|MB|ms|秒)?/g;
function numsOf(s) { return [...String(s || '').matchAll(NUM_RE)].map(m => m[0].replace(/\s+/g, '')).filter(x => /\d/.test(x)); }
// 原文里的正确值：优先 claim 说的 Y；其次原文里出现、会上原话里没有的第一个数；都没有就「见原文」
function correctionValue(claim, evidence, quote) {
  const y = recordedValue(claim);
  if (y && (quote.includes(y.replace(/\s+/g, '')) || quote.includes(y))) return y;
  const said = new Set(numsOf(evidence));
  const cand = numsOf(quote).find(n => !said.has(n));
  return cand || y || '见原文';
}

// ---------- 三条解析路 ----------
function parseBoardRef(source, refs) {
  const all = [...(refs || []), String(source || '')].join(' ');
  const m = all.match(/\bD([1-9])\b/);
  return m ? 'D' + m[1] : '';
}
function resolveBoard(source, refs, ctx) {
  const dId = parseBoardRef(source, refs);
  const latest = latestKb(ctx.dir, DOCS[0].prefix);
  if (!latest) return null;
  let raw; try { raw = fs.readFileSync(latest.file, 'utf8'); } catch (e) { return null; }
  const rows = board.extractRows(raw);
  const row = dId ? rows.find(r => r.id === dId) : null;
  let quote = '';
  if (row) quote = clip([`${row.id} ${row.name}`, row.lean, row.due ? `期限 ${row.due}` : '', row.state ? `状态 ${row.state}` : ''].filter(Boolean).join('｜'), QUOTE_MAX);
  else { const sec = findSection(raw, '', ctx.needles); quote = sec ? quoteFrom(sec.body, ctx.needles, ctx.hints) : ''; }
  if (!quote) return null;
  return { kind: 'board', label: '决策板' + (dId ? ' ' + dId : ''), date: latest.date, file: latest.file, quote, token: DOCS[0].token, section: dId };
}
function resolveDocFile(doc, source, ctx) {
  const latest = latestKb(ctx.dir, doc.prefix);
  if (!latest) return null;
  let raw; try { raw = fs.readFileSync(latest.file, 'utf8'); } catch (e) { return null; }
  const sec = findSection(raw, source, ctx.needles);
  if (!sec) return null;
  const quote = quoteFrom(sec.body, ctx.needles, ctx.hints) || clip(sec.title, QUOTE_MAX);
  if (!quote) return null;
  return { kind: doc.key, label: `${doc.label}《${sec.title}》`, date: latest.date, file: latest.file, quote, token: doc.token, section: sec.title };
}
// 《会名》日期 / 09-12 硬件周会 → memory.db 里那场的承诺 / 决定卡
function parseMeetingRef(source) {
  const s = String(source || '');
  const t = s.match(/《([^》]{2,60})》/);
  const d = s.match(/(\d{4}-\d{2}-\d{2})|(\d{1,2})[-/月](\d{1,2})日?/);
  let date = '';
  if (d) date = d[1] || (String(new Date().getFullYear()) + '-' + d[2].padStart(2, '0') + '-' + d[3].padStart(2, '0'));
  let title = t ? t[1] : '';
  if (!title) { const m = s.replace(/\d{4}-\d{2}-\d{2}|\d{1,2}[-/月]\d{1,2}日?/g, ' ').match(/([\p{L}\p{N}·\s]{2,40}?(?:会|例会|周会|评审|同步|sync|review|KO))/iu); if (m) title = m[1].trim(); }
  return (title || date) ? { title, date } : null;
}
function resolveMeeting(source, ctx) {
  const ref = parseMeetingRef(source);
  if (!ref || !ctx.db) return null;
  let rows;
  try {
    rows = ctx.db.prepare(`SELECT * FROM cards WHERE kind IN ('promise','decision') AND (meeting_title LIKE ? OR ? = '') ORDER BY recorded_at DESC LIMIT 200`).all('%' + (ref.title || '') + '%', ref.title || '');
  } catch (e) { return null; }
  if (ref.date) rows = rows.filter(r => String(r.recorded_at || '').slice(0, 10) === ref.date || String(r.recorded_at || '').slice(5, 10) === ref.date.slice(5));
  if (!rows.length) return null;
  const hit = (ctx.needles || []).length ? rows.find(r => ctx.needles.some(n => (r.text + ' ' + r.topic).includes(n))) || rows[0] : rows[0];
  return { kind: 'meeting', label: `《${hit.meeting_title || ref.title || '以往会议'}》`, date: String(hit.recorded_at || '').slice(0, 10), quote: clip(flat(hit.text), QUOTE_MAX), meetingId: hit.meeting_id || '', cardId: hit.id, url: hit.meeting_id ? 'archive.html?id=' + encodeURIComponent(hit.meeting_id) : '', title: hit.meeting_title || ref.title || '' };
}

// needle：claim 里「记的是 Y」的 Y，以及 refs 里的字串；用来在段落里挑那一句
function needlesOf(claim, refs) {
  const out = [];
  const y = recordedValue(claim); if (y) out.push(y, y.replace(/\s+/g, ''));
  for (const r of refs || []) if (r && !/^D\d$/.test(r)) out.push(String(r));
  return [...new Set(out.filter(x => x && x.length >= 1))];
}

// hint：claim + 原话里的词（复用 memory-ops.terms：汉字 2 字片段、英文词），去掉「记的是 / 会上说」这类套话
const HINT_STOP = new Set(['会上', '上说', '记的', '的是', '记录', '录是', '资料', '决策', '策板', '总纲', '已承', '承诺', '诺过', '记录', '没看', '看到', '落地', '这件', '件事']);
function hintsOf(claim, evidence) { try { return require('./memory-ops').terms(String(claim || '') + ' ' + String(evidence || '')).filter(w => !HINT_STOP.has(w) && !/^\d+$/.test(w)); } catch (e) { return []; } }

// resolveSource(source, refs, opts) -> { found:true, kind, label, date, quote, value, doc:{title,url,token}, ... } 或 { found:false, message }
// opts: { env, claim, evidence, db（memory.db 句柄，可空）, kbMap（路径或对象）, execImpl / log（工具层命令注入）, inspect（覆盖 docInspect，测试用）}
async function resolveSource(source, refs, opts = {}) {
  const env = opts.env || {};
  const ctx = { dir: opts.dir || kbDir(env), needles: needlesOf(opts.claim, refs), hints: hintsOf(opts.claim, opts.evidence), db: opts.db || null };
  const src = String(source || '');
  let hit = null;
  const isBoard = DOCS[0].match.test(src) || (refs || []).some(r => /^D[1-9]$/.test(String(r)));
  if (isBoard) hit = resolveBoard(src, refs, ctx);
  if (!hit) for (const doc of DOCS.slice(1)) if (doc.match.test(src)) { hit = resolveDocFile(doc, src, ctx); if (hit) break; }
  if (!hit && parseMeetingRef(src)) hit = resolveMeeting(src, ctx);
  let mapHit = null;
  if (!hit) {
    const map = typeof opts.kbMap === 'object' && opts.kbMap ? opts.kbMap : readKbMap(opts.kbMap);
    mapHit = kbMapLookup(map, src.replace(/§.*$/, ''));
    if (!mapHit) return { found: false, message: NOT_FOUND, label: src };
    // 其它文档：本机没有导出、摘不到原文 → 只附链接，卡片如实写「资料里没有这个数」
    hit = { kind: 'kbmap', label: mapHit.title, date: '', quote: '', token: mapHit.token };
  }
  let doc = null;
  if (hit.token) {
    const ins = await (opts.inspect || larkCli.docInspect)(hit.token, { execImpl: opts.execImpl, log: opts.log });
    // 链接只认工具层当场回读的（Codex 1edd4fc4 初审：kb-map 里存的旧链接不走回读，可能过期 / 无权限，不拿来顶）
    if (ins && ins.ok) doc = { title: ins.title || hit.label, url: ins.url, token: hit.token };
    else doc = { title: hit.label, url: '', token: hit.token, linkError: (ins && ins.error) || '工具层没回链接' };
  } else if (hit.kind === 'meeting') doc = { title: hit.title, url: hit.url, meetingId: hit.meetingId };
  const found = !!hit.quote;
  return {
    found, kind: hit.kind, label: hit.label, date: hit.date || '', quote: hit.quote || '',
    value: found ? correctionValue(opts.claim, opts.evidence, hit.quote) : '',
    message: found ? '' : NOT_FOUND, doc, file: hit.file || '', section: hit.section || '', cardId: hit.cardId || '',
  };
}

// ---------- 两个动作 ----------
// open_source：写回卡片 correction / quote / doc；找到了才往 highlights 加冲突条（找不到不编）
async function openSource({ card, env, db, dataDir, log = () => {}, execImpl, inspect, kbMap }) {
  const r = await resolveSource(card.source, card.refs, { env, claim: card.claim, evidence: card.evidence, db, execImpl, log, inspect, kbMap });
  const patch = {
    correction: r.found ? `记录：${r.value}（${r.label}${r.date ? '，' + r.date : ''}）` : NOT_FOUND,
    quote: r.quote || '', doc: r.doc || null, found: r.found,
  };
  const highlight = r.found ? `⚠️ 冲突：会上 ${clip(card.evidence || card.claim, 40)}，记录 ${r.value}（${r.label}${r.date ? ' ' + r.date : ''}）` : '';
  return { ok: true, patch, highlight, resolved: r };
}

// set_date：建飞书任务 + 承诺卡写 due / 状态。args {owner, due, title}
async function setDate({ card, args = {}, session = {}, env, db, log = () => {}, execImpl }) {
  const today = todayISO();
  const due = isoDay(args.due) || plusDays(today, 7);
  const owner = String(args.owner || (card.action && card.action.args && (card.action.args.owner || card.action.args.who)) || '').trim().slice(0, 60);
  let assignee = SELF_OPEN_ID, note = '';
  if (owner && owner !== '本人' && !/^aaron(\s*wang)?$/i.test(owner)) {
    const got = await larkCli.resolveIds([owner], { execImpl, log });
    const id = got.ok ? (got.ids || [])[0] : '';
    if (id) assignee = id; else note = `代办对象：${owner}`;
  }
  const title = clip(String(args.title || '').trim() || card.claim, 100);
  const desc = [card.claim, card.evidence ? `会上原话：「${card.evidence}」` : '', card.source ? `出处：${card.source}` : '', session.title ? `来自会议：${session.title}` : '', note].filter(Boolean).join('\n');
  const cliTimeout = Math.max(500, Number((env || {}).INSIGHT_ACTION_CLI_TIMEOUT_MS) || 30000);
  const r = await larkCli.taskCreate({ summary: title, description: desc, assignee, due }, { execImpl, log, timeout: cliTimeout });
  if (!r.ok) { const e = Error(r.error || '建任务没成'); e.uncertain = !!r.uncertain; e.definite = !r.uncertain; throw e; }
  const task = { url: r.url, id: r.id, owner: owner || '本人', assignee, due, note };
  // 承诺卡：找同一件事的 pending 承诺写 due / owner；没有就新建一张，别让这次「定日期」只留在飞书
  let memoryCard = null;
  if (db) {
    try {
      const mem = require('./memory'), ops = require('./memory-ops');
      // 同一件事：拿承诺卡自己的词去卡片 claim + 原话里找，命中 ≥2 个且占它自己词数 ≥30%（claim 里还带着「已承诺过 / 记录里没看到」这类话，反过来比就永远对不上）
      const hay = (card.claim + ' ' + (card.evidence || '')).toLowerCase();
      const rows = db.prepare(`SELECT * FROM cards WHERE kind='promise' AND state='pending' ORDER BY recorded_at DESC LIMIT 500`).all();
      let best = null, bestScore = 0;
      for (const row of rows) { const q = ops.terms(row.topic + ' ' + row.text); if (!q.length) continue; let hit = 0; for (const w of q) if (hay.includes(w)) hit++; const score = hit >= 2 && hit / q.length >= 0.3 ? hit / q.length : 0; if (score > bestScore) { best = row; bestScore = score; } }
      const refs = task.url ? [task.url] : [];
      if (best) memoryCard = mem.updateCard(db, best.id, { due, owner: owner || best.owner, source_refs: [...safeJson(best.source_refs), ...refs], human_edited: 1 }, `会中定日期（${session.title || session.id || '本场'}）`);
      else memoryCard = mem.putCard(db, { kind: 'promise', state: 'pending', text: card.claim, topic: clip(card.claim, 40), owner: owner || '', due, meeting_id: session.id || '', meeting_title: session.title || '', source_refs: refs, human_edited: 1, change_reason: '会中定日期' });
    } catch (e) { log('insight-action set_date 承诺卡没写进去 ' + e.message); }
  }
  return { ok: true, patch: { task }, url: task.url, refId: task.id, memoryCardId: memoryCard ? memoryCard.id : '' };
}
function safeJson(s) { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }

module.exports = { resolveSource, openSource, setDate, kbDir, latestKb, kbMapLookup, findSection, quoteFrom, recordedValue, correctionValue, parseMeetingRef, parseBoardRef, sections, NOT_FOUND, SELF_OPEN_ID, QUOTE_MAX, DOCS };
