'use strict';
// 主动智能批 4（需求单 F5）：useful / useless / adopt 反馈按 type（conflict / recheck / answer）计数，
// 「useless 多的那一类少给」——规则只有一条，简单到能测：
//   某一类在本场 useless ≥ DEMOTE_MIN（默认 2）且 useless > useful + adopt → 这一类被降权
//   降权 = 提示词里明说「这一类本轮最多 1 条」+ 服务端归一化后同类只留 1 条（模型不听话也拦得住）
// 反馈记录形状（/view-feedback 写进 state/view-feedback.jsonl 的同一条）：{ rating, type, kind, claim, comment }
// 没带 type 的老记录不参与计数（不猜类型）。
const TYPES = ['conflict', 'recheck', 'answer'];
const DEMOTE_MIN = 2;
const LABEL = { conflict: '对不上（conflict）', recheck: '空转（recheck）', answer: '递答案（answer）' };

function tally(feedback) {
  const out = {};
  for (const t of TYPES) out[t] = { useful: 0, useless: 0, adopt: 0 };
  for (const f of Array.isArray(feedback) ? feedback : []) {
    if (!f || !TYPES.includes(f.type)) continue;
    if (f.rating === 'useful' || f.rating === 'useless' || f.rating === 'adopt') out[f.type][f.rating]++;
  }
  return out;
}

// 返回被降权的 type 列表（按 useless 多到少）
function demotedTypes(feedback, min = DEMOTE_MIN) {
  const t = tally(feedback);
  return TYPES.filter(k => t[k].useless >= min && t[k].useless > t[k].useful + t[k].adopt).sort((a, b) => t[b].useless - t[a].useless);
}

// 提示词里的那一段；没有降权的类就返回空串
function promptBlock(feedback, min = DEMOTE_MIN) {
  const d = demotedTypes(feedback, min);
  if (!d.length) return '';
  const t = tally(feedback);
  return '\n\n【少给】' + d.map(k => `${LABEL[k]} 这场他已标 ${t[k].useless} 条没用，本轮这一类最多 1 条，拿不准就不出`).join('；') + '。';
}

// 归一化之后再过一道：被降权的类每轮只留第一条（保留原顺序）
function capDemoted(insights, feedback, min = DEMOTE_MIN) {
  const d = new Set(demotedTypes(feedback, min));
  if (!d.size) return insights;
  const seen = new Set(); const out = [];
  for (const x of insights || []) {
    const type = x && TYPES.includes(x.type) ? x.type : 'answer';
    if (d.has(type)) { if (seen.has(type)) continue; seen.add(type); }
    out.push(x);
  }
  return out;
}

module.exports = { tally, demotedTypes, promptBlock, capDemoted, TYPES, DEMOTE_MIN };
