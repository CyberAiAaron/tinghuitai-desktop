'use strict';

// Context 来源的 HTTP 薄层：注册表仍由 context-sources.js 管，这里只负责鉴权后的
// CRUD、可读的本机状态，以及将文件系统异常压成不带路径的稳定错误。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const registry = require('./context-sources');

const clean = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const apiPath = pathname => String(pathname || '').replace(/^\/asr-relay/, '') === '/context-sources';
const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
const absolute = value => path.resolve(clean(value, 4000).replace(/^~(?=\/)/, os.homedir()));

function statusOf(source) {
  try {
    const stat = fs.statSync(absolute(source.path));
    const actual = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
    return {
      state: actual === source.type ? 'ready' : 'type-mismatch',
      available: actual === source.type,
      kind: actual,
      modifiedAt: stat.mtime.toISOString(),
      version: `${Math.trunc(stat.mtimeMs)}-${stat.size}`,
    };
  } catch (error) {
    return { state: error && error.code === 'ENOENT' ? 'missing' : 'unreadable', available: false, kind: source.type, modifiedAt: '', version: '' };
  }
}

function publicRegistry(dataDir) {
  const current = registry.load(dataDir);
  if (current.error) throw new Error('registry-unavailable');
  return { version: current.version, sources: current.sources.map(source => ({ ...source, status: statusOf(source) })) };
}

function generatedId(source) {
  const stem = clean(source.title || path.basename(clean(source.path, 4000)) || 'source', 48)
    .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
  return `${stem.slice(0, 48)}-${crypto.randomBytes(3).toString('hex')}`;
}

async function route(req, res, url, { authed, dataDir, log = () => {} }) {
  if (!apiPath(url && url.pathname)) return false;
  if (!authed) { json(res, 401, { ok: false, error: '请连接 Mac' }); return true; }
  if (req.method === 'GET') {
    try { json(res, 200, { ok: true, ...publicRegistry(dataDir) }); }
    catch (error) { log(`context sources read failed: ${error && error.message}`); json(res, 500, { ok: false, error: '本机来源暂时读不了' }); }
    return true;
  }
  if (req.method !== 'POST') { json(res, 405, { ok: false, error: '不支持这个操作' }); return true; }

  let raw = '';
  try {
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 32 * 1024) throw new Error('too-large');
    }
  } catch (error) { json(res, 413, { ok: false, error: '请求过长' }); return true; }
  let body;
  try { body = JSON.parse(raw || '{}'); }
  catch (error) { json(res, 400, { ok: false, error: '格式不对' }); return true; }

  try {
    const action = clean(body.action, 20);
    if (action === 'upsert') {
      const source = { ...(body.source || {}) };
      if (!source.id) source.id = generatedId(source);
      registry.upsert(dataDir, source);
    } else if (action === 'toggle') {
      const current = registry.load(dataDir);
      if (current.error) throw new Error('registry-unavailable');
      const found = current.sources.find(item => item.id === clean(body.id, 80));
      if (!found) { json(res, 404, { ok: false, error: '没找到这个来源' }); return true; }
      registry.upsert(dataDir, { ...found, enabled: body.enabled !== false });
    } else if (action === 'delete') {
      if (!registry.remove(dataDir, clean(body.id, 80))) { json(res, 404, { ok: false, error: '没找到这个来源' }); return true; }
    } else { json(res, 400, { ok: false, error: '操作不对' }); return true; }
    json(res, 200, { ok: true, ...publicRegistry(dataDir) });
  } catch (error) {
    log(`context sources write failed: ${error && error.message}`);
    const invalid = /\bid\b|\btype\b|\bpath\b|缺少合法/.test(String(error && error.message));
    json(res, invalid ? 400 : 500, { ok: false, error: invalid ? '请检查来源名称、类型和路径' : '本机来源暂时保存不了' });
  }
  return true;
}

module.exports = { route, publicRegistry, statusOf };
