'use strict';
// 门卫（Jev）：会中每一句最终转写到达就问一次 TypeSafe System One「这句值不值得记、是哪类」，
// 命中才立刻叫大模型分诊，定时器退为兜底。它不生成文字、不进 prompt 正文，所以不走 app/llm.js 的 ask；
// 用量仍记进同一本账（provider 'jev'）。主动智能需求单 §4 F1 / §5.1（Aaron 2026-09-22 拍板，上云链路已确认）。
//
// 硬规矩：
//   · 失败 = 未命中：超时 3 秒、重试 1 次，仍失败只记 failures，不阻塞转写、不抛。
//   · 状态 = 前两句 + 当前句；两道题 worth（noul）/ kind（choice）。
//   · 命中 = noul ≥ JEV_THRESHOLD（默认 0.5）且 kind ≠ none。
//   · 两次触发最少间隔 JEV_MIN_GAP_MS（默认 25000，回放实测 25s 窗口≈90 次 Sonnet/38 分钟，与需求单口径一致）；间隔内的命中合并成一次延后触发。
//   · JEV_GATE 不是 on、或没有 JEV_API_KEY：一次都不调，行为与没有这个模块完全一样。
//   · 接口地址写死；只有测试进程（THT_TEST）能用 THT_JEV_URL 指到本机假服务。
const { recordUsage } = require('./llm');

const JEV_URL = (process.env.THT_TEST && process.env.THT_JEV_URL) || 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const DEFAULT_THRESHOLD = 0.5, DEFAULT_MIN_GAP_MS = 25000, TIMEOUT_MS = 3000, RETRIES = 1;
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
  const on = String(env.JEV_GATE || '').trim().toLowerCase() === 'on';
  let threshold = Number(env.JEV_THRESHOLD); if (!(threshold > 0 && threshold <= 1)) threshold = DEFAULT_THRESHOLD;
  let minGapMs = Number(env.JEV_MIN_GAP_MS); if (!(minGapMs >= 0)) minGapMs = DEFAULT_MIN_GAP_MS;
  return { apiKey, available: !!apiKey, enabled: on && !!apiKey, requested: on, threshold, minGapMs };
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
  constructor({ env, dataDir, sessionId, log = () => {}, fetchImpl, now = Date.now, onTrigger = () => {}, timeoutMs, retries }) {
    Object.assign(this, settingsOf(env));
    this.env = env; this.dataDir = dataDir; this.sessionId = sessionId; this.log = log; this.fetchImpl = fetchImpl; this.now = now; this.onTrigger = onTrigger;
    this.timeoutMs = timeoutMs; this.retries = retries;
    this.stats = { calls: 0, hits: 0, failures: 0, triggers: 0, merged: 0 };
    this.marks = []; this.lastTriggerAt = 0; this.pendingTimer = null; this.deferred = false; this.closed = false;
  }
  // 一句最终转写。idx = 它在 transcript 里的下标；prev = 前两句原文。异步，调用方不 await。
  async onFinal(row, idx, prev) {
    if (!this.enabled || this.closed) return null;
    this.stats.calls++;
    const r = await judge({ env: this.env, prev, text: row.text, fetchImpl: this.fetchImpl, dataDir: this.dataDir, sessionId: this.sessionId, log: this.log,
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
  snapshot() { return { enabled: this.enabled, available: this.available, threshold: this.threshold, minGapMs: this.minGapMs, ...this.stats }; }
  close() { this.closed = true; if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; } }
}

module.exports = { Gate, judge, settingsOf, buildState, parseAnswer, QUESTIONS, JEV_URL, MODEL, KINDS };
