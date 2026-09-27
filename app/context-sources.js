'use strict';
// 可配置 Context 的本机来源注册表。这里只管理来源身份和归属；真正读取内容、裁剪并送给模型
// 仍然只能由 app/context-pack.js 完成，避免出现第二条资料注入路径。
const fs = require('fs'), path = require('path');

const VERSION = 1;
const TYPES = new Set(['file', 'directory']);
const SCOPES = new Set(['project', 'global']);
const clean = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const fileOf = dataDir => path.join(path.resolve(dataDir), 'state', 'context-sources.json');
const expand = p => path.resolve(clean(p, 4000).replace(/^~(?=\/)/, process.env.HOME || '~'));

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = clean(raw.id, 80);
  const type = TYPES.has(raw.type) ? raw.type : '';
  const sourcePath = clean(raw.path, 4000);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id) || !type || !sourcePath) return null;
  const scope = SCOPES.has(raw.scope) ? raw.scope : 'project';
  const projectId = scope === 'global' ? '' : clean(raw.projectId, 80);
  return {
    id, type, path: sourcePath, projectId, scope,
    enabled: raw.enabled !== false,
    title: clean(raw.title, 160) || path.basename(sourcePath),
    recursive: type === 'directory' ? raw.recursive !== false : false,
  };
}

function load(dataDir) {
  const file = fileOf(dataDir);
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    if (e && e.code === 'ENOENT') return { version: VERSION, sources: [], file, error: '' };
    return { version: VERSION, sources: [], file, error: '来源注册表读不了：' + String(e.message || e).slice(0, 160) };
  }
  const rows = Array.isArray(parsed) ? parsed : parsed && parsed.sources;
  if (!Array.isArray(rows)) return { version: VERSION, sources: [], file, error: '来源注册表格式不对' };
  const seen = new Set(), sources = [];
  for (const raw of rows) {
    const row = normalize(raw);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id); sources.push(row);
  }
  return { version: VERSION, sources, file, error: '' };
}

function save(dataDir, sources) {
  const rows = [], seen = new Set();
  for (const raw of Array.isArray(sources) ? sources : []) {
    const row = normalize(raw);
    if (!row) throw new Error('Context 来源缺少合法的 id、type 或 path');
    if (seen.has(row.id)) throw new Error('Context 来源 id 重复：' + row.id);
    seen.add(row.id); rows.push(row);
  }
  const file = fileOf(dataDir), dir = path.dirname(file), tmp = file + '.tmp-' + process.pid;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(tmp, JSON.stringify({ version: VERSION, sources: rows }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  return { version: VERSION, sources: rows, file, error: '' };
}

function upsert(dataDir, source) {
  const row = normalize(source);
  if (!row) throw new Error('Context 来源缺少合法的 id、type 或 path');
  const current = load(dataDir);
  if (current.error) throw new Error(current.error);
  const next = current.sources.filter(x => x.id !== row.id); next.push(row);
  return save(dataDir, next).sources.find(x => x.id === row.id);
}

function remove(dataDir, id) {
  const current = load(dataDir);
  if (current.error) throw new Error(current.error);
  const target = clean(id, 80), next = current.sources.filter(x => x.id !== target);
  if (next.length === current.sources.length) return false;
  save(dataDir, next); return true;
}

// 只返回本场明确选择、已启用且项目归属匹配的来源。未分类项目不会看到任意具名项目；
// 跨项目来源必须把 scope 明确写成 global。
function select(dataDir, { projectId = '', ids = [] } = {}) {
  const registry = load(dataDir), wanted = new Set((Array.isArray(ids) ? ids : []).map(x => clean(x, 80)).filter(Boolean));
  const project = clean(projectId, 80);
  const sources = registry.sources.filter(x => wanted.has(x.id) && x.enabled && (x.scope === 'global' || x.projectId === project));
  return { ...registry, projectId: project, requestedIds: [...wanted], sources: sources.map(x => ({ ...x, absolutePath: expand(x.path) })) };
}

module.exports = { VERSION, fileOf, load, save, upsert, remove, select, normalize };
