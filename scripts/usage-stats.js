#!/usr/bin/env node
'use strict';
// Print observed model usage for one meeting. No model call and no data write.
const fs = require('fs');
const path = require('path');
const os = require('os');

const sessionId = process.argv[2];
if (!sessionId) {
  console.error('用法: node scripts/usage-stats.js <sessionId> [usage.jsonl]');
  process.exit(2);
}
const file = process.argv[3] || path.join(
  process.env.THT_DATA_DIR || path.join(os.homedir(), 'Library/Application Support/Tinghuitai'),
  'state', 'usage.jsonl');
let lines;
try { lines = fs.readFileSync(file, 'utf8').split('\n'); }
catch (e) { console.error('用量账本读取失败: ' + e.message); process.exit(1); }
const rows = [];
for (const line of lines) {
  if (!line.trim()) continue;
  let row;
  try { row = JSON.parse(line); } catch (e) { continue; }
  if (row.sessionId === sessionId) rows.push(row);
}
if (!rows.length) { console.error('这场没有用量记录: ' + sessionId); process.exit(1); }
const percentile = (sorted, p) => sorted[Math.ceil(sorted.length * p) - 1];
for (const tier of ['live', 'post', 'other']) {
  const group = rows.filter(r => (r.tier || (r.purpose === 'triage' ? 'live' : 'other')) === tier);
  if (!group.length) continue;
  const values = group.map(r => Number(r.in || 0) + Number(r.out || 0)).sort((a, b) => a - b);
  const models = [...new Set(group.map(r => r.model || '(未记录)'))].join(', ');
  const estimated = group.filter(r => r.est !== false).length;
  console.log(`${tier}: ${group.length} 次，模型 ${models}`);
  console.log(`  token/次 中位 ${percentile(values, .5)}，p95 ${percentile(values, .95)}，最大 ${values.at(-1)}`);
  console.log(`  总计 输入 ${group.reduce((n, r) => n + Number(r.in || 0), 0)}，输出 ${group.reduce((n, r) => n + Number(r.out || 0), 0)}；估算记录 ${estimated}/${group.length}`);
}
