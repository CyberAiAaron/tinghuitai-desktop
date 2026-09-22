'use strict';
// 洞察（「看法」窗口，0.6.14 起）的服务端门槛。模型说自己「引用了项目记忆」不算，这里按内容硬查（Codex b0d361a5 复审 4 条 major 之一）：
//   claim  ≤30 字（prompt 里就是这个数；以前截 60，等于没限制）
//   source 必须命中一处「具体出处」——【本场背景】里出现过的文档 / 章节标题、团队名单或参会人的名字、日期（9-5 / 09-05 / 9月5日）、
//          决策编号 D1–D9、会中时间戳（[125s] / 12:30 / 01:02:03）。命不中就整条丢。
//   why    必须说清省了本人哪一步：含「省 / 不用 / 已 / 已经 / 直接」之一；否则要 ≥8 字且整句里没有泛词片段（有帮助 / 很重要 / 值得关注 …，出现在任何位置都算）。
// 主动智能批 2（需求单 §5.2）三类 type，缺 type 按 answer（旧模型 / 旧提示词）：
//   conflict 对不上：claim ≤60；必带 evidence（会上原话 ≤40 字）+ source + refs（非空）；action.do = open_source
//   recheck  空转（承诺回查）：claim ≤60；必带 source + evidence；action.do = set_date
//   answer   递答案：现状不变（claim ≤30、source、why）；action.do = none
//   action.do 与 type 不匹配或缺失 → 按 type 改成对应值（模型写错按钮不该把一条好洞察整条丢掉）；type 不在三类里 → 整条丢。
// 返回 null = 丢弃。ctx = { brief, names }：brief 是用户填的本场背景原文，names 是参会人 + 团队名单。
const INSIGHT_BAN = /无法核实|需确认|待核实|需要确认|待确认|建议|应该|可以考虑|听错|说错|口误|cannot (be )?verif|not verifiable|you should|consider /i;
// why 里的泛词片段：出现在任何位置都算空话（「这条很有帮助」「对项目很重要」），除非同一句里说清了省了哪一步（WHY_SAVES）。
// Codex 94dd3aa4 复审：以前只拦整句全等，前后加几个字就放过去了。
const WHY_GENERIC = /(有帮助|有用|有价值|有意义|值得注意|值得关注|值得留意|需要注意|需要关注|重要|供参考|参考价值|背景信息|补充信息|知识点|相关信息|作为参考|提醒一下|helpful|useful|important|worth noting|for reference)/i;
const WHY_SAVES = /省|不用|已|已经|直接|saves?|skip|already|no need/i;
const DATE_RE = /(?:20\d{2}[-/.年])?\d{1,2}[-/月]\d{1,2}(?!\d)/;
const DECISION_RE = /\bD\d\b/;
const TIMESTAMP_RE = /\[\d+s\]|\b\d{1,2}:\d{2}(?::\d{2})?\b/;
const CLAIM_MAX = 30, SOURCE_MAX = 80, WHY_MAX = 80, EVIDENCE_MAX = 40, CLAIM_MAX_LONG = 60;
const TYPES = ['conflict', 'recheck', 'answer'];
const ACTION_OF = { conflict: 'open_source', recheck: 'set_date', answer: 'none' };
const ACTIONS = Object.values(ACTION_OF);

// 两个汉字的片段也能当出处（歌尔 / 高通 / 新宇 这类公司名、人名），但背景里常见的虚词不算
const BRIEF_STOP = new Set(['本场', '背景', '材料', '会议', '讨论', '今天', '大家', '这次', '我们', '项目', '产品', '评审', '参会', '主题', '内容', '团队', '名单', '公司', '网站', '人名', '判断', '为准', '相关', '资料', '文档', '记忆', '以下', '如下', '包括', '关于', '同步', '例会', '周会']);
const strip = s => String(s || '').replace(/[\s“”"'‘’「」『』（）()《》【】，。、,.!?！？：:；;…—\-·]/g, '');

// 【本场背景】里能当出处的词：书名号 / 引号里的整段，加上按标点切出来的 ≥3 字片段（人名、公司、文档名都在里面）。
function briefTerms(brief) {
  const text = String(brief || ''); if (!text.trim()) return [];
  const out = new Set();
  for (const m of text.matchAll(/[《「『【“"]([^》」』】”"]{2,60})[》」』】”"]/g)) out.add(strip(m[1]));
  for (const seg of text.split(/[\s，。；：、,.;:!?！？（）()《》【】「」『』“”"'\n\/|]+/)) { const t = strip(seg); const n = [...t].length; if (n >= 3 || (n === 2 && /^[\u4e00-\u9fff]{2}$/.test(t) && !BRIEF_STOP.has(t))) out.add(t); }
  return [...out].filter(Boolean);
}

function sourceGrounded(source, ctx) {
  const raw = String(source || ''); if (!raw.trim()) return false;
  if (DATE_RE.test(raw) || DECISION_RE.test(raw) || TIMESTAMP_RE.test(raw)) return true;
  const flat = strip(raw), low = flat.toLowerCase();
  // 人名：全名或其中一段（Hannah Yin → Hannah / Yin）都算，和 rebuildNameTable 拆名的口径一致；≥3 字母 / 2 个汉字，免得「Li」这种碎片乱撞
  for (const n of (ctx && ctx.names) || []) for (const part of [String(n || ''), ...String(n || '').split(/\s+/)]) { const k = strip(part).toLowerCase(); if (k && (/^[a-z]+$/.test(k) ? k.length >= 3 : k.length >= 2) && low.includes(k)) return true; }
  for (const t of briefTerms(ctx && ctx.brief)) if (low.includes(t.toLowerCase())) return true;
  return false;
}

// 顺序：先看有没有说清省了哪一步（含「省 / 不用 / 已 / 已经 / 直接」之一 → 过）；否则去标点后 ≥8 字，且整句里不许出现泛词片段。
function whyOk(why) {
  const w = String(why || '').trim(); if (!w) return false;
  if (WHY_SAVES.test(w)) return true;
  const flat = strip(w); if ([...flat].length < 8) return false;
  return !WHY_GENERIC.test(flat);
}

function normalizeInsight(f, ctx) {
  if (!f || typeof f !== 'object') return null;
  const type = f.type == null || f.type === '' ? 'answer' : String(f.type).trim().toLowerCase();
  if (!TYPES.includes(type)) return null;
  const claimMax = type === 'answer' ? CLAIM_MAX : CLAIM_MAX_LONG;
  const claim = String(f.claim || '').trim().slice(0, claimMax), source = String(f.source || '').trim().slice(0, SOURCE_MAX), why = String(f.why || '').trim().slice(0, WHY_MAX);
  const evidence = [...String(f.evidence || '').trim()].slice(0, EVIDENCE_MAX).join('');
  const refs = Array.isArray(f.refs) ? f.refs.map(x => String(x == null ? '' : x).trim()).filter(Boolean).slice(0, 6) : [];
  if (!claim || !source || !why) return null;
  if (INSIGHT_BAN.test(claim) || INSIGHT_BAN.test(why)) return null;
  if (!sourceGrounded(source, ctx)) return null;
  if (!whyOk(why)) return null;
  if (type === 'conflict' && (!evidence || !refs.length)) return null;   // 对不上：没有会上原话、没有出处标识 → 不出
  if (type === 'recheck' && !evidence) return null;                      // 空转：没有这次「我来 / 回头」的原话 → 不出
  const args = f.action && typeof f.action === 'object' && f.action.args && typeof f.action.args === 'object' && !Array.isArray(f.action.args) ? f.action.args : {};
  const action = { do: ACTION_OF[type], args };
  return { kind: 'insight', type, claim, source, why, refs, evidence, action, note: why, verdict: 'true' };
}

module.exports = { normalizeInsight, sourceGrounded, whyOk, briefTerms, INSIGHT_BAN, CLAIM_MAX, CLAIM_MAX_LONG, EVIDENCE_MAX, TYPES, ACTION_OF, ACTIONS };
