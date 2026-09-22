'use strict';
// 洞察（「看法」窗口，0.6.14 起）的服务端门槛。模型说自己「引用了项目记忆」不算，这里按内容硬查（Codex b0d361a5 复审 4 条 major 之一）：
//   claim  ≤30 字（prompt 里就是这个数；以前截 60，等于没限制）
//   source 必须命中一处「具体出处」——【本场背景】里出现过的文档 / 章节标题、团队名单或参会人的名字、日期（9-5 / 09-05 / 9月5日）、
//          决策编号 D1–D9、会中时间戳（[125s] / 12:30 / 01:02:03）。命不中就整条丢。
//   why    必须说清省了本人哪一步：含「省 / 不用 / 已 / 已经 / 直接」之一；否则要 ≥8 字且不是泛词（有帮助 / 值得注意 …）。
// 返回 null = 丢弃。ctx = { brief, names }：brief 是用户填的本场背景原文，names 是参会人 + 团队名单。
const INSIGHT_BAN = /无法核实|需确认|待核实|需要确认|待确认|建议|应该|可以考虑|听错|说错|口误|cannot (be )?verif|not verifiable|you should|consider /i;
// why 里的泛词：整句去标点后就是这些词（或以它们收尾）的，等于什么都没说
const WHY_GENERIC = /^(很|非常|比较|挺|较)?(有帮助|有用|有价值|有意义|值得注意|值得关注|需要注意|需要关注|重要|很重要|供参考|参考|提醒|注意|相关|有关|背景信息|补充信息|知识点|信息)(。|！|!)?$/;
const WHY_SAVES = /省|不用|已|已经|直接|saves?|skip|already|no need/i;
const DATE_RE = /(?:20\d{2}[-/.年])?\d{1,2}[-/月]\d{1,2}(?!\d)/;
const DECISION_RE = /\bD\d\b/;
const TIMESTAMP_RE = /\[\d+s\]|\b\d{1,2}:\d{2}(?::\d{2})?\b/;
const CLAIM_MAX = 30, SOURCE_MAX = 80, WHY_MAX = 80;

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

function whyOk(why) {
  const w = String(why || '').trim(); if (!w) return false;
  if (WHY_SAVES.test(w)) return true;
  const flat = strip(w); if ([...flat].length < 8) return false;
  return !WHY_GENERIC.test(w.replace(/\s/g, ''));
}

function normalizeInsight(f, ctx) {
  if (!f || typeof f !== 'object') return null;
  const claim = String(f.claim || '').trim().slice(0, CLAIM_MAX), source = String(f.source || '').trim().slice(0, SOURCE_MAX), why = String(f.why || '').trim().slice(0, WHY_MAX);
  if (!claim || !source || !why) return null;
  if (INSIGHT_BAN.test(claim) || INSIGHT_BAN.test(why)) return null;
  if (!sourceGrounded(source, ctx)) return null;
  if (!whyOk(why)) return null;
  return { kind: 'insight', claim, source, why, refs: Array.isArray(f.refs) ? f.refs.map(String).slice(0, 6) : [], note: why, verdict: 'true' };
}

module.exports = { normalizeInsight, sourceGrounded, whyOk, briefTerms, INSIGHT_BAN, CLAIM_MAX };
