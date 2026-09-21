#!/usr/bin/env node
'use strict';
// N-02：把旧中转 3101 的工作台库并进桌面版的库，合成一份。可以重复跑（切换当天还要再并一次增量）。
// 只有 --write 才真的落盘；默认只报合并结果，不碰任何文件。
//
// 规则（2026-09-21 重写。09-20 那版「共有记录整条取旧库」把桌面版 15 份资料的逐字稿换成了空值）：
//   1. 六个集合都按 id 取并集，哪边独有的都留。
//   2. 共有记录按字段合：以 updated 较新的那条为底（一样新取旧库——工作台的日常读写一直落在 3101），
//      底上为空、另一边有值的字段补进来。有值永远不被空值盖掉。
//   3. 内容字段（逐字稿/正文/纪要/要点…）桌面版有值就留桌面版的：那是桌面版归档校验过的一份，
//      旧库同名字段多半是原始转写堆。
//   4. 写之前逐条逐字段对回两份原库：有值变空、或桌面版内容变短，一条都不许有，否则拒写。
// 旧库 = 3101 那份，目标库 = 桌面版那份（服务要留的那一侧）。两份原库都不删，写前另存备份。
const fs = require('fs');

const COLLECTIONS = ['tasks', 'workItems', 'projects', 'events', 'sources', 'knowledgeNodes'];
const CONTENT = new Set(['transcript', 'body', 'summary', 'highlights', 'todos', 'factchecks', 'text', 'note']);
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const ts = v => { const n = Date.parse(v || 0); return Number.isFinite(n) ? n : 0; };
const populated = v => v !== null && v !== undefined && v !== '' &&
  (!Array.isArray(v) || v.length > 0) &&
  (typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length > 0);
const size = v => v == null ? 0 : (typeof v === 'string' ? v.length : JSON.stringify(v).length);
const same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);

function mergeRecord(old, desk, stats) {
  const oldIsBase = ts(old.updated) >= ts(desk.updated);
  const base = oldIsBase ? old : desk, other = oldIsBase ? desk : old;
  const result = { ...base };
  for (const [key, value] of Object.entries(other)) {
    if (!populated(result[key]) && populated(value)) result[key] = value;
  }
  for (const key of CONTENT) {
    if (populated(desk[key]) && !same(result[key], desk[key])) { result[key] = desk[key]; stats.deskContent[key] = (stats.deskContent[key] || 0) + 1; }
  }
  for (const key of ['status', 'owner', 'due']) {
    if (populated(old[key]) && populated(desk[key]) && !same(old[key], desk[key])) stats.newerWins.push(`${old.id}.${key} 旧=${JSON.stringify(old[key])} 桌面=${JSON.stringify(desk[key])} → ${JSON.stringify(result[key])}`);
  }
  return result;
}

function mergeById(oldList, deskList) {
  const stats = { added: 0, shared: 0, deskContent: {}, newerWins: [] };
  const out = new Map();
  for (const x of deskList || []) if (x && x.id) out.set(x.id, x);
  for (const x of oldList || []) {
    if (!x || !x.id) continue;
    if (!out.has(x.id)) { out.set(x.id, x); stats.added++; continue; }
    out.set(x.id, mergeRecord(x, out.get(x.id), stats)); stats.shared++;
  }
  return { list: [...out.values()], stats };
}

function mergeHubs(a, b) {
  const parts = {};
  for (const name of COLLECTIONS) parts[name] = mergeById(a[name], b[name]);
  // `...b, ...a` 会让旧库的每一个顶层键压过目标库，包括不在上面六个集合里的那几个：
  // sync（index/disk/recovery，work-hub.js 靠它判恢复告警）、version、knowledgeVersion（knowledge.prepare 的门）。
  // 这几个属于「目标库当前运行状态」，不是可合并的数据，必须留目标库的。
  const merged = { ...b, ...a, sync: b.sync, version: b.version, knowledgeVersion: b.knowledgeVersion,
    revision: Math.max(Number(a.revision) || 0, Number(b.revision) || 0) + 1, updated: new Date().toISOString() };
  for (const name of COLLECTIONS) merged[name] = parts[name].list;
  return { merged, parts };
}

// 丢数据检查：条数对得上不算通过——09-20 那次条数全对，丢的是字段。
function findLosses(a, b, merged) {
  const losses = [];
  for (const name of COLLECTIONS) {
    const after = new Map((merged[name] || []).map(x => [x.id, x]));
    for (const [side, list] of [['旧库', a[name]], ['桌面版', b[name]]]) {
      for (const before of list || []) {
        if (!before || !before.id) continue;
        const now = after.get(before.id);
        if (!now) { losses.push(`丢记录 ${name}/${before.id}（${side}）`); continue; }
        for (const key of Object.keys(before)) {
          if (populated(before[key]) && !populated(now[key])) losses.push(`${name}/${before.id}.${key} 变空（${side}原来有值）`);
          else if (side === '桌面版' && CONTENT.has(key) && size(before[key]) > size(now[key])) losses.push(`${name}/${before.id}.${key} 变短（桌面版内容）`);
        }
      }
    }
  }
  return losses;
}

module.exports = { mergeHubs, findLosses, mergeRecord, populated };

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const [oldPath, newPath] = args.filter(x => !x.startsWith('--'));
  if (!oldPath || !newPath) { console.error('用法: node scripts/merge-work-hub.js <旧库.json> <目标库.json> [--write]'); process.exit(2); }
  const a = read(oldPath), b = read(newPath);
  const { merged, parts } = mergeHubs(a, b);
  for (const name of COLLECTIONS) {
    const s = parts[name].stats;
    console.log(`${name.padEnd(15)} 旧 ${String((a[name] || []).length).padStart(5)}  桌面 ${String((b[name] || []).length).padStart(5)}  →  ${String(parts[name].list.length).padStart(5)}（旧库独有补入 ${s.added}，共有按字段合 ${s.shared}）` +
      (Object.keys(s.deskContent).length ? `  内容字段留桌面版：${JSON.stringify(s.deskContent)}` : ''));
  }
  const wins = COLLECTIONS.flatMap(n => parts[n].stats.newerWins);
  console.log('共有记录里状态/负责人/截止两边不同、按较新那条取的：' + wins.length);
  for (const line of wins.slice(0, 20)) console.log('  ' + line);

  const losses = findLosses(a, b, merged);
  console.log('合并后丢失的记录/字段：' + losses.length);
  for (const line of losses.slice(0, 20)) console.log('  ' + line);
  if (losses.length) { console.error('合并会丢数据，没有写入。'); process.exit(1); }

  if (!write) { console.log('\n这是试跑，没有写任何文件。确认无误后加 --write。'); return; }
  const backup = newPath + '.before-merge-' + Date.now() + '.json';
  fs.copyFileSync(newPath, backup);
  const tmp = newPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(merged));
  fs.renameSync(tmp, newPath);
  console.log('\n已写入 ' + newPath + '\n合并前那份备份在 ' + backup + '\n旧库 ' + oldPath + ' 原样保留，没有改动。');
}
if (require.main === module) main();
