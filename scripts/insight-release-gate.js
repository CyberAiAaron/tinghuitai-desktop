#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function argsOf(argv) {
  const out = { session: '' };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (!value.startsWith('--') && !out.session) out.session = value;
    else if (value.startsWith('--')) out[value.slice(2)] = argv[++i];
  }
  return out;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw Error(`${file}:${index + 1} 不是合法 JSON`); }
  });
}
function semanticRisks(rows) {
  const contradicted = /(?:还在讨论|讨论中|尚未确定|尚未确认|未拍板|待确认).{0,24}(?:已确定|已决定|已拍板|已经确认)/i;
  const unownedPromise = /(?:^|\n)[^\n@：:]{0,12}(?:承诺|将于|会在|负责|截止(?:到|于)?)[^\n]*/gi;
  const risks = [];
  for (const row of rows) {
    const md = String(row.insight && row.insight.md || '');
    if (!md) continue;
    if (contradicted.test(md)) risks.push({ round: row.round, kind: '讨论态写成已确定', excerpt: md.slice(0, 160) });
    for (const match of md.matchAll(unownedPromise)) {
      const line = match[0].trim();
      if (!/@[\p{L}\p{N}_-]+/u.test(line)) risks.push({ round: row.round, kind: '无主行动包装成承诺', excerpt: line.slice(0, 160) });
    }
  }
  return risks;
}
function evaluate(summary, rows) {
  const cards = rows.filter(row => row.insight && row.insight.md);
  const times = cards.map(row => Number(row.emitAt != null ? row.emitAt : row.atEnd)).filter(Number.isFinite).sort((a, b) => a - b);
  const gaps = times.slice(1).map((time, index) => time - times[index]);
  const mean = Number(summary.per10min && summary.per10min.after);
  const peak = Math.max(0, ...((summary.after && summary.after.buckets) || []).map(Number));
  const minimumGap = gaps.length ? Math.min(...gaps) : null;
  const risks = semanticRisks(rows);
  const checks = [
    { id: 'cadence_mean', pass: mean >= 1 && mean <= 2, actual: mean, expected: '1–2 张/10min' },
    { id: 'rolling_peak', pass: peak <= 2, actual: peak, expected: '≤2 张/任意 10min 窗口' },
    { id: 'semantic_state', pass: risks.length === 0, actual: risks.length, expected: '0 条高风险状态误写' },
    { id: 'cooldown_5m', pass: times.length > 0 && (minimumGap == null || minimumGap >= 300), actual: minimumGap, expected: '相邻出卡 ≥300 秒' },
  ];
  return { ok: checks.every(check => check.pass), sid: summary.sid, tag: summary.tag, cards: summary.after && summary.after.cards, checks, risks };
}
function resolveFiles(options) {
  if (options.summary && options.jsonl) return { summary: options.summary, jsonl: options.jsonl };
  if (!options.session || !options.out) throw Error('用法：insight-release-gate.js <session.json> --out <目录> [--tag release]，或 --summary <文件> --jsonl <文件>');
  const tag = options.tag || 'release-gate';
  const replay = path.join(__dirname, 'replay-insight.js');
  const replayArgs = [options.session, '--out', options.out, '--tag', tag];
  if (options.step) replayArgs.push('--step', options.step);
  if (options.settings) replayArgs.push('--settings', options.settings);
  if (options.data) replayArgs.push('--data', options.data);
  execFileSync(process.execPath, [replay, ...replayArgs], { stdio: 'inherit' });
  const session = readJson(options.session);
  const sid = session.id || path.basename(options.session, '.json').replace(/^sess-/, '');
  return { summary: path.join(options.out, `${sid}-${tag}-summary.json`), jsonl: path.join(options.out, `${sid}-${tag}.jsonl`) };
}
function main(argv = process.argv.slice(2)) {
  const files = resolveFiles(argsOf(argv));
  const report = evaluate(readJson(files.summary), readJsonl(files.jsonl));
  console.log(JSON.stringify({ ...report, files }, null, 2));
  return report.ok ? 0 : 1;
}
if (require.main === module) process.exitCode = main();
module.exports = { argsOf, semanticRisks, evaluate, resolveFiles, main };
