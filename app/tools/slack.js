'use strict';
// Slack 读类工具。只用本机设置里已有的用户授权（xoxp-），而且必须带 search:read——
// 机器人口令（xoxb-）没有搜索权限，拿它去搜只会拿到 missing_scope。
// 权限用 auth.test 的响应头 x-oauth-scopes 判断（Slack 只在响应头里给这份清单）。口令一个字都不打印。
const reg = require('./index');

const API = 'https://slack.com/api/';
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const SCOPES = new Map();   // token 指纹 → { scopes:Set, team, at }
const probing = new Set();
const fp = t => 'slack:' + String(t || '').length + ':' + String(t || '').slice(-6);

async function probe(token, fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  if (typeof f !== 'function') return { ok: false, error: '这个 Node 没有 fetch' };
  try {
    const r = await f(API + 'auth.test', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/x-www-form-urlencoded' }, body: '', signal: AbortSignal.timeout(15000) });
    const head = String((r.headers && r.headers.get && r.headers.get('x-oauth-scopes')) || '');
    const j = await r.json();
    if (!j || !j.ok) return { ok: false, error: 'Slack 拒绝了这份授权：' + clip((j && j.error) || 'auth_failed', 60) };
    const scopes = new Set(head.split(',').map(x => x.trim()).filter(Boolean));
    SCOPES.set(fp(token), { scopes, team: j.team || '', at: Date.now() });
    return { ok: true, scopes };
  } catch (e) { return { ok: false, error: 'Slack 连不上：' + clip(e.message, 100) }; }
}

function tokenOf(env) { return String((env || {}).SLACK_USER_TOKEN || '').trim(); }

reg.register({
  name: 'slack.search', title: '搜 Slack', level: 'read', source: 'slack',
  description: '用你自己的 Slack 授权搜消息（只搜你本来就看得到的频道）。返回频道、发言人、原文和消息链接。',
  input: { type: 'object', required: ['query'], properties: {
    query: { type: 'string', minLength: 1, maxLength: 200, description: '支持 Slack 自己的搜索语法，例如 in:#channel from:@me' },
    limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
  } },
  available(env, ctx) {
    const t = tokenOf(env);
    if (!t) return { ok: false, reason: '未接：设置里没有 Slack 用户授权（xoxp-），搜索需要它带 search:read' };
    const got = SCOPES.get(fp(t));
    if (got) return got.scopes.has('search:read') ? { ok: true }
      : { ok: false, reason: '未接：这份 Slack 用户授权没有 search:read 权限，要重新授权一次' };
    // 还没探过权限：后台探一次，下一次问清单就准了。测试里不发真实请求。
    if (!process.env.THT_TEST && !probing.has(fp(t))) {
      probing.add(fp(t));
      probe(t, (ctx && ctx.fetchImpl)).finally(() => probing.delete(fp(t)));
    }
    return { ok: true, reason: '' };
  },
  async run(args, ctx) {
    const token = tokenOf(ctx.env);
    if (!token) return { ok: false, error: '设置里没有 Slack 用户授权' };
    const f = ctx.fetchImpl || globalThis.fetch;
    if (typeof f !== 'function') return { ok: false, error: '这个 Node 没有 fetch' };
    let known = SCOPES.get(fp(token));
    if (!known) { const p = await probe(token, f); if (!p.ok) return { ok: false, error: p.error }; known = SCOPES.get(fp(token)); }
    if (!known.scopes.has('search:read')) return { ok: false, error: '这份 Slack 用户授权没有 search:read 权限，要重新授权一次' };
    try {
      const body = new URLSearchParams({ query: args.query, count: String(Math.min(20, args.limit || 8)), sort: 'timestamp' });
      const r = await f(API + 'search.messages', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      if (!j || !j.ok) return { ok: false, error: 'Slack 没给结果：' + clip((j && j.error) || 'unknown', 60) };
      const matches = (((j.messages || {}).matches) || []).slice(0, args.limit);
      return { ok: true, items: matches.map(m => ({
        text: clip(m.text, 400), user: m.username || m.user || '',
        channel: ((m.channel || {}).name ? '#' + m.channel.name : (m.channel || {}).id || ''),
        url: m.permalink || '', ref: 'slack:' + ((m.channel || {}).id || '') + ':' + (m.ts || ''),
        source: 'slack:search', at: m.ts ? new Date(Number(String(m.ts).split('.')[0]) * 1000).toISOString() : '',
      })), total: (j.messages || {}).total || matches.length };
    } catch (e) { return { ok: false, error: 'Slack 连不上：' + clip(e.message, 100) }; }
  },
});

module.exports = { probe, SCOPES };
