'use strict';
// Project Brain 差异（2026-09-24 Aaron 拍板的 V1 闭环里唯一新增的一段）：
//   会后拿「这场抽出来的记忆卡 + 收敛结果」对照 `.memory/project-state.md`（当前状态，agent 共读），
//   让模型只回答一个问题：这场会改变了我们对项目的哪些认知？
//   产出 N 条 BEFORE / AFTER 差异，状态一律 pending；Aaron 在会后处理台点「接受 / 改一下 / 不要」后
//   才写回 project-state.md 对应的 `## ` 节（一行、带来源）。模型永远写不到 project-state.md。
// 文件：
//   <DATA>/state/memory-updates/<sid>.json         真源（含每条的决定）
//   <DATA>/state/memory-updates/rejected.json      被拒条目的指纹，下次同义不再提
//   <projection>/pending/memory-updates/<sid>.md   给 Claude / Codex 看的镜像；全部处理完移到 applied/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = ['new_fact', 'changed_fact', 'decision', 'superseded_decision', 'owner_change', 'milestone_change', 'new_action', 'resolved_question', 'new_open_question', 'assumption', 'risk', 'blocker'];
const LEVELS = ['mentioned', 'discussed', 'proposed', 'agreed', 'decided'];
const TYPE_LABEL = { new_fact: '新事实', changed_fact: '口径变化', decision: '决定', superseded_decision: '推翻旧决定', owner_change: '负责人变化', milestone_change: '节点变化', new_action: '新动作', resolved_question: '未定项已定', new_open_question: '新未定项', assumption: '假设', risk: '风险', blocker: '阻塞' };
const LEVEL_LABEL = { mentioned: '提到', discussed: '讨论过', proposed: '有人提议', agreed: '会上同意', decided: '会上拍板' };
const MAX_ITEMS = 8;
const STATE_CAP = 60000;   // Codex 一审：状态文件 3.7 万字，不能静默截半；超过就记日志
const CARDS_CAP = 6000;
const MAX_OUTPUT_TOKENS = 2500;

const clean = (s, n = 400) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const short = s => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
const fingerprint = it => short(clean(it.section, 80) + '|' + clean(it.field, 80).toLowerCase() + '|' + clean(it.after, 200).toLowerCase());

function dirOf(dataDir) { const d = path.join(dataDir, 'state', 'memory-updates'); fs.mkdirSync(d, { recursive: true }); return d; }
function fileOf(dataDir, sid) { return path.join(dirOf(dataDir), sid + '.json'); }
function writeAtomic(file, text, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text, { mode }); fs.renameSync(tmp, file);
}
function readJSON(file, fb = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fb; } }

// project-state.md 的节标题（`## N. xxx`），差异只能落到这些节里
function sections(stateText) {
  return String(stateText || '').split('\n').filter(l => /^## /.test(l)).map(l => l.trim());
}

function systemPrompt(sectionList) {
  return [
    '你是 Chansey 项目的记忆管理员。任务：对照「项目当前状态」和「这场会抽出来的内容」，只回答一个问题——这场会改变了我们对项目的哪些认知？',
    '规则：',
    '1. 只输出会改变现状的条目：状态里没有的新事实、和状态不一致的口径、被推翻的决定、负责人 / 日期变化、未定项被回答、新的未定项、明确的风险或阻塞。状态里已经有、说法一致的，不输出。',
    '2. 会上说过不等于决定。每条必须标 level：mentioned / discussed / proposed / agreed / decided。「也许可以…」是 proposed，不是 decided。',
    '3. before 引用状态原句（≤120 字），状态里没有就写「（无）」；after 写会后应改成的那一句，用陈述句、带具体数字 / 日期 / 人名，不写「建议」「值得关注」。',
    '4. section 必须是下面列表里的一行原文：\n' + sectionList.map(s => '   ' + s).join('\n'),
    '5. evidence 引用会上的原话（≤80 字），不许编。confidence: high / medium / low。',
    '6. 最多 ' + MAX_ITEMS + ' 条，没有就输出空数组。只输出 JSON：{"updates":[{"type":"","section":"","field":"","before":"","after":"","evidence":"","level":"","confidence":""}]}',
    '   type 取值：' + TYPES.join(' / '),
  ].join('\n');
}

function userPrompt({ stateText, meeting, cardsText, condensedText }) {
  return [
    '【项目当前状态 project-state.md（截断到 ' + STATE_CAP + ' 字）】', String(stateText || '').slice(0, STATE_CAP),
    '', '【这场会】' + clean(meeting.title, 120) + '　' + clean(meeting.date, 40) + '　id=' + meeting.id,
    '【这场抽出来的记忆卡（决定 / 疑问 / 承诺 / 术语，每张已对过逐字稿）】', String(cardsText || '（无）').slice(0, CARDS_CAP),
    '【会后收敛的要点 / 待办】', String(condensedText || '（无）').slice(0, 3000),
  ].join('\n');
}

// 模型爱在 JSON 外面裹解释：从第一个 { 到配对的 } 截出来
function parse(raw) {
  const s = String(raw || '');
  const i = s.indexOf('{'); if (i < 0) return [];
  let depth = 0, inStr = false, esc = false;
  for (let k = i; k < s.length; k++) {
    const ch = s[k];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '{') depth++; else if (ch === '}') { depth--; if (!depth) { try { const j = JSON.parse(s.slice(i, k + 1)); return Array.isArray(j.updates) ? j.updates : []; } catch (e) { return []; } } }
  }
  return [];
}

function normalize(items, sectionList, rejected = new Set()) {
  const out = [], seen = new Set();
  const secs = sectionList.length ? sectionList : ['## 8b. 当前未定项与口径差'];
  for (const it of (Array.isArray(items) ? items : [])) {
    if (!it || typeof it !== 'object') continue;
    const after = clean(it.after, 300); if (after.length < 4) continue;
    const type = TYPES.includes(it.type) ? it.type : 'new_fact';
    const level = LEVELS.includes(it.level) ? it.level : 'discussed';
    let section = clean(it.section, 120);
    let sectionGuessed = false;
    if (!secs.includes(section)) { const hit = secs.find(s => section && s.includes(section.replace(/^##\s*/, '').split(/[.。 ]/)[0])); section = hit || secs.find(s => /8b/.test(s)) || secs[secs.length - 1]; sectionGuessed = true; }
    const row = { type, level, section, sectionGuessed, field: clean(it.field, 80) || TYPE_LABEL[type], before: clean(it.before, 300) || '（无）', after, evidence: clean(it.evidence, 200), confidence: ['high', 'medium', 'low'].includes(it.confidence) ? it.confidence : 'medium' };
    const fp = fingerprint(row);
    if (seen.has(fp) || rejected.has(fp)) continue;
    seen.add(fp);
    out.push({ uid: 'u-' + fp, fp, ...row, decision: null });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function cardsFromDb(dataDir, sid, log = () => {}) {
  try {
    const mem = require('./memory');
    const db = mem.open(dataDir);
    return db.prepare("SELECT kind, topic, text, owner, due, state FROM cards WHERE meeting_id=? AND state<>'revoked' ORDER BY kind, recorded_at").all(String(sid));
  } catch (e) { log('memory-diff: 读卡失败 ' + e.message); return []; }
}
function cardsText(cards) {
  return (cards || []).map(c => `- [${c.kind}${c.topic ? ' · ' + c.topic : ''}] ${c.text}${c.owner ? '（' + c.owner + (c.due ? ' ' + c.due : '') + '）' : ''}`).join('\n');
}
function condensedText(session) {
  const c = session.condensed || {};
  const hl = (c.highlights || session.highlights || []).slice(0, 20).map(h => '- 要点：' + clean(h.text || h, 160));
  const td = (c.todos || session.todos || []).slice(0, 10).map(t => '- 待办：' + clean(t.text || t, 160) + (t.owner ? '（' + t.owner + '）' : ''));
  return hl.concat(td).join('\n');
}

function renderMd(doc) {
  const lines = ['# 待确认：会议「' + doc.title + '」（' + doc.date + '，id ' + doc.id + '）对项目状态的差异', '', '未经 Aaron 在听会台会后处理台点「接受」，下面每条都只是模型判断，不是项目知识。生成于 ' + doc.at + '。', ''];
  for (const it of doc.items) {
    const d = it.decision;
    lines.push(`## ${TYPE_LABEL[it.type] || it.type} · ${it.field}${d ? '　→ ' + (d.action === 'accept' ? '已接受' : d.action === 'edit' ? '已改为：' + d.text : '已拒绝') : '　（待确认）'}`);
    lines.push('- 落到：' + it.section);
    lines.push('- BEFORE：' + it.before);
    lines.push('- AFTER：' + it.after);
    lines.push('- 会上原话：' + (it.evidence || '（无）'));
    lines.push('- 会上到哪一级：' + (LEVEL_LABEL[it.level] || it.level) + '　把握：' + it.confidence);
    lines.push('');
  }
  if (!doc.items.length) lines.push('（这场会没有改变项目状态的内容）');
  return lines.join('\n') + '\n';
}
function mirrorPaths(projectionDir, sid) {
  return { pending: path.join(projectionDir, 'pending', 'memory-updates', sid + '.md'), applied: path.join(projectionDir, 'pending', 'memory-updates', 'applied', sid + '.md') };
}
function mirror(projectionDir, doc, log = () => {}) {
  if (!projectionDir) return;
  const p = mirrorPaths(projectionDir, doc.id);
  const done = doc.items.every(it => it.decision);   // 空差异也算处理完，直接进 applied
  try {
    writeAtomic(done ? p.applied : p.pending, renderMd(doc));
    if (done) { try { fs.unlinkSync(p.pending); } catch (e) {} }
  } catch (e) { log('memory-diff: 镜像写入失败 ' + e.message); }
}

// 生成：读状态文件 + 这场的卡，问一次模型，落盘 pending。同一场重跑会覆盖没决定过的条目，保留已决定的。
async function run({ dataDir, session, ask, stateFile, projectionDir, log = () => {} }) {
  const sid = String(session.id || ''); if (!sid) return { ok: false, error: 'no id' };
  let stateText = ''; try { stateText = fs.readFileSync(stateFile, 'utf8'); } catch (e) { return { ok: false, error: '读不到项目状态文件 ' + stateFile }; }
  const secs = sections(stateText);
  if (stateText.length > STATE_CAP) log(`memory-diff: 状态文件 ${stateText.length} 字超过 ${STATE_CAP}，尾部未参与对照`);
  const cards = cardsFromDb(dataDir, sid, log);
  const ct = cardsText(cards), cd = condensedText(session);
  if (!ct && !cd) { log('memory-diff: 这场没有卡也没有收敛结果，跳过 ' + sid); return { ok: true, skipped: true, count: 0 }; }
  const meeting = { id: sid, title: clean(session.topicTitle || session.title || '会议', 120), date: String(session.start || session.end || '').slice(0, 10) };
  const t0 = Date.now();
  const raw = await ask(systemPrompt(secs), userPrompt({ stateText, meeting, cardsText: ct, condensedText: cd }), MAX_OUTPUT_TOKENS);
  const rejected = new Set(Object.keys(readJSON(path.join(dirOf(dataDir), 'rejected.json'), {})));
  const fresh = normalize(parse(raw), secs, rejected);
  const old = readJSON(fileOf(dataDir, sid));
  const kept = old && Array.isArray(old.items) ? old.items.filter(it => it.decision) : [];
  const keptFp = new Set(kept.map(it => it.fp));
  const items = kept.concat(fresh.filter(it => !keptFp.has(it.fp)));
  const doc = { id: sid, title: meeting.title, date: meeting.date, at: new Date().toISOString(), stateFile, items, model: { ms: Date.now() - t0, rawChars: String(raw || '').length } };
  writeAtomic(fileOf(dataDir, sid), JSON.stringify(doc, null, 1));
  mirror(projectionDir, doc, log);
  log(`memory-diff: ${sid} ${doc.model.ms}ms 差异 ${fresh.length} 条（卡 ${cards.length}）`);
  return { ok: true, count: fresh.length, doc };
}

function read(dataDir, sid) { return readJSON(fileOf(dataDir, String(sid))); }

// 写回 project-state.md：找到目标 `## ` 节，在该节末尾（下一个 `## ` 之前）追加一行，带来源。原子写。
function applyToState(stateFile, item, text, meeting) {
  const src = fs.readFileSync(stateFile, 'utf8');
  const lines = src.split('\n');
  // Codex 一审：写回时节必须精确存在，找不到就拒绝，不再兜底改写到别的节
  const start = lines.findIndex(l => l.trim() === item.section);
  if (start < 0) throw new Error('状态文件里找不到节 ' + item.section + '，没有写回');
  let end = lines.length;
  for (let k = start + 1; k < lines.length; k++) if (/^## /.test(lines[k])) { end = k; break; }
  // 节尾的空行留在新行后面
  let ins = end; while (ins > start + 1 && lines[ins - 1].trim() === '') ins--;
  const line = `- 〔会议更新 ${meeting.date}〕**${item.field}**：${text}（原：${item.before}）来源：会议 ${meeting.id}「${meeting.title}」，${LEVEL_LABEL[item.level] || item.level}，Aaron 已确认 ${new Date().toISOString().slice(0, 10)}`;
  lines.splice(ins, 0, line);
  let out = lines.join('\n');
  out = out.replace(/Last updated: \d{4}-\d{2}-\d{2}/, 'Last updated: ' + new Date().toISOString().slice(0, 10));
  writeAtomic(stateFile, out, 0o644);
  return line;
}

// 一条决定：accept / edit / reject；all=true 时对所有未决条目做 accept
function decide({ dataDir, sid, uid, action, text = '', all = false, confirmed = false, projectionDir, log = () => {} }) {
  // Codex 一审：确认不只在路由层查，写回函数自己也要拿到 confirmed === true
  if (confirmed !== true) { const e = Error('没有界面确认，不写回'); e.code = 400; throw e; }
  const doc = read(dataDir, sid); if (!doc) { const e = Error('这场会还没有差异数据'); e.code = 404; throw e; }
  if (!['accept', 'edit', 'reject'].includes(action)) throw new Error('动作不对');
  const targets = all ? doc.items.filter(it => !it.decision) : doc.items.filter(it => it.uid === uid);
  if (!targets.length) { const e = Error(all ? '没有待确认的条目' : '找不到这条'); e.code = 404; throw e; }
  const meeting = { id: doc.id, title: doc.title, date: doc.date };
  const written = [];
  for (const it of targets) {
    if (it.decision) continue;
    const t = action === 'edit' ? clean(text, 300) : it.after;
    if (action === 'edit' && t.length < 4) throw new Error('改后的内容太短');
    if (action === 'reject') {
      const rf = path.join(dirOf(dataDir), 'rejected.json'); const rej = readJSON(rf, {}); rej[it.fp] = { at: new Date().toISOString(), sid, after: it.after }; writeAtomic(rf, JSON.stringify(rej, null, 1));
      it.decision = { action, at: Date.now(), confirmed: true };
    } else {
      const line = applyToState(doc.stateFile, it, t, meeting);
      it.decision = { action, text: t, at: Date.now(), line, confirmed: true };
      written.push(line);
    }
  }
  writeAtomic(fileOf(dataDir, sid), JSON.stringify(doc, null, 1));
  mirror(projectionDir, doc, log);
  log(`memory-diff: ${sid} ${action}${all ? '(all)' : ''} 写回 ${written.length} 行`);
  return { ok: true, doc, written };
}

function summary(doc) {
  const pending = doc.items.filter(it => !it.decision).length;
  return { total: doc.items.length, pending, done: doc.items.length - pending };
}

module.exports = { run, read, decide, summary, TYPES, LEVELS, TYPE_LABEL, LEVEL_LABEL, MAX_ITEMS, __test: { parse, normalize, sections, applyToState, renderMd, fingerprint, systemPrompt, userPrompt } };
