'use strict';
// 主动智能批 4（需求单 F5）：每场结束会后台那块小统计——四个数，全部从账本和场次文件算出来，不另存一份计数器。
//   jevCalls     = usage.jsonl 里 sessionId 相同且 provider === 'jev' 的行数（每次门卫调用记一行，失败也记；app/jev-gate.js）
//   sonnetCalls  = usage.jsonl 里 sessionId 相同、provider !== 'jev'、tier 属于 live 档（live / triage / quick）的行数
//                  ——「Sonnet」是会中分诊的 live 档模型（settings 的 LLM_MODEL_LIVE 默认 sonnet）；这里按档位数，换了模型也不用改
//   insights     = 场次 factchecks（看法卡）条数
//   adopted      = 看法卡里被采纳的：rating === 'adopt'，或者那一个按钮已经执行完（actionState.status === 'done'）——点按钮 = 批准 = 采纳
// 账本只读一遍：先按 sessionId 子串粗筛再 JSON.parse，usage.jsonl.1（滚过的那份）一起看。
const fs = require('fs'), path = require('path');

const LIVE_TIERS = new Set(['live', 'triage', 'quick']);

function readUsageRows(dataDir, sessionId) {
  const sid = String(sessionId || '');
  if (!dataDir || !sid) return [];
  const needle = JSON.stringify(sid);
  const rows = [];
  for (const name of ['usage.jsonl.1', 'usage.jsonl']) {
    let txt = '';
    try { txt = fs.readFileSync(path.join(dataDir, 'state', name), 'utf8'); } catch (e) { continue; }
    for (const line of txt.split('\n')) {
      if (!line || !line.includes(needle)) continue;
      try { const j = JSON.parse(line); if (j && String(j.sessionId || '') === sid) rows.push(j); } catch (e) {}
    }
  }
  return rows;
}

function compute(sess, usageRows) {
  const rows = Array.isArray(usageRows) ? usageRows : [];
  const cards = Array.isArray(sess && sess.factchecks) ? sess.factchecks.filter(Boolean) : [];
  const jevCalls = rows.filter(r => r && r.provider === 'jev').length;
  const sonnetCalls = rows.filter(r => r && r.provider !== 'jev' && LIVE_TIERS.has(String(r.tier || ''))).length;
  const adopted = cards.filter(c => c.rating === 'adopt' || (c.actionState && c.actionState.status === 'done')).length;
  return { jevCalls, sonnetCalls, insights: cards.length, adopted, at: Date.now() };
}

function forSession(dataDir, sess) { return compute(sess, readUsageRows(dataDir, sess && sess.id)); }

module.exports = { compute, readUsageRows, forSession, LIVE_TIERS };
