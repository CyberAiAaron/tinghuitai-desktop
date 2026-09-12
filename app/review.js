'use strict';
// 会后过一遍：收敛之后的十几条，一条一条给人判「留下 / 改一下 / 不要」。
// 判断结果有两个去处——
//   1) 留下的进记忆卡（human_edited=1，模型以后不会静默改它），Claude 那边的只读投影随之更新；
//   2) 全部过完后生成一份给人看的纪要，你直接转发。
// 原始条目和收敛结果都不动，review 只记决定。

const mem = require('./memory');
const ops = require('./memory-ops');

const ACTIONS = new Set(['keep', 'edit', 'drop']);
const KINDS = new Set(['highlights', 'todos', 'factchecks']);
const clean = (s, n = 400) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

// 一条决定：哪一栏的第几条、怎么处置、（改过的话）改成什么
function normalizeDecision(d) {
  if (!d || !KINDS.has(d.kind) || !ACTIONS.has(d.action)) return null;
  const i = Number(d.index);
  if (!Number.isInteger(i) || i < 0 || i > 999) return null;
  return {
    kind: d.kind, index: i, action: d.action,
    text: clean(d.text), note: clean(d.note, 300),
    owner: clean(d.owner, 80), due: clean(d.due, 80),
    at: Date.now(),
  };
}

// 把「留下」和「改过」的条目写成记忆卡。人工判断过的，标 human_edited=1。
// 待核查不进记忆——它是待办性质的疑问，不是已确认的知识。
function toCards(session, decisions, condensed) {
  const cards = [];
  const at = session.end || new Date().toISOString();
  for (const d of decisions) {
    if (d.action === 'drop') continue;
    const src = (condensed[d.kind] || [])[d.index];
    if (!src) continue;
    const text = d.text || src.text || src.claim || '';
    if (!text) continue;
    if (d.kind === 'highlights') {
      cards.push({ kind: 'decision', topic: '', text, human_edited: 1, needs_review: 0 });
    } else if (d.kind === 'todos') {
      cards.push({ kind: 'promise', topic: '', text, owner: d.owner || src.owner || '', due: d.due || src.due || '', human_edited: 1, needs_review: 0 });
    }
  }
  return cards.map(c => ({
    ...c,
    project: session.project || '',
    meeting_id: session.id || '',
    meeting_title: session.title || '',
    source_refs: [],
    recorded_at: at,
  }));
}

// 给人看的那一份：能直接转发的纪要，不带内部字段、不带编号。
const ts = v => typeof v === 'number' ? v : (Date.parse(v) || 0);
function shareNote(session, decisions, condensed) {
  const pick = kind => (condensed[kind] || []).map((x, i) => {
    const d = decisions.find(y => y.kind === kind && y.index === i);
    if (d && d.action === 'drop') return null;
    return {
      text: (d && d.text) || x.text || x.claim || '',
      owner: (d && d.owner) || x.owner || '',
      due: (d && d.due) || x.due || '',
      note: (d && d.note) || x.note || '',
      verdict: x.verdict || '',
    };
  }).filter(x => x && x.text);
  const hl = pick('highlights'), td = pick('todos'), ck = pick('factchecks');
  const VERDICT = { true: '大概率对', false: '可能有误', unsure: '拿不准' };
  const when = session.start ? new Date(session.start).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  const L = [];
  if (!session.__noHead) {
    L.push('# ' + (session.topicTitle || session.title || '会议纪要'));
    if (when) L.push('', when);
  }
  // 四段，顺序固定：总结 → 核心要点 → 核心纠错 → 核心待办。
  // 会议过程中的那几百条明细一律不进这份——那是翻不动的，也不是给人读的。
  // 总结就是一小段：这是一场什么会、从多少条里收敛出下面这些。
  // 完整的「智能总结」有五六千字、几十条带引用编号的条目，跟下面的核心要点重复，
  // 整段放进来就又变回翻不动的流水账了——它在会议页上随时能看。
  {
    const mins = (session.start && session.end) ? Math.round((ts(session.end) - ts(session.start)) / 60000) : 0;
    const spk = new Set((session.transcript || []).map(r => String(r.speaker ?? '')).filter(x => x !== '')).size;
    const src = (condensed && condensed.source) || {};
    const bits = [];
    if (mins) bits.push('这一场 ' + (mins >= 60 ? Math.floor(mins / 60) + ' 小时 ' + (mins % 60) + ' 分' : mins + ' 分钟'));
    if (spk) bits.push(spk + ' 个说话人');
    let line = bits.join('，');
    const from = ['highlights', 'todos', 'factchecks'].map(k => src[k]).filter(Boolean);
    if (from.length === 3)
      line += (line ? '。' : '') + '从会中记下的 ' + from[0] + ' 条要点、' + from[1] + ' 条待办、' + from[2] + ' 条待核查里，收敛成下面这些。';
    else if (line) line += '。';
    // 智能总结开头若有一段散文（不是条目），留它一句，那往往是最像「总结」的一句
    const first = String(session.summary || '').split('\n').map(x => x.trim())
      .filter(Boolean).find(x => !/^[#\-*\d]/.test(x) && !/按你要求的结构|仅基于所给/.test(x) && x.length > 12);
    if (first) line = (line ? line + '\n\n' : '') + first;
    if (line) L.push('', '## 总结', '', line);
  }
  if (hl.length) { L.push('', '## 核心要点'); hl.forEach(x => L.push('- ' + x.text)); }
  if (ck.length) {
    L.push('', '## 核心纠错');
    ck.forEach(x => {
      const v = VERDICT[String(x.verdict)] || '';
      L.push('- ' + x.text + (v ? '（' + v + '）' : '') + (x.note ? ' —— ' + x.note : ''));
    });
  }
  if (td.length) {
    L.push('', '## 核心待办');
    td.forEach(x => L.push('- ' + x.text + (x.owner ? '（' + x.owner + (x.due ? ' · ' + x.due : '') + '）' : (x.due ? '（' + x.due + '）' : ''))));
  }
  return L.join('\n');
}

// 保存一次过审的结果。返回写了几张卡、投影落在哪、给人看的那份纪要。
async function apply(dataDir, session, rawDecisions, projectionPath, log = () => {}) {
  const condensed = session.condensed || { highlights: session.highlights || [], todos: session.todos || [], factchecks: session.factchecks || [] };
  const decisions = (Array.isArray(rawDecisions) ? rawDecisions : []).map(normalizeDecision).filter(Boolean).slice(0, 200);
  if (!decisions.length) return { ok: false, error: '没有可保存的判断' };

  const note = shareNote(session, decisions, condensed);
  let written = 0, projected = '';
  try {
    const db = mem.open(dataDir);
    const cards = toCards(session, decisions, condensed);
    // 同一场重复过审：先清掉上一次由过审写进去的卡，避免越攒越多
    try {
      mem.inTx(db, () => {
        const olds = db.prepare("SELECT id FROM cards WHERE meeting_id=? AND review_note='过审确认'").all(session.id || '');
        for (const o of olds) { db.prepare('DELETE FROM card_history WHERE id=?').run(o.id); db.prepare('DELETE FROM cards WHERE id=?').run(o.id); }
      });
    } catch (e) { log('过审：清旧卡失败 ' + e.message); }
    for (const c of cards) {
      try { if (mem.putCard(db, { ...c, review_note: '过审确认' })) written++; }
      catch (e) { log('过审：写卡失败 ' + e.message); }
    }
    if (projectionPath) {
      try { ops.project(dataDir, projectionPath, log); projected = projectionPath; }
      catch (e) { log('过审：投影更新失败 ' + e.message); }
    }
  } catch (e) { log('过审：记忆库不可用 ' + e.message); }

  return { ok: true, decisions, written, projected, note, at: Date.now() };
}

module.exports = { apply, shareNote, toCards, normalizeDecision, __test: { normalizeDecision, shareNote, toCards } };
