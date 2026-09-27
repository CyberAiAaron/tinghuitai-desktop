'use strict';
// 门卫（Jev）：会中每一句最终转写到达就问一次 TypeSafe System One「这句值不值得记、是哪类」，
// 命中才立刻叫大模型分诊，定时器退为兜底。它不生成文字、不进 prompt 正文，所以不走 app/llm.js 的 ask；
// 用量仍记进同一本账（provider 'jev'）。主动智能需求单 §4 F1 / §5.1（Aaron 2026-09-22 拍板，上云链路已确认）。
//
// 硬规矩：
//   · 失败 = 未命中：超时 3 秒、重试 1 次，仍失败只记 failures，不阻塞转写、不抛。
//   · 状态 = 前两句 + 当前句；两道题 worth（noul）/ kind（choice）。
//   · 命中 = noul ≥ JEV_THRESHOLD（默认 0.5）且 kind ≠ none。
//   · 两次触发最少间隔 JEV_MIN_GAP_MS（默认 2000，Aaron 2026-09-22 拍板；09-21 那场 315 句回放：2s 纯间隔 151 次、叠 12s 分诊锁 134 次，8s 为 143 / 134，实际上限由分诊时长决定）；间隔内的命中合并成一次延后触发。
//   · JEV_GATE 不是 on、或没有 JEV_API_KEY：一次都不调，行为与没有这个模块完全一样。
//   · 没密钥时（M7，09-25）：本机规则门卫顶上——数字 / 日期 / 人名 / 问句 / 决定词命中就触发分诊，同样守 2 秒最小间隔，
//     不联网、不记账；LOCAL_GATE=off 可关，关了回到 25 秒定时全量。
//   · 接口地址写死；只有测试进程（THT_TEST）能用 THT_JEV_URL 指到本机假服务。
const { recordUsage } = require('./llm');

const JEV_URL = (process.env.THT_TEST && process.env.THT_JEV_URL) || 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const DEFAULT_THRESHOLD = 0.5, DEFAULT_MIN_GAP_MS = 2000, TIMEOUT_MS = 3000, RETRIES = 1;
const KINDS = ['decision', 'todo', 'promise', 'claim', 'risk', 'none'];

const QUESTIONS = {
  worth: { type: 'noul', instructions: '判断「当前句」有没有值得会议助手记录的内容。',
    criteria: { true: '有：决定、待办、承诺、数字或事实断言、风险', false: '没有：闲聊、语气词、重复、过渡、附和' } },
  kind: { type: 'choice', instructions: '这句最主要属于哪一类？',
    criteria: { decision: '明确的决定或拍板', todo: '待办：有人要做某件事', promise: '承诺：某人说会在某时前做到某事',
      claim: '可核实的数字、日期或事实断言', risk: '风险、问题、隐患', none: '无' } },
};

// 设置项：只认 settings.json 里的四个键（默认值在 app/config.js）。
function settingsOf(env) {
  env = env || {};
  const apiKey = String(env.JEV_API_KEY || '').trim();
  // JEV_REALTIME 是 JEV_GATE 的别名（app/config.js 读文件时已换好；这里再兜一次，给直接传 env 的调用方）
  const gateRaw = String(env.JEV_GATE || '').trim() || String(env.JEV_REALTIME || '').trim();
  const on = gateRaw.toLowerCase() === 'on';
  let threshold = Number(env.JEV_THRESHOLD); if (!(threshold > 0 && threshold <= 1)) threshold = DEFAULT_THRESHOLD;
  let minGapMs = Number(env.JEV_MIN_GAP_MS); if (!(minGapMs >= 0)) minGapMs = DEFAULT_MIN_GAP_MS;
  const enabled = on && !!apiKey;
  const local = !enabled && String(env.LOCAL_GATE || 'on').trim().toLowerCase() !== 'off';
  return { apiKey, available: !!apiKey, enabled, local, active: enabled || local, requested: on, threshold, minGapMs };
}

// 状态：前两句按时间顺序各一行「上文：」，最后一行「当前句：」。没有前文就只有当前句。
function buildState(prev, text) {
  const lines = (prev || []).filter(Boolean).slice(-2).map(s => '上文：' + s);
  lines.push('当前句：' + text);
  return lines.join('\n');
}

function parseAnswer(j, threshold) {
  const a = j && j.answers; if (!a || !a.worth || !a.kind) throw Error('返回缺 answers.worth / answers.kind');
  const noul = Number(a.worth.noul); if (!(noul >= 0 && noul <= 1)) throw Error('worth.noul 不是 0–1 的数');
  const kind = KINDS.includes(a.kind.choice) ? a.kind.choice : 'none';
  return { hit: noul >= threshold && kind !== 'none', kind, noul, model: j.model || MODEL, usage: j.usage || null };
}

// 本机规则门卫（M7）：纯正则，同步。names = 人名表（负责人表 + 本场说话人名），命中一个就算。
const LOCAL_RULES = [
  ['decision', /决定|定了|拍板|就这么办|不做了|砍掉|改成|同意|否了|结论/],
  ['todo', /谁来|认领|负责|交给|跟进|下周|明天|之前给|owner|deadline/i],
  ['claim', /\d+(\.\d+)?\s*(万|亿|元|块|%|美金|美元|刀|mAh|MP|nm|g|克|毫米|mm|天|周|个月|月|年|号|点|分钟|小时|人|台|套|k|K)/],
  ['claim', /\d{1,2}\s*月\s*\d{1,2}\s*[日号]|\d{4}[-/年]\d{1,2}|周[一二三四五六日天]|Q[1-4]\b/],
  ['risk', /[?？]\s*$|是不是|要不要|能不能|行不行|为什么|怎么办|有没有|多少|哪个|风险|有问题|不对|不行/],
];
function localJudge(text, names) {
  const t = String(text || '').trim();
  if (t.length < 4) return { hit: false, kind: 'none', noul: 0, ms: 0, error: '' };
  for (const [kind, re] of LOCAL_RULES) if (re.test(t)) return { hit: true, kind, noul: 1, ms: 0, error: '', local: true };
  for (const n of names || []) if (n && String(n).length >= 2 && t.includes(n)) return { hit: true, kind: 'todo', noul: 1, ms: 0, error: '', local: true };
  return { hit: false, kind: 'none', noul: 0, ms: 0, error: '' };
}

async function once(fetchImpl, apiKey, body, timeoutMs) {
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetchImpl(JEV_URL, { method: 'POST', signal: ac.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey }, body: JSON.stringify(body) });
    if (!r.ok) throw Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

// 判一句。永远 resolve：{hit, kind, noul, ms, error}。error 非空 = 这句按未命中处理。
// dataDir 给了就记账；replay 之类离线跑传 null，不往生产账本里写。
async function judge({ env, prev, text, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS, retries = RETRIES, dataDir = null, sessionId = '', log = () => {} }) {
  const s = settingsOf(env); const t0 = Date.now();
  const body = { model: MODEL, state: buildState(prev, text), questions: QUESTIONS };
  let out = null, error = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { out = parseAnswer(await once(fetchImpl, s.apiKey, body, timeoutMs), s.threshold); error = ''; break; }
    catch (e) { error = e && e.name === 'AbortError' ? 'timeout ' + timeoutMs + 'ms' : String(e && e.message || e); }
  }
  const ms = Date.now() - t0;
  const res = out ? { hit: out.hit, kind: out.kind, noul: out.noul, ms, error: '' } : { hit: false, kind: 'none', noul: 0, ms, error };
  if (dataDir) {
    const u = out && out.usage; const inTok = u && Number(u.input_tokens ?? u.prompt_tokens ?? u.in ?? u.tokens);
    recordUsage(dataDir, { sessionId, provider: 'jev', model: out ? out.model : MODEL, requestedModel: MODEL,
      in: inTok > 0 ? inTok : Math.ceil(body.state.length / 2), out: 0, est: !(inTok > 0), tier: 'gate', purpose: 'jev-gate',
      ms, hit: res.hit, kind: res.kind, noul: res.noul, ...(error ? { error } : {}) });
  }
  if (error) log('jev 未命中（失败）' + error);
  return res;
}

// 一场会一个 Gate：管命中标记、最小间隔合并、分诊在跑时的并入。
// onTrigger 由 Session 提供（= runTriage({gate:true})）。
class Gate {
  constructor({ env, dataDir, sessionId, log = () => {}, fetchImpl, now = Date.now, onTrigger = () => {}, timeoutMs, retries, names = () => [] }) {
    Object.assign(this, settingsOf(env)); this.names = names;
    this.env = env; this.dataDir = dataDir; this.sessionId = sessionId; this.log = log; this.fetchImpl = fetchImpl; this.now = now; this.onTrigger = onTrigger;
    this.timeoutMs = timeoutMs; this.retries = retries;
    this.stats = { calls: 0, hits: 0, failures: 0, triggers: 0, merged: 0 };
    this.marks = []; this.lastTriggerAt = 0; this.pendingTimer = null; this.deferred = false; this.closed = false;
  }
  // 一句最终转写。idx = 它在 transcript 里的下标；prev = 前两句原文。异步，调用方不 await。
  async onFinal(row, idx, prev) {
    if (!this.active || this.closed) return null;
    this.stats.calls++;
    const r = !this.enabled ? localJudge(row.text, (() => { try { return this.names() || []; } catch (e) { return []; } })()) : await judge({ env: this.env, prev, text: row.text, fetchImpl: this.fetchImpl, dataDir: this.dataDir, sessionId: this.sessionId, log: this.log,
      ...(this.timeoutMs ? { timeoutMs: this.timeoutMs } : {}), ...(this.retries !== undefined ? { retries: this.retries } : {}) });
    if (this.closed) return r;
    if (r.error) this.stats.failures++;
    if (r.hit) { this.stats.hits++; this.marks.push({ idx, at: row.at, kind: r.kind, text: row.text, noul: r.noul }); this.requestTrigger(); }
    return r;
  }
  // 想触发一次分诊：距上次触发 ≥ 间隔就立刻；否则挂一个到点触发的定时器，期间再多的命中都并进它。
  requestTrigger() {
    if (this.closed) return;
    const now = this.now(); const since = now - this.lastTriggerAt;
    if (since >= this.minGapMs) return this.fire();
    this.stats.merged++;
    if (!this.pendingTimer) { this.pendingTimer = setTimeout(() => { this.pendingTimer = null; this.fire(); }, this.minGapMs - since); if (this.pendingTimer.unref) this.pendingTimer.unref(); }
  }
  fire() { if (this.closed) return; this.lastTriggerAt = this.now(); this.stats.triggers++; try { this.onTrigger(); } catch (e) { this.log('jev 触发分诊出错 ' + (e && e.message)); } }
  // 分诊正在跑时的命中：记一下，等这轮结束再按间隔补一次。
  deferWhileBusy() { this.deferred = true; }
  takeDeferred() { const d = this.deferred; this.deferred = false; return d; }
  // 喂给分诊的【门卫标记】块：只给这轮覆盖到的句子（下标 < endIndex）。
  marksBlock(endIndex) {
    const rows = this.marks.filter(m => m.idx < endIndex);
    if (!rows.length) return '';
    return '\n\n【门卫标记】（逐句门卫判为值得记录的句子，优先看这些）\n' + rows.map(m => `[${m.at}s] ${m.kind}：${m.text}`).join('\n');
  }
  consume(endIndex) { this.marks = this.marks.filter(m => m.idx >= endIndex); }
  snapshot() { return { enabled: this.enabled, local: this.local, available: this.available, threshold: this.threshold, minGapMs: this.minGapMs, ...this.stats }; }
  close() { this.closed = true; if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; } }
}

module.exports = { Gate, judge, localJudge, settingsOf, buildState, parseAnswer, QUESTIONS, JEV_URL, MODEL, KINDS };
