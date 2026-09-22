#!/usr/bin/env node
'use strict';
// 离线回放：把一场已结束会议的逐字稿逐句真送 Jev（app/jev-gate.js 的 judge），不叫大模型，只算
// 「按最小间隔合并后会触发多少次分诊」，和现网「25 秒定时 + ≥60 新字」的触发次数并排。
//   node scripts/replay-jev.js <场次JSON> [--out 结果文件] [--settings settings.json 路径] [--gap 8] [--threshold 0.5] [--concurrency 4] [--triage 0] [--reuse]
//   --triage N：模拟每次分诊占用 N 秒（this.triaging 锁），期间命中并入下一次；--reuse：复用 <out>.results.json 里上次的逐句判定，不再调 Jev
// 密钥只从 settings.json 读，不打印、不落文件；用量不记账（dataDir=null），生产账本不被回放污染。
const fs = require('fs'), path = require('path'), os = require('os');
const G = require(path.join(__dirname, '..', 'app', 'jev-gate.js'));

const args = process.argv.slice(2); const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
let file = ''; for (let i = 0; i < args.length; i++) { if (args[i] === '--reuse') continue; if (args[i].startsWith('--')) { i++; continue; } file = args[i]; }
if (!file) { console.error('用法: replay-jev.js <场次JSON> [--out f] [--settings f] [--gap 秒] [--threshold x] [--concurrency n]'); process.exit(2); }
const settingsPath = opt('settings', path.join(os.homedir(), 'Library/Application Support/TinghuitaiAaron/settings.json'));
const gapSec = Number(opt('gap', 8)), conc = Math.max(1, Number(opt('concurrency', 4)));
const out = opt('out', ''); const triageSec = Number(opt('triage', 0)); const reuse = args.includes('--reuse'); const cache = out ? out + '.results.json' : '';

const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const env = { JEV_API_KEY: settings.JEV_API_KEY || '', JEV_GATE: 'on', JEV_THRESHOLD: opt('threshold', settings.JEV_THRESHOLD || '0.5') };
if (!env.JEV_API_KEY) { console.error('settings.json 里没有 JEV_API_KEY'); process.exit(2); }

const sess = JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = (sess.transcript || []).map(r => ({ t: Number(r.t ?? r.at ?? 0), text: String(r.text || '').trim() })).filter(r => r.text);
// 老场次的 t 是秒（at 是毫秒时间戳）；新场次 at 是秒。统一成「从第一句起的秒数」。
const t0 = rows.length ? rows[0].t : 0; for (const r of rows) r.sec = r.t - t0;

(async () => {
  let results = new Array(rows.length); let next = 0;
  if (reuse && cache && fs.existsSync(cache)) { results = JSON.parse(fs.readFileSync(cache, 'utf8')); if (results.length !== rows.length) throw Error('缓存句数不符'); next = rows.length; }
  async function worker() {
    while (next < rows.length) {
      const i = next++; const prev = rows.slice(Math.max(0, i - 2), i).map(r => r.text);
      results[i] = await G.judge({ env, prev, text: rows[i].text, fetchImpl: globalThis.fetch, dataDir: null });
      if (i % 25 === 0) process.stderr.write(`  ${i}/${rows.length}\n`);
    }
  }
  const started = Date.now();
  await Promise.all(Array.from({ length: conc }, worker));
  const wall = Date.now() - started;
  if (cache && !(reuse && next === rows.length && wall < 50)) fs.writeFileSync(cache, JSON.stringify(results));

  const hits = results.map((r, i) => ({ ...r, i, sec: rows[i].sec, text: rows[i].text })).filter(r => r.hit);
  const failures = results.filter(r => r.error).length;
  const msSorted = results.map(r => r.ms).sort((a, b) => a - b); const median = msSorted.length ? msSorted[Math.floor(msSorted.length / 2)] : 0;
  // 门卫触发模拟（与 Gate.requestTrigger 同一规则）：距上次触发 ≥ gap 立刻触发；否则挂到「上次 + gap」那一刻触发一次，期间命中全并入。
  // 再叠一层 this.triaging 锁：一次分诊占 triageSec 秒，期间的命中并入锁释放后的那一次（仍受 gap 约束）。triageSec=0 就是纯间隔模型。
  let last = -Infinity, pendingAt = null, triggers = 0, merged = 0;
  for (const h of hits) {
    if (pendingAt !== null && h.sec >= pendingAt) { last = pendingAt; pendingAt = null; }
    const freeAt = Math.max(last + gapSec, last + triageSec);
    if (h.sec >= freeAt) { last = h.sec; triggers++; }
    else { merged++; if (pendingAt === null) { pendingAt = freeAt; triggers++; } }
  }
  // 现网基线：每 25 秒一个 tick，tick 时新增 ≥60 字才分诊。
  let base = 0, chars = 0, ri = 0; const endSec = rows.length ? rows[rows.length - 1].sec : 0;
  for (let tick = 25; tick <= endSec + 25; tick += 25) { while (ri < rows.length && rows[ri].sec <= tick) chars += rows[ri++].text.length; if (chars >= 60) { base++; chars = 0; } }
  const kinds = {}; for (const h of hits) kinds[h.kind] = (kinds[h.kind] || 0) + 1;
  const dur = Math.round(endSec / 60);
  const lines = [
    `Jev 回放 ${path.basename(file)}（${sess.title || ''}）· ${new Date().toISOString()}`,
    `句数 ${rows.length}，时长约 ${dur} 分钟，阈值 ${env.JEV_THRESHOLD}，最小间隔 ${gapSec}s，并发 ${conc}，墙钟 ${Math.round(wall / 1000)}s`,
    `命中 ${hits.length}（${Object.entries(kinds).map(([k, v]) => k + ' ' + v).join('，')}）`,
    `合并后 Sonnet 触发次数（门卫，间隔 ${gapSec}s${triageSec ? '，每次分诊占 ' + triageSec + 's' : ''}）${triggers}，其中并入 ${merged} 次命中；现网基线（25s 定时 + ≥60 字）${base} 次`,
    `失败 ${failures}，中位耗时 ${median} ms，p90 ${msSorted[Math.floor(msSorted.length * 0.9)] || 0} ms`,
    '', '命中样例（前 12 条）：', ...hits.slice(0, 12).map(h => `  [${h.sec}s] ${h.kind} ${h.noul.toFixed(2)}：${h.text.slice(0, 60)}`),
  ];
  const text = lines.join('\n') + '\n';
  if (out) { fs.writeFileSync(out, text); console.log(lines.slice(1, 5).join('\n')); console.log('全文 ' + out); } else console.log(text);
})().catch(e => { console.error('回放失败 ' + (e && e.message)); process.exit(1); });
