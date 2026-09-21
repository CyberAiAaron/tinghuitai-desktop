'use strict';
// 模型适配层（THT-R8）：业务代码只调 ask()，不认品牌。差异只在这两类适配器里——
//   cli    本机已登录的命令行（claude / codex），走 cli-llm.js
//   openai 任何 OpenAI 兼容的 HTTP 接口（DeepSeek、通义、Kimi……），换一家只改配置
// 降级链 = settings 里的 LLM_CHAIN（数组，按顺序试）。例：
//   [{"type":"cli","kind":"claude","models":{"live":"sonnet","post":"opus"}},
//    {"type":"openai","name":"通义","baseUrl":"https://dashscope.aliyuncs.com/compatible-mode/v1","keyFrom":"QWEN_API_KEY","models":{"live":"qwen-turbo","post":"qwen-max"}}]
// 没配 LLM_CHAIN 就从老的几项设置推出来，行为和以前一样。密钥只从 settings 读（keyFrom 指字段名），不进代码。
// 返回 { text, provider, model, usage, errorCode, degraded, degradedReason, attempts }。
// 链上前面的没成、后面某家成了 → degraded=true；调用方必须让人看见，不能当成首选成功。
const cliLlm = require('./cli-llm');

const hostLabel = url => { try { const h = new URL(url).hostname.split('.'); return h.length > 1 ? h[h.length - 2] : h[0]; } catch (e) { return 'API'; } };

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
    return { type: 'openai', baseUrl: String(p.baseUrl).replace(/\/$/, ''), key, label: p.name || hostLabel(p.baseUrl), usageProvider: 'api', models };
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
  async cli(p, { model, system, user, dataDir, log }) {
    const r = await cliLlm.askDetailed(p.kind, user, { dataDir, log, model, system });
    if (r.ok) return { ok: true, text: r.text, model: r.model || model, usage: r.usage || null };
    return { ok: false, errorCode: p.kind + ':' + (r.reason || 'unknown') };
  },
  async openai(p, { model, system, user, maxTokens, fetchImpl }) {
    try {
      const r = await (fetchImpl || fetch)(p.baseUrl + '/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + p.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens || 800, temperature: 0.2, stream: false }), signal: AbortSignal.timeout(90000) });
      const d = await r.json();
      const text = (((d.choices || [])[0] || {}).message || {}).content || null;
      if (!text) return { ok: false, errorCode: 'api:' + ((d && d.error && (d.error.code || d.error.type || d.error.message)) || 'empty') };
      const u = d.usage;
      return { ok: true, text, model: d.model || model, usage: u ? { in: u.prompt_tokens || 0, out: u.completion_tokens || 0 } : null };
    } catch (e) { return { ok: false, errorCode: 'api:' + String(e.message || 'error').slice(0, 60) }; }
  },
};

// noFallback：这一次只许走链上第一家（Aaron 这台是本机已登录的 Claude 命令行），不许降到第二家。
// 给那些要把团队名单、项目文件、事实源原文塞进 prompt 的调用用——第一家是他自己选定的那一家，
// 这些内容不能因为一次失败就悄悄发给另一家厂商。第一家不成就直接失败，调用方按「这次没生成出来」显示。
async function ask(env, { kind = 'post', system = '', user = '', maxTokens, dataDir, log = () => {}, fetchImpl, noFallback = false } = {}) {
  const chain = noFallback ? chainOf(env).slice(0, 1) : chainOf(env), attempts = [];
  if (!chain.length) return { text: null, errorCode: 'no_provider', degraded: false, attempts };
  for (const p of chain) {
    const model = pickModel(p, kind);
    const r = await ADAPTERS[p.type](p, { model, system, user, maxTokens, dataDir, log, fetchImpl });
    if (r.ok) return { text: r.text, provider: p.label, usageProvider: p.usageProvider, model: r.model || model, usage: r.usage,
      degraded: attempts.length > 0, degradedReason: attempts.length ? attempts[0].errorCode : '', attempts };
    attempts.push({ provider: p.label, errorCode: r.errorCode });
    log(p.label + ' 没回应（' + r.errorCode + '）' + (p === chain[chain.length - 1] ? '，降级链已试完' : '，试下一家'));
  }
  return { text: null, errorCode: attempts[attempts.length - 1].errorCode, degraded: false, attempts };
}

module.exports = { ask, chainOf, pickModel };
