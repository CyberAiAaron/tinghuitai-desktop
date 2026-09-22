'use strict';
// 录音保留期（Aaron 2026-09-22 定：录音保留三十天，文字一直保留）。
// 只动 <数据目录>/audio/ 下的录音文件；转写、要点、总结、pending / state 里的 JSON 一律不碰。
//   ① 会中直录：audio/<会议id>.pcm（server.js Session 写）
//   ② 导入音频：audio/import-<ts>.<m4a|mp3|wav|aac|webm|ogg>，上传中断的留成 .partial
//   ③ 手工 / 压测留下的 aaronrun1.pcm、bench*.pcm、mt*.pcm 同在这个目录，按同一规则清
// 正在录的会（有活动 session 的 id）无论多老一律跳过。已清掉的 id 记在 state/audio-retention.json，
// 回看页问 /audio 时能回「录音已按保留期清理」而不是「没有录音」。
const fs = require('fs'), path = require('path');

const AUDIO_EXTS = ['pcm', 'm4a', 'mp3', 'wav', 'aac', 'webm', 'ogg'];
const AUDIO_RE = new RegExp('^(.+?)\\.(' + AUDIO_EXTS.join('|') + ')(\\.partial)?$', 'i');
const DEFAULT_DAYS = 30;

function daysFrom(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAYS; }
function recordPath(dataDir) { return path.join(dataDir, 'state', 'audio-retention.json'); }
function readRecord(dataDir) {
  try { const j = JSON.parse(fs.readFileSync(recordPath(dataDir), 'utf8')); return { deleted: j.deleted || {}, lastSweepAt: j.lastSweepAt || 0, lastDeleted: j.lastDeleted || 0, lastFreedBytes: j.lastFreedBytes || 0 }; }
  catch (e) { return { deleted: {}, lastSweepAt: 0, lastDeleted: 0, lastFreedBytes: 0 }; }
}
function writeRecord(dataDir, rec) {
  const f = recordPath(dataDir); fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(rec)); fs.renameSync(tmp, f);
}

// sweep：删 mtime 早于 days 天的录音文件。days=0 不清理。
//   isRecording(id) 为真的跳过；只认 AUDIO_EXTS 里的扩展名（含 .partial），别的一个不碰。
//   返回 {deleted:[{file,bytes,ageDays}], kept, freedBytes, skipped}
function sweep({ audioDir, days = DEFAULT_DAYS, now = Date.now(), isRecording = () => false, dataDir = null, log = null } = {}) {
  days = daysFrom(days);
  const out = { deleted: [], kept: 0, freedBytes: 0, skipped: 0, days };
  if (days === 0) return out;
  let names = []; try { names = fs.readdirSync(audioDir); } catch (e) { return out; }
  const cutoff = now - days * 86400000;
  const deletedIds = [];
  for (const name of names) {
    const m = AUDIO_RE.exec(name);
    if (!m) { out.skipped++; continue; }
    const file = path.join(audioDir, name);
    let st; try { st = fs.statSync(file); } catch (e) { continue; }
    if (!st.isFile()) { out.skipped++; continue; }
    const id = m[1];
    if (isRecording(id) || st.mtimeMs >= cutoff) { out.kept++; continue; }
    try { fs.unlinkSync(file); } catch (e) { if (log) log('录音清理失败 ' + name + ' ' + e.message); out.kept++; continue; }
    out.deleted.push({ file: name, bytes: st.size, ageDays: Math.floor((now - st.mtimeMs) / 86400000) });
    out.freedBytes += st.size; deletedIds.push(id);
  }
  if (dataDir) {
    const rec = readRecord(dataDir);
    for (const id of deletedIds) rec.deleted[id] = now;
    rec.lastSweepAt = now; rec.lastDeleted = out.deleted.length; rec.lastFreedBytes = out.freedBytes; rec.days = days;
    try { writeRecord(dataDir, rec); } catch (e) { if (log) log('录音清理记录写入失败 ' + e.message); }
  }
  if (log) log('录音清理 保留' + days + '天 删' + out.deleted.length + '个 释放' + out.freedBytes + 'B 留' + out.kept + '个' + (out.deleted.length ? ' ' + out.deleted.map(d => d.file + '(' + d.ageDays + '天)').join(',') : ''));
  return out;
}

// 这个 id 的录音是不是被保留期清掉的（回看页据此显示「录音已按 N 天保留期清理」）
function wasSwept(dataDir, id) { return !!readRecord(dataDir).deleted[String(id)]; }
function status(dataDir, days) { const r = readRecord(dataDir); return { days: daysFrom(days), lastSweepAt: r.lastSweepAt, lastDeleted: r.lastDeleted, lastFreedBytes: r.lastFreedBytes }; }

module.exports = { sweep, wasSwept, status, daysFrom, AUDIO_EXTS, AUDIO_RE, DEFAULT_DAYS };
