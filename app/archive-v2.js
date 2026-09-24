'use strict';
// 会后页 v2（Aaron 2026-09-24 14:35 拍板）：会后 10 秒内知道这场会改变了什么、要我拍什么、该问谁。
// 服务端从 enhanced.json 挑出四块（改变 / 洞察→行动 / 下一步 / 可分享纪要），前端只渲染。
// ⌘E 改过的文字落在 enhanced.overrides（键 = 视图路径，如 "changes.0"、"insights.2.answer"），渲染时 override 优先。
const fs = require('fs'), path = require('path');
const owners = require('./owners');
const sendGate = require('./send-gate');
const personHandoff = require('./person-handoff');

const oneLine = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const clip = (s, n) => { s = oneLine(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
// 立场 = 回答的第一句（中文句号 / 分号 / 换行前）
const firstSentence = s => { const t = oneLine(s); const m = /^(.+?[。！？；.!?])(\s|$)/.exec(t); return m ? m[1] : t; };
const okId = v => /^[A-Za-z0-9_-]{1,80}$/.test(String(v || ''));
const PATH_RE = /^(changes\.\d{1,2}|insights_md|insights\.\d{1,3}\.(question|stance|answer|action|owner)|next\.(text|owner)|summary\.\d{1,2}|minutes\.topic)$/;
// 第 2 块「军师怎么看」：正文 = enhanced.json 的 insights_md（模型自由写的 markdown，没有模板）。
// 右侧行动卡只对正文里 `@<人名>：` 开头的行生成——这是会中会后唯一保留的那个约定。
const ASSIGN_RE = /^\s*(?:[-*+]\s*)?(?:\*\*)?@\s*([^：:*\n]{1,20}?)(?:\*\*)?\s*[：:]\s*(.+)$/;
const KNOWN = () => new Set(Object.values(owners.table()).map(String));
// insights_md 缺失（老场次 / 模型没给）时，用旧 insights 数组拼一段 markdown 兜底：每条一段。
function fallbackMd(list) {
  return (list || []).filter(i => i && (i.question || i.answer)).map(i => {
    const q = oneLine(i.question), a = String(i.answer || '').trim();
    const act = (i.action && typeof i.action === 'object') ? oneLine(i.action.text || i.action.label) : oneLine(i.action);
    const who = act ? (owners.classify([q, act, a].join(' ')).owner) : '';
    return [q ? '**' + q + '**' : '', a, act ? '@' + who + '：' + act : ''].filter(Boolean).join('\n\n');
  }).join('\n\n').trim();
}
// markdown 正文 → 行动卡：一行一条，人名先按正文里写的那个（认识才认），认不出用 owners.classify
function actionsFromMd(md) {
  const known = KNOWN(), out = [];
  for (const line of String(md || '').split('\n')) {
    const m = ASSIGN_RE.exec(line); if (!m) continue;
    const raw = oneLine(m[1]), text = clip(m[2], 200); if (!text) continue;
    const cls = owners.classify(raw + ' ' + text);
    const owner = known.has(raw) ? raw : cls.owner;
    out.push({ n: out.length + 1, action: text, owner, topic: cls.topic, named: raw, sourceId: 'v2-ins-' + (out.length + 1) });
    if (out.length >= 8) break;
  }
  return out;
}

// 传统纪要：从 summary Markdown 取一句话主题 + 二级标题 + 每节的「结论」段
function parseSummary(md) {
  const lines = String(md || '').split('\n');
  let topic = '', cur = null; const sections = [];
  let grab = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { continue; }
    if (/^#\s/.test(l)) continue;
    if (/^##\s/.test(l)) { cur = { title: oneLine(l.replace(/^##\s*/, '').replace(/^[一二三四五六七八九十]+、\s*/, '')), conclusion: '' }; sections.push(cur); grab = false; continue; }
    if (!cur && !topic && !/^[#*\-|>]/.test(l)) { topic = oneLine(l); continue; }
    if (!cur) continue;
    if (/^\*\*[^*]*(结论|分歧|断点|未定|缺口)[^*]*\*\*$/.test(l)) { grab = true; continue; }
    if (/^\*\*[^*]+\*\*$/.test(l)) { grab = false; continue; }
    if (grab && !cur.conclusion) cur.conclusion = oneLine(l.replace(/^[-*]\s*/, ''));
  }
  return { topic, sections };
}

const isHardConflict = s => !/非硬冲突|不构成硬冲突|不是硬冲突/.test(String(s || ''));
const isUnstable = i => i.unstable === true || (typeof i.stability === 'number' && i.stability < 0.5);

function buildView(r) {
  const b = (r && r.brief) || {};
  const ib = b.insightsBrief || {};
  const meta = b.insightsMeta || {};
  const ov = b.overview || {};
  const decisions = (ib.decisionsForAaron || []).map(oneLine).filter(Boolean);
  const conflicts = (meta.conflictsWithBoard || []).map(oneLine).filter(isHardConflict);
  const conclusions = (ov.conclusions || []).map(oneLine).filter(Boolean);
  const todos = (ov.todos || []).map(t => ({ text: oneLine(t.what || t.text), owner: oneLine(t.owner) })).filter(t => t.text)
    .concat((r.todos || []).map(t => ({ text: oneLine(t.text), owner: oneLine(t.owner) })).filter(t => t.text));

  // 1. 这场会改变了什么：≤3 行，问题（要拍的 / 硬冲突）→ 进展（结论）→ 下一步（待办）
  const changes = [];
  const push = (kind, text) => { if (text && changes.length < 3 && !changes.some(c => c.text === clip(text, 40))) changes.push({ kind, text: clip(text, 40) }); };
  push('问题', decisions[0] || conflicts[0]);
  push('进展', conclusions[0]);
  push('下一步', todos[0] && todos[0].text);
  push('问题', decisions[1] || conflicts[1]);
  push('进展', conclusions[1]);

  // 2. 军师怎么看：正文是自由 markdown（insights_md），行动卡只从 `@人名：` 行来
  const insightsMd = String((r && r.insightsMd) || b.insightsMd || b.insights_md || (r && r.insights_md) || '').trim() || fallbackMd(b.insights);
  const insights = actionsFromMd(insightsMd);

  // 3. 下一步最重要的一件事：最重要的 decision，没有就 todos[0]
  const nextText = decisions[0] || (todos[0] && todos[0].text) || '';
  const next = nextText ? { text: nextText, owner: owners.classify(nextText).owner, topic: owners.classify(nextText).topic, sourceId: 'v2-next' } : null;

  // 4. 可分享纪要
  const ps = parseSummary(r.summary);
  const att = ((r.calendar || {}).attendees || []).filter(a => a && a.name && !a.declined).map(a => a.name);
  const participants = att.length ? att : (Array.isArray(r.participants) ? r.participants.filter(Boolean) : []);
  const minConcl = (conclusions.length ? conclusions : ps.sections.map(s => s.conclusion).filter(Boolean)).slice(0, 5);
  const minutes = { topic: ps.topic || oneLine(ib.purpose || ''), sections: ps.sections.filter(x => x.conclusion).slice(0, 8), conclusions: minConcl, todos: todos.slice(0, 8), participants };
  return { changes, insightsMd, insights, next, minutes };
}

// 把 overrides 按路径盖到视图上。insights 用 n 找（位置会随排序变），别的按下标。
function applyOverrides(view, overrides) {
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  for (const [p, text] of Object.entries(o)) {
    if (!PATH_RE.test(p) || typeof text !== 'string') continue;
    const seg = p.split('.');
    if (p === 'insights_md') { view.insightsMd = text; view.insights = actionsFromMd(text); view.insightsEdited = true; }
    else if (seg[0] === 'changes') { const c = view.changes[Number(seg[1])]; if (c) { c.text = text; c.edited = true; } }
    else if (seg[0] === 'insights') { const i = view.insights.find(x => String(x.n) === seg[1]); if (i) { i[seg[2]] = text; i.edited = { ...(i.edited || {}), [seg[2]]: true }; } }
    else if (seg[0] === 'next') { if (view.next) { view.next[seg[1]] = text; view.next.edited = { ...(view.next.edited || {}), [seg[1]]: true }; } }
    else if (seg[0] === 'summary') { const k = Number(seg[1]); if (k < view.minutes.conclusions.length) view.minutes.conclusions[k] = text; }
    else if (p === 'minutes.topic') view.minutes.topic = text;
  }
  return view;
}

// 「发」过没有：先读 person-handoff 的已发索引（一人一批，按 sourceId 记），没有再退到旧的单条收据（key = ['person-handoff', 会议, sourceId]）
function sentState(dataDir, meetingId, sourceId) {
  if (!dataDir) return null;
  try { const s = personHandoff.sentState(dataDir, meetingId, sourceId); if (s) return s; } catch (e) {}
  try {
    const k = sendGate.hash(['person-handoff', meetingId, sourceId]);
    const j = JSON.parse(fs.readFileSync(path.join(dataDir, 'state', 'send-receipts', 'person-handoff', k + '.json'), 'utf8'));
    if (j && j.status === 'sent') return { at: j.at || 0, partial: !!j.partial, person: (j.assignee && j.assignee.name) || '', taskUrl: (j.task && j.task.url) || '' };
  } catch (e) {}
  return null;
}

// meeting-result 返回前经这里：加 view（含 override），原字段一个不动
function decorate(result, { dataDir } = {}) {
  if (!result || typeof result !== 'object') return result;
  let view;
  try { view = applyOverrides(buildView(result), result.overrides); } catch (e) { return result; }
  const mid = String(result.id || '');
  // sourceId 按条目序号记；洞察重跑后序号会换人，收据上的收件人和这张卡的负责人对不上就当没发
  const own = (x) => { const s = sentState(dataDir, mid, x.sourceId); return s && s.person && x.owner && s.person !== x.owner ? null : s; };
  for (const i of view.insights) i.sent = own(i);
  if (view.next) view.next.sent = own(view.next);
  return { ...result, view };
}

// PATCH /asr-relay/archive-edit {id, path, text}：写 enhanced.overrides[path]（text 为空 = 撤掉这条 override）
async function editRoute(req, res, { authed, pipeline, dataDir, log = () => {} }) {
  const reply = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(j)); };
  if (!authed) { res.writeHead(401); return res.end('unauthorized'); }
  if (req.method !== 'PATCH') { res.writeHead(405); return res.end('method not allowed'); }
  let raw = '';
  try { for await (const c of req) { raw += c; if (Buffer.byteLength(raw) > 65536) throw Error('内容过长'); } } catch (e) { return reply(400, { ok: false, error: e.message }); }
  let j; try { j = JSON.parse(raw || '{}'); } catch (e) { return reply(400, { ok: false, error: '格式不对' }); }
  const id = String(j.id || '').trim(), p = String(j.path || '').trim();
  if (!okId(id)) return reply(400, { ok: false, error: '会议编号不对' });
  if (!PATH_RE.test(p)) return reply(400, { ok: false, error: '不认识这个位置：' + p.slice(0, 40) });
  if (typeof j.text !== 'string') return reply(400, { ok: false, error: '缺 text' });
  // insights_md 是军师自由 markdown 正文，跟 .answer 一样只 trim 不 oneLine——oneLine 会把换行压成空格，编辑保存后格式就没了（Codex 审计 2026-09-24）
  const text = ((p.endsWith('.answer') || p === 'insights_md') ? j.text.trim() : oneLine(j.text)).slice(0, 2000);
  try {
    const session = pipeline.patchResult(id, { overrides: { [p]: text || null } });
    log('archive-edit ' + id + ' ' + p + ' ' + (text ? text.length + ' 字' : '撤回'));
    return reply(200, { ok: true, path: p, text, view: decorate(session, { dataDir }).view });
  } catch (e) { return reply(e.code === 404 ? 404 : 500, { ok: false, error: String(e.message || e).slice(0, 200) }); }
}

module.exports = { buildView, applyOverrides, parseSummary, decorate, editRoute, sentState, PATH_RE };
