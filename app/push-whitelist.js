'use strict';
// 会中飞书「会中提醒」白名单（THT-R4，Aaron 2026-09-21：「分析可以密，推送必须稀」）。
// 分诊照常产出 highlights / todos / insights，UI 全量可看；这里只决定其中哪几条值得推到飞书打断他：
//   ① 点名本人：要点 / 待办 / 洞察文字里出现本人名字（MEETING_PUSH_SELF_NAMES，逗号分隔）或「本人」，且是明确提问 / 交办
//   ② 冲突类：insights 里 type = conflict 的，或 highlights 以「⚠️ 冲突」开头的
//   ③ 本人承诺：todos 里 owner 是本人，且文字带明确截止日期
// 节流：两次推送最短间隔 MEETING_PUSH_MIN_GAP_MS（默认 120 秒）；同一内容（去标点前 24 字）本场只推一次。
// 开关：MEETING_PUSH = on 才推，默认 off = 零推送；开关只管推送，不碰分诊。
// 纯函数 + 一个小状态对象，不发网络请求；真正发飞书由 app/server.js 的 larkPush 经工具层（app/tools）发出。

const DATE_RE = /(20\d{2}[-/.年])?\d{1,2}[-/月]\d{1,2}(日|号)?(?!\d)|(下|本|这)周[一二三四五六日天]?|周[一二三四五六日天]|月底|今天|明天|后天|(\d{1,2}|[一二三]十?[一二三四五六七八九]?)号前|之前|以前/;
const CONFLICT_RE = /^\s*⚠️?\s*(冲突|Conflict)/i;
const ASK_RE = /[？?]|请|麻烦|能不能|可以吗|你来|你去|你负责|你定|你看|由你|交给你|问你|@|确认一下|拍一下|拍板/;
const norm = s => String(s || '').replace(/[\s“”"'‘’「」『』（）()，。、,.!?！？：:；;…—\-·⚠️]/g, '').slice(0, 24);

function selfNames(env = {}) {
  const raw = String(env.MEETING_PUSH_SELF_NAMES || '').split(/[,，;；\n]/).map(s => s.trim()).filter(Boolean);
  return [...new Set([...raw, '本人'])];
}
function mentionsSelf(text, names) {
  const t = String(text || ''); if (!t) return false;
  const low = t.toLowerCase();
  for (const n of names) { const k = String(n).toLowerCase(); if (k && low.includes(k)) return true; for (const part of k.split(/\s+/)) if (part.length >= 3 && /^[a-z]+$/.test(part) && new RegExp('\\b' + part + '\\b').test(low)) return true; }
  return false;
}
const isSelfOwner = (owner, names) => { const o = String(owner || '').trim(); if (!o) return false; if (/^(我|本人|me|myself)$/i.test(o)) return true; return mentionsSelf(o, names); };
const enabled = env => String((env || {}).MEETING_PUSH || 'off').toLowerCase() === 'on';

// pick(batch, env) -> [{ reason:'mention'|'conflict'|'self-due', text, item }]，纯判断，不管节流和开关
function pick(batch, env = {}) {
  const names = selfNames(env), out = [];
  for (const h of (batch && batch.highlights) || []) {
    if (!h || !h.text) continue;
    if (CONFLICT_RE.test(h.text)) out.push({ reason: 'conflict', text: h.text, item: h });
    else if (mentionsSelf(h.text, names) && ASK_RE.test(h.text)) out.push({ reason: 'mention', text: h.text, item: h });
  }
  for (const t of (batch && batch.todos) || []) {
    if (!t || !t.text) continue;
    const self = isSelfOwner(t.owner, names) || (!t.owner && mentionsSelf(t.text, names));
    if (self && DATE_RE.test(t.text)) out.push({ reason: 'self-due', text: `${t.text}${t.owner ? ' → ' + t.owner : ''}`, item: t });
    else if (mentionsSelf(t.text, names) && ASK_RE.test(t.text)) out.push({ reason: 'mention', text: t.text, item: t });
  }
  for (const f of (batch && (batch.factchecks || batch.insights)) || []) {
    if (!f || !f.claim) continue;
    if (f.type === 'conflict') out.push({ reason: 'conflict', text: `${f.claim}${f.source ? '（' + f.source + '）' : ''}`, item: f });
    else if (mentionsSelf(f.claim, names) && ASK_RE.test(f.claim)) out.push({ reason: 'mention', text: f.claim, item: f });
  }
  return out;
}

// Gate：一场一个。consider(batch, now) -> 这一轮该推出去的条目（已过开关、去重、节流）；不推的原因记在 lastSkip。
class Gate {
  constructor(env = {}, opts = {}) {
    this.env = env; this.enabled = enabled(env);
    this.minGapMs = Number(env.MEETING_PUSH_MIN_GAP_MS) >= 0 ? Number(env.MEETING_PUSH_MIN_GAP_MS) : 120000;
    this.seen = new Set(); this.lastPushAt = 0; this.pushed = 0; this.considered = 0; this.suppressed = 0; this.lastSkip = '';
    this.log = opts.log || (() => {});
  }
  consider(batch, now = Date.now()) {
    const cands = pick(batch, this.env); this.considered += cands.length;
    if (!cands.length) return [];
    if (!this.enabled) { this.suppressed += cands.length; this.lastSkip = 'off'; return []; }
    const fresh = [];
    for (const c of cands) { const k = norm(c.text); if (!k || this.seen.has(k)) { this.suppressed++; continue; } this.seen.add(k); fresh.push(c); }
    if (!fresh.length) { this.lastSkip = 'dup'; return []; }
    if (this.lastPushAt && now - this.lastPushAt < this.minGapMs) {
      // 节流期内：这些内容已记成 seen，不会再推；R4 要的是「稀」，不是「晚一点补推」
      this.suppressed += fresh.length; this.lastSkip = 'throttle'; return [];
    }
    this.lastPushAt = now; this.pushed += fresh.length; this.lastSkip = '';
    return fresh;
  }
  stats() { return { enabled: this.enabled, considered: this.considered, pushed: this.pushed, suppressed: this.suppressed, lastSkip: this.lastSkip }; }
}

const REASON_CN = { mention: '点名', conflict: '冲突', 'self-due': '本人截止' };
// 推送正文：一条一行，带原因标签；≤3 行走 markdown（规则 §2.2）
function formatMessage(title, items) {
  const lines = items.slice(0, 3).map(x => `- 【${REASON_CN[x.reason] || x.reason}】${String(x.text || '').slice(0, 120)}`);
  return `【听会台 · 会中提醒】${title || ''}\n${lines.join('\n')}`;
}

module.exports = { pick, Gate, selfNames, mentionsSelf, enabled, formatMessage, norm };
