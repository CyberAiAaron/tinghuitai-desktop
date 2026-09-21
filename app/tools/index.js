'use strict';
// 工具权限层（2026-09-22）。
//
// 为什么有这一层：工具只定义一份，由听会台引擎执行，结果以纯文字递给当前那家模型。
// 任何一家模型（Claude 命令行、Codex 命令行、DeepSeek、以后任何 OpenAI 兼容接口）拿到的
// 工具清单和工具结果逐字相同——不依赖任何一家自带的连接器、函数调用方言或记忆。
//
// 三个调用方都从这里过，没有第二条路：
//   ui     界面上人点出来的（只有它能带 confirmedByUser，因此只有它能执行写类工具）
//   model  模型在 tool-loop 里要的（永远只给读类）
//   mcp    本机 MCP 出口转进来的（永远只给读类）
//
// 每条工具定义：
//   { name, title, description, level:'read'|'write', source:'local'|'lark'|'slack'|'notion',
//     input:<JSON Schema>, available(env, ctx)->{ok,reason}, run(args, ctx)->{ok, items|data, error} }
const fs = require('fs'), path = require('path');

const REG = new Map();

const DEFAULT_TIMEOUT = 15000;   // 每个工具默认 15 秒
const MAX_CHARS = 6000;          // 单次结果最多 6000 字，超了截断并标 truncated
const LEVELS = ['read', 'write'];
const SOURCES = ['local', 'lark', 'slack', 'notion'];

function register(def) {
  if (!def || typeof def.name !== 'string' || !/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(def.name))
    throw Error('工具名要形如 meetings.search：' + (def && def.name));
  if (!LEVELS.includes(def.level)) throw Error(def.name + ' 的 level 只能是 read 或 write');
  if (!SOURCES.includes(def.source)) throw Error(def.name + ' 的 source 不认识：' + def.source);
  if (typeof def.run !== 'function') throw Error(def.name + ' 没有 run');
  if (REG.has(def.name)) throw Error('工具重名：' + def.name);
  REG.set(def.name, {
    title: def.name, description: '', input: { type: 'object', properties: {} },
    available: () => ({ ok: true }), ...def,
  });
  return def.name;
}
function get(name) { return REG.get(name) || null; }
function names() { return [...REG.keys()].sort(); }

// 清单：没接上的工具不报错，available 给 {ok:false, reason:'未接：…'}，照样列出来。
function list(env = {}, ctx = {}) {
  return names().map(n => {
    const d = REG.get(n);
    let a;
    try { a = d.available(env, ctx) || { ok: false, reason: '未接：available 没给结果' }; }
    catch (e) { a = { ok: false, reason: '未接：' + String(e.message || e).slice(0, 120) }; }
    return { name: n, title: d.title, description: d.description, level: d.level, source: d.source,
      input: d.input, available: !!a.ok, reason: a.ok ? '' : String(a.reason || '未接').slice(0, 200) };
  });
}

// ===== 轻量 JSON Schema 校验（不加依赖，只认这一层用得到的那几种）=====
function validate(schema, value, where = 'args') {
  const s = schema || {};
  const t = s.type;
  if (value === undefined && s.default !== undefined) value = JSON.parse(JSON.stringify(s.default));
  if (t === 'object') {
    if (value === undefined) value = {};
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: where + ' 要是一个对象' };
    const props = s.properties || {}, out = {};
    for (const k of (s.required || [])) if (value[k] === undefined && (props[k] || {}).default === undefined) return { ok: false, error: where + '.' + k + ' 是必填的' };
    for (const k of Object.keys(value)) if (!props[k]) return { ok: false, error: where + '.' + k + ' 不是这个工具认识的参数' };
    for (const k of Object.keys(props)) {
      const r = validate(props[k], value[k], where + '.' + k);
      if (!r.ok) return r;
      if (r.value !== undefined) out[k] = r.value;
    }
    return { ok: true, value: out };
  }
  if (value === undefined) return { ok: true, value: undefined };
  if (t === 'array') {
    if (!Array.isArray(value)) return { ok: false, error: where + ' 要是一个数组' };
    if (s.maxItems != null && value.length > s.maxItems) return { ok: false, error: where + ' 最多 ' + s.maxItems + ' 项' };
    if (s.minItems != null && value.length < s.minItems) return { ok: false, error: where + ' 至少 ' + s.minItems + ' 项' };
    const out = [];
    for (let i = 0; i < value.length; i++) {
      const r = validate(s.items || {}, value[i], where + '[' + i + ']');
      if (!r.ok) return r;
      out.push(r.value);
    }
    return { ok: true, value: out };
  }
  if (t === 'string') {
    if (typeof value !== 'string') return { ok: false, error: where + ' 要是字符串' };
    if (s.enum && !s.enum.includes(value)) return { ok: false, error: where + ' 只能是：' + s.enum.join(' / ') };
    if (s.minLength != null && value.length < s.minLength) return { ok: false, error: where + ' 太短' };
    if (s.maxLength != null && value.length > s.maxLength) return { ok: false, error: where + ' 太长（最多 ' + s.maxLength + ' 字）' };
    return { ok: true, value };
  }
  if (t === 'integer' || t === 'number') {
    if (typeof value !== 'number' || !isFinite(value) || (t === 'integer' && !Number.isInteger(value)))
      return { ok: false, error: where + ' 要是' + (t === 'integer' ? '整数' : '数字') };
    if (s.minimum != null && value < s.minimum) return { ok: false, error: where + ' 不能小于 ' + s.minimum };
    if (s.maximum != null && value > s.maximum) return { ok: false, error: where + ' 不能大于 ' + s.maximum };
    return { ok: true, value };
  }
  if (t === 'boolean') {
    if (typeof value !== 'boolean') return { ok: false, error: where + ' 要是 true 或 false' };
    return { ok: true, value };
  }
  return { ok: true, value };
}

// ===== 审计 =====
// 每次调用一行。参数只留摘要：像密钥的字段一律不落盘，长文本截到 120 字。
const SECRET = /token|key|secret|password|passwd|cookie|authorization/i;
function argsDigest(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (SECRET.test(k)) { out[k] = '<已隐藏>'; continue; }
    if (typeof v === 'string') out[k] = v.slice(0, 120);
    else if (Array.isArray(v)) out[k] = v.slice(0, 8).map(x => (typeof x === 'string' ? x.slice(0, 60) : x));
    else if (v && typeof v === 'object') out[k] = '<对象>';
    else out[k] = v;
  }
  return out;
}
function auditFile(dataDir) { return path.join(dataDir || '.', 'state', 'tools', 'calls.jsonl'); }
function audit(entry, ctx = {}) {
  const line = JSON.stringify({
    at: new Date().toISOString(), name: entry.name, args: argsDigest(entry.args),
    caller: String(ctx.caller || 'unknown').slice(0, 40), sessionId: String(ctx.sessionId || '').slice(0, 80),
    ok: !!entry.ok, ms: entry.ms || 0,
    ...(entry.error ? { error: String(entry.error).slice(0, 200) } : {}),
    ...(entry.truncated ? { truncated: true } : {}),
  });
  // 没给数据目录就只记日志不落盘：单元测试里直接调工具时别在仓库或临时目录外面留文件。
  if (!ctx.dataDir) { (ctx.log || (() => {}))('工具调用（未落审计，没有数据目录）' + line); return entry; }
  try {
    const f = auditFile(ctx.dataDir);
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    fs.appendFileSync(f, line + '\n', { mode: 0o600 });
  } catch (e) { (ctx.log || (() => {}))('工具审计写不进去 ' + e.message); }
  return entry;
}

// ===== 截断 =====
// 结果太长时先丢后面的条目，只剩一条还超就把它的文本切掉。让模型永远拿到完整的 JSON。
function clipResult(r) {
  if (!r || typeof r !== 'object') return { r, truncated: false };
  const size = x => JSON.stringify(x === undefined ? null : x).length;
  if (typeof r.data === 'string' && r.data.length > MAX_CHARS) return { r: { ...r, data: r.data.slice(0, MAX_CHARS) }, truncated: true };
  if (!Array.isArray(r.items)) return { r, truncated: size(r) > MAX_CHARS };
  let items = r.items.slice();
  let cut = false;
  while (items.length > 1 && size({ ...r, items }) > MAX_CHARS) { items = items.slice(0, items.length - 1); cut = true; }
  if (items.length === 1 && size({ ...r, items }) > MAX_CHARS) {
    const one = { ...items[0] };
    const room = Math.max(200, MAX_CHARS - size({ ...r, items: [{ ...one, text: '' }] }));
    if (typeof one.text === 'string') { one.text = one.text.slice(0, room); items = [one]; cut = true; }
  }
  return { r: { ...r, items }, truncated: cut || items.length !== r.items.length };
}

// ===== 统一入口 =====
// ctx: { env, dataDir, caller, sessionId, confirmedByUser, log, timeoutMs, execImpl, fetchImpl, hub }
async function call(name, args, ctx = {}) {
  const t0 = Date.now();
  const env = ctx.env || {};
  const def = REG.get(name);
  if (!def) { audit({ name, args, ok: false, error: '没有这个工具', ms: 0 }, ctx); return { ok: false, name, error: '没有这个工具：' + String(name).slice(0, 60) }; }

  // 写类门禁：只有界面点击那条路能把 confirmedByUser 设成 true。模型和 MCP 永远进不来。
  if (def.level === 'write' && ctx.confirmedByUser !== true) {
    const e = '写类工具要你在界面上确认过才执行（' + name + '）';
    audit({ name, args, ok: false, error: e, ms: Date.now() - t0 }, ctx);
    return { ok: false, name, error: e };
  }

  const v = validate(def.input, args);
  if (!v.ok) { audit({ name, args, ok: false, error: v.error, ms: Date.now() - t0 }, ctx); return { ok: false, name, error: v.error }; }

  let a;
  try { a = def.available(env, ctx) || { ok: false, reason: '未接' }; }
  catch (e) { a = { ok: false, reason: '未接：' + String(e.message || e).slice(0, 120) }; }
  if (!a.ok) { audit({ name, args, ok: false, error: a.reason, ms: Date.now() - t0 }, ctx); return { ok: false, name, error: String(a.reason).slice(0, 200) }; }

  const ms = Math.max(1000, Number(ctx.timeoutMs) || Number(def.timeoutMs) || DEFAULT_TIMEOUT);
  let timer = null;
  const timeout = new Promise(res => { timer = setTimeout(() => res({ ok: false, error: '工具超时（' + ms + ' 毫秒）：' + name, _timeout: true }), ms); });
  let r;
  try { r = await Promise.race([Promise.resolve(def.run(v.value, { ...ctx, env })), timeout]); }
  catch (e) { r = { ok: false, error: String(e.message || e).slice(0, 200) }; }
  finally { if (timer) clearTimeout(timer); }
  if (!r || typeof r !== 'object') r = { ok: false, error: '工具没有返回结果' };

  const { r: clipped, truncated } = clipResult(r);
  const out = { name, ...clipped, ok: !!clipped.ok, ms: Date.now() - t0, ...(truncated ? { truncated: true } : {}) };
  audit({ name, args, ok: out.ok, error: out.error, ms: out.ms, truncated }, ctx);
  return out;
}

// 模型输出里出现写类工具名、或别处要记一笔「这次调用被丢弃了」时用。不执行任何东西。
function auditRejected(name, args, ctx, why) {
  audit({ name, args, ok: false, error: why || '无效调用，已丢弃', ms: 0 }, ctx);
}

module.exports = { register, get, list, names, call, validate, audit, auditRejected, auditFile,
                   DEFAULT_TIMEOUT, MAX_CHARS };

// 登记表自己不实现工具。下面这几份各管一类来源，加载时把自己登记进来。
// 放在 module.exports 之后：它们会 require('./index')，此时导出已经就位，循环引用不会拿到空对象。
require('./local');
require('./lark');
require('./slack');
require('./notion');
