'use strict';
// Notion 读类工具。按官方 API 实现：POST /v1/search、GET /v1/blocks/{id}/children，都要 Notion-Version 头。
// 设置项 NOTION_TOKEN 有值才可用；没有就在清单里照样列出来，reason 写明缺什么。
// ⚠️ 2026-09-22 交付时只用假服务端测过，没连过真的 Notion（本机设置里没有 NOTION_TOKEN）。
const reg = require('./index');

const API = 'https://api.notion.com/v1/';
const VERSION = '2022-06-28';
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const tokenOf = env => String((env || {}).NOTION_TOKEN || '').trim();

// Notion 的文字都摊在 rich_text 数组里，标题还分 title / Name 两种属性名，统一在这里抽。
function plain(rich) { return (Array.isArray(rich) ? rich : []).map(x => String((x && x.plain_text) || '')).join(''); }
function titleOf(page) {
  const props = (page && page.properties) || {};
  for (const v of Object.values(props)) if (v && v.type === 'title') return plain(v.title);
  if (page && page.title) return plain(page.title);
  return '';
}
function blockText(b) {
  const t = b && b.type;
  const body = t && b[t];
  if (!body) return '';
  if (Array.isArray(body.rich_text)) return plain(body.rich_text);
  if (typeof body.title === 'string') return body.title;
  return '';
}
async function api(ctx, method, endpoint, body) {
  const token = tokenOf(ctx.env);
  if (!token) return { ok: false, error: '设置里没有 NOTION_TOKEN' };
  const f = ctx.fetchImpl || globalThis.fetch;
  if (typeof f !== 'function') return { ok: false, error: '这个 Node 没有 fetch' };
  try {
    const r = await f((ctx.notionBase || API) + endpoint, {
      method, headers: { Authorization: 'Bearer ' + token, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    });
    const j = await r.json();
    if (j && j.object === 'error') return { ok: false, error: 'Notion 拒绝了：' + clip(j.message || j.code || '', 120) };
    return { ok: true, json: j };
  } catch (e) { return { ok: false, error: 'Notion 连不上：' + clip(e.message, 100) }; }
}
const unavailable = env => (tokenOf(env) ? { ok: true } : { ok: false, reason: '未接：设置里没有 NOTION_TOKEN（填了就自动可用）' });

reg.register({
  name: 'notion.search', title: '搜 Notion', level: 'read', source: 'notion',
  description: '搜这份 Notion 授权能看到的页面和数据库，返回标题、id 和链接。要正文用 notion.fetch。',
  input: { type: 'object', required: ['query'], properties: {
    query: { type: 'string', minLength: 1, maxLength: 200 },
    limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
  } },
  available: unavailable,
  async run(args, ctx) {
    const r = await api(ctx, 'POST', 'search', { query: args.query, page_size: Math.min(20, args.limit || 8) });
    if (!r.ok) return r;
    const results = ((r.json || {}).results) || [];
    return { ok: true, items: results.slice(0, args.limit).map(p => ({
      title: clip(titleOf(p) || '（无标题）', 200), text: clip(titleOf(p), 200),
      objectType: p.object || '', id: p.id || '', url: p.url || '',
      ref: 'notion:' + (p.id || ''), source: 'notion:search', at: p.last_edited_time || p.created_time || '',
    })) };
  },
});

reg.register({
  name: 'notion.fetch', title: '取 Notion 页面内容', level: 'read', source: 'notion',
  description: '按页面 id 取它下面一层的块内容（纯文字）。id 从 notion.search 的结果里拿。',
  input: { type: 'object', required: ['id'], properties: {
    id: { type: 'string', minLength: 8, maxLength: 80, description: '页面或块 id' },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  } },
  available: unavailable,
  async run(args, ctx) {
    const id = String(args.id).trim();
    if (!/^[0-9a-fA-F-]{8,80}$/.test(id)) return { ok: false, error: 'id 不像 Notion 的页面 id' };
    const r = await api(ctx, 'GET', 'blocks/' + encodeURIComponent(id) + '/children?page_size=' + Math.min(100, args.limit || 50));
    if (!r.ok) return r;
    const blocks = ((r.json || {}).results) || [];
    const lines = blocks.map(b => blockText(b)).filter(Boolean);
    if (!lines.length) return { ok: false, error: '这一页没读到文字内容（可能是数据库页，或授权没分享到这一页）' };
    return { ok: true, data: { text: clip(lines.join('\n'), 6000), blocks: blocks.length,
      ref: 'notion:' + id, source: 'notion:blocks', at: (blocks[0] || {}).last_edited_time || '' } };
  },
});

module.exports = { plain, titleOf, blockText };
