'use strict';
// 模型适配层（THT-R8）：业务代码只调 ask()，不认品牌。差异只在这两类适配器里——
//   cli    本机已登录的命令行（claude / codex），走 cli-llm.js
//   openai 任何 OpenAI 兼容的 HTTP 接口（DeepSeek、通义、Kimi……），换一家只改配置
// 降级链 = settings 里的 LLM_CHAIN（数组，按顺序试）。例：
//   [{"type":"cli","kind":"claude","models":{"live":"sonnet","post":"opus"}},
//    {"type":"openai","name":"通义","baseUrl":"https://dashscope.aliyuncs.com/compatible-mode/v1","keyFrom":"QWEN_API_KEY","models":{"live":"qwen-turbo","post":"qwen-max"}}]
// 没配 LLM_CHAIN 就从老的几项设置推出来，行为和以前一样。密钥只从 settings 读（keyFrom 指字段名），不进代码。
// 返回 { text, provider, model, usage, errorCode, degraded, degradedReason, attempts, truncated, truncatedChars }。
// truncated：这一次的 user 有没有因为超过接口上限被截掉（截了多少字在 truncatedChars）。
// 链上前面的没成、后面某家成了 → degraded=true；调用方必须让人看见，不能当成首选成功。
// 会后那条路是 Python 写的，它不自己调模型，而是起 app/llm-cli.js 进到这里——全仓只有这一层认厂商。
const fs = require('fs');
const path = require('path');
const cliLlm = require('./cli-llm');

const hostLabel = url => { try { const h = new URL(url).hostname.split('.'); return h.length > 1 ? h[h.length - 2] : h[0]; } catch (e) { return 'API'; } };

// 接口类厂商的输入上限：一次调用塞不下一场两小时的逐字稿，超了先截。
// 本机命令行没有这道墙（它自己按上下文窗口处理），所以只截接口这条路。原来这道截断写在 Python 里（user[:48000]），
// 放在这里才是对的——换成上下文更大的一家，改 provider 的 maxInput 就行，不用动业务代码。
const API_INPUT_CAP = 48000;
const CLI_TIMEOUT_MS = 180000;   // 命令行默认等 3 分钟
const API_TIMEOUT_MS = 90000;    // HTTP 接口默认等 90 秒

function normalize(p, env) {
  if (!p || typeof p !== 'object') return null;
  const models = p.models && typeof p.models === 'object' ? p.models : {};
  if (p.type === 'cli') {
    if (!['claude', 'codex'].includes(p.kind)) return null;
    return { type: 'cli', kind: p.kind, label: p.name || p.kind[0].toUpperCase() + p.kind.slice(1), usageProvider: p.kind, models };
  }
  if (p.type === 'openai') {
    const key = p.keyFrom ? env[p.keyFrom] : p.key;
    if (!key || !p.baseUrl) return null;
    return { type: 'openai', baseUrl: String(p.baseUrl).replace(/\/$/, ''), key, label: p.name || hostLabel(p.baseUrl), usageProvider: 'api',
      maxInput: Number(p.maxInput) > 0 ? Number(p.maxInput) : API_INPUT_CAP, models };
  }
  return null;
}

// 老设置 → 降级链。只有这里认得老字段名；「DeepSeek」这个显示名也只在这里出现。
function legacyChain(env) {
  const chain = [];
  if (env.LLM_PROVIDER === 'claude' || env.LLM_PROVIDER === 'codex')
    chain.push({ type: 'cli', kind: env.LLM_PROVIDER, models: env.LLM_PROVIDER === 'claude' ? { live: env.LLM_MODEL_LIVE || 'sonnet', post: env.LLM_MODEL_POST || 'opus' } : {} });
  if (env.DEEPSEEK_API_KEY)
    chain.push({ type: 'openai', name: /deepseek/i.test(env.LLM_BASE_URL || '') ? 'DeepSeek' : (env.LLM_MODEL || 'AI'), baseUrl: env.LLM_BASE_URL, keyFrom: 'DEEPSEEK_API_KEY', models: { live: env.LLM_MODEL_QUICK || env.LLM_MODEL, post: env.LLM_MODEL } });
  return chain;
}
function chainOf(env) {
  const raw = Array.isArray(env.LLM_CHAIN) && env.LLM_CHAIN.length ? env.LLM_CHAIN : legacyChain(env);
  return raw.map(p => normalize(p, env)).filter(Boolean);
}
// kind：live（会中实时）/ triage（会中分诊，同 live 档）/ post（会后慢思考）。老调用传的 quick 等同 live。
function pickModel(p, kind) {
  const m = p.models || {};
  if (kind === 'live' || kind === 'quick' || kind === 'triage') return m[kind] || m.live || m.post || '';
  return m.post || m.live || '';
}

const ADAPTERS = {
  async cli(p, { model, system, user, dataDir, log, timeoutMs }) {
    // 本机命令行没有这道墙（它自己按上下文窗口处理），所以这条路永远 truncated:false
    const r = await cliLlm.askDetailed(p.kind, user, { dataDir, log, model, system, timeoutMs: timeoutMs || CLI_TIMEOUT_MS });
    if (r.ok) return { ok: true, text: r.text, model: r.model || model, usage: r.usage || null, truncated: false, truncatedChars: 0 };
    return { ok: false, errorCode: p.kind + ':' + (r.reason || 'unknown'), truncated: false, truncatedChars: 0 };
  },
  async openai(p, { model, system, user, maxTokens, temperature, timeoutMs, fetchImpl }) {
    // 超长就截，但不能悄悄截：截了多少字要顺着返回值一路带到用量账里，
    // 不然「模型没看到后半场」会被当成模型变笨，查不出是这里剪掉的（2026-09-22 架构审查查出）。
    const whole = String(user), cap = p.maxInput || API_INPUT_CAP;
    const sent = whole.slice(0, cap), cutChars = whole.length - sent.length;
    try {
      const r = await (fetchImpl || fetch)(p.baseUrl + '/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + p.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: sent }],
          max_tokens: maxTokens || 800, temperature: temperature == null ? 0.2 : temperature, stream: false }),
        signal: AbortSignal.timeout(timeoutMs || API_TIMEOUT_MS) });
      const d = await r.json();
      const text = (((d.choices || [])[0] || {}).message || {}).content || null;
      if (!text) return { ok: false, errorCode: 'api:' + ((d && d.error && (d.error.code || d.error.type || d.error.message)) || 'empty'), truncated: cutChars > 0, truncatedChars: cutChars };
      const u = d.usage;
      return { ok: true, text, model: d.model || model, usage: u ? { in: u.prompt_tokens || 0, out: u.completion_tokens || 0 } : null,
        truncated: cutChars > 0, truncatedChars: cutChars };
    } catch (e) { return { ok: false, errorCode: 'api:' + String(e.message || 'error').slice(0, 60), truncated: cutChars > 0, truncatedChars: cutChars }; }
  },
};

// noFallback：这一次只许走链上第一家（Aaron 这台是本机已登录的 Claude 命令行），不许降到第二家。
// 给那些要把团队名单、项目文件、事实源原文塞进 prompt 的调用用——第一家是他自己选定的那一家，
// 这些内容不能因为一次失败就悄悄发给另一家厂商。第一家不成就直接失败，调用方按「这次没生成出来」显示。
// skip：跳过链上前 N 家，给「这一趟已经试过它、别再逐块重试」的熔断用（会后总结把一场会切成十几块，
// 第一家挂了还每块都等一遍，能白等几十分钟）。跳过也算降级，degraded 照样为真。
// timeoutMs：每一家的等待上限（不是整条链的总预算）。不给就按适配器各自的默认值。
async function ask(env, { kind = 'post', system = '', user = '', maxTokens, dataDir, log = () => {}, fetchImpl,
  noFallback = false, skip = 0, timeoutMs = 0, temperature } = {}) {
  const all = chainOf(env);
  if (!all.length) return { text: null, errorCode: 'no_provider', degraded: false, truncated: false, truncatedChars: 0, attempts: [] };
  const skipped = noFallback ? 0 : Math.max(0, Number(skip) || 0);
  const chain = noFallback ? all.slice(0, 1) : all.slice(skipped), attempts = [];
  if (!chain.length) return { text: null, errorCode: 'chain_exhausted', degraded: false, truncated: false, truncatedChars: 0, attempts, skipped };
  for (const p of chain) {
    const model = pickModel(p, kind);
    const r = await ADAPTERS[p.type](p, { model, system, user, maxTokens, dataDir, log, fetchImpl, timeoutMs, temperature });
    if (r.ok) return { text: r.text, provider: p.label, usageProvider: p.usageProvider, model: r.model || model, usage: r.usage,
      truncated: !!r.truncated, truncatedChars: Number(r.truncatedChars) || 0,
      degraded: attempts.length > 0 || skipped > 0, degradedReason: attempts.length ? attempts[0].errorCode : (skipped > 0 ? 'skipped' : ''), attempts, skipped };
    attempts.push({ provider: p.label, errorCode: r.errorCode });
    log(p.label + ' 没回应（' + r.errorCode + '）' + (p === chain[chain.length - 1] ? '，降级链已试完' : '，试下一家'));
  }
  return { text: null, errorCode: attempts[attempts.length - 1].errorCode, degraded: false, truncated: false, truncatedChars: 0, attempts, skipped };
}

// —— 用量账本 ——
// 花 token 的地方在花费那一刻记一笔，成本只从这本账汇总。服务端（app/server.js）和会后管线
// （Python → app/llm-cli.js）写的是同一个文件、同一种行，口径不能各写各的。
function recordUsage(dataDir, entry) {
  try {
    const f = path.join(dataDir, 'state', 'usage.jsonl');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, JSON.stringify({ ts: Date.now(), ...entry }) + '\n');
  } catch (e) {}
}
// API 有精确 usage；本机命令行有时拿不到，按字符数估（中文约 2 字符/token），标 est:true，不冒充精确。
// HTTP 接口连 usage 都没回就不记——估一个假的会污染账本。
// pack：这次调用递进去的那份本机资料（app/context-pack.js 的 build 结果）。
// 账上每行记下 contextHash 和 contextParts（只留 key 和版本号），以后才回答得了
// 「那天那场的整理，用的是哪一版总纲」。没带资料的调用这两列是空的，不是漏记。
function noteUsage(dataDir, r, { system = '', user = '', tier = 'post', sessionId = '', purpose = '', pack = null } = {}) {
  if (!dataDir || !r || !r.text) return;
  const u = r.usage;
  if (!u && r.usageProvider === 'api') return;
  const ctx = pack ? require('./context-pack').stamp(pack) : { contextHash: '', contextParts: [] };
  recordUsage(dataDir, { sessionId, provider: r.usageProvider, model: r.model || '',
    in: u ? u.in : Math.ceil((String(system).length + String(user).length) / 2), out: u ? u.out : Math.ceil(r.text.length / 2),
    est: !u, tier, purpose, ...ctx,
    ...(r.truncated ? { truncated: true, truncatedChars: Number(r.truncatedChars) || 0 } : { truncated: false }) });
}

module.exports = { ask, chainOf, pickModel, recordUsage, noteUsage };
