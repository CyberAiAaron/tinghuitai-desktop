'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SOURCES = new Set(['photo', 'upload', 'representative-frame']);
const STATUSES = new Set(['uploaded', 'analyzing', 'ready', 'failed']);
const safeMeeting = id => String(id || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
const safeName = name => {
  const value = String(name || '');
  if (!value || /[\/\\]|\.\./.test(value)) throw new Error('文件名不合法');
  return value;
};

function root(dataDir) { return process.env.THT_ASSET_DIR || path.join(dataDir, '补充材料'); }
function dir(dataDir, meetingId) { return path.join(root(dataDir), safeMeeting(meetingId)); }
function manifest(dataDir, meetingId) { return path.join(dir(dataDir, meetingId), '.events.json'); }
function read(dataDir, meetingId) {
  try {
    const data = JSON.parse(fs.readFileSync(manifest(dataDir, meetingId), 'utf8'));
    return Array.isArray(data.events) ? data.events : [];
  } catch (e) { return []; }
}
function write(dataDir, meetingId, events) {
  const d = dir(dataDir, meetingId); fs.mkdirSync(d, { recursive: true });
  const file = manifest(dataDir, meetingId), tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify({ v: 1, events }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function normalizeSource(v) { return SOURCES.has(v) ? v : 'upload'; }
function normalizeStatus(v) { return STATUSES.has(v) ? v : 'uploaded'; }
function list(dataDir, meetingId) {
  const events = read(dataDir, meetingId), byName = new Map(events.map(x => [x.name, x]));
  let names = [];
  try { names = fs.readdirSync(dir(dataDir, meetingId)).filter(n => !n.startsWith('.')); } catch (e) {}
  return names.sort().map(name => {
    const st = fs.statSync(path.join(dir(dataDir, meetingId), name));
    return { ...(byName.get(name) || {}), id: (byName.get(name) || {}).id || name,
      meetingId: String(meetingId), name, size: st.size, at: Math.round(st.mtimeMs),
      source: normalizeSource((byName.get(name) || {}).source), status: normalizeStatus((byName.get(name) || {}).status),
      capturedAt: (byName.get(name) || {}).capturedAt || new Date(st.mtimeMs).toISOString(),
      provider: (byName.get(name) || {}).provider || '', error: (byName.get(name) || {}).error || '' };
  });
}
function create(dataDir, meetingId, input) {
  const name = safeName(input.name), now = new Date().toISOString();
  const event = { id: crypto.randomUUID(), meetingId: String(meetingId), name,
    source: normalizeSource(input.source), capturedAt: input.capturedAt ? new Date(input.capturedAt).toISOString() : now,
    receivedAt: now, status: 'uploaded', provider: '', error: '', mime: String(input.mime || ''), size: Number(input.size) || 0 };
  const events = read(dataDir, meetingId).filter(x => x.name !== name); events.push(event); write(dataDir, meetingId, events);
  return event;
}
function update(dataDir, meetingId, idOrName, patch) {
  const events = read(dataDir, meetingId); const i = events.findIndex(x => x.id === idOrName || x.name === idOrName);
  if (i < 0) return null;
  const next = { ...events[i] };
  if (patch.status != null) next.status = normalizeStatus(patch.status);
  if (patch.provider != null) next.provider = String(patch.provider).slice(0, 120);
  if (patch.error != null) next.error = String(patch.error).slice(0, 1000);
  if (patch.analysis != null) next.analysis = String(patch.analysis).slice(0, 4000);
  next.updatedAt = new Date().toISOString(); events[i] = next; write(dataDir, meetingId, events); return next;
}
function remove(dataDir, meetingId, idOrName) {
  const events = read(dataDir, meetingId); const hit = events.find(x => x.id === idOrName || x.name === idOrName);
  const name = hit ? hit.name : safeName(idOrName), file = path.join(dir(dataDir, meetingId), name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  write(dataDir, meetingId, events.filter(x => x !== hit && x.name !== name)); return !!hit;
}
function context(dataDir, meetingId, limit = 4, names = []) {
  const wanted = new Set((Array.isArray(names) ? names : []).map(String));
  let items = list(dataDir, meetingId).filter(x => /\.(png|jpe?g|webp|gif|heic)$/i.test(x.name));
  if (wanted.size) items = items.filter(x => wanted.has(x.name));
  items = items.slice(-limit);
  const text = items.map(x => `[${x.source}] ${x.name} | capturedAt=${x.capturedAt} | status=${x.status}${x.analysis ? ' | analysis=' + x.analysis : ''}`).join('\n');
  let st = null; try { st = fs.statSync(manifest(dataDir, meetingId)); } catch (e) {}
  return { text, images: items.map(x => ({ id: x.id, path: path.join(dir(dataDir, meetingId), x.name), mime: x.mime || '' })),
    part: { key: 'visual-events', title: '本场照片事件', source: manifest(dataDir, meetingId), chars: text.length,
      version: st ? String(Math.round(st.mtimeMs)) : 'missing', syncedAt: st ? st.mtime.toISOString() : '', missing: !items.length } };
}

module.exports = { SOURCES, STATUSES, root, dir, manifest, list, create, update, remove, context };
