#!/usr/bin/env node
'use strict';
// 会中洞察离线回放（app/live-insight.js 的度量，Aaron 2026-09-24）：
//   node scripts/replay-insight.js <场次JSON> --out <目录> [--step 60] [--tag after] [--settings settings.json] [--data 数据目录] [--rounds N]
// 把一场已结束会议的逐字稿按 --step 秒切成窗口，每个窗口按 server.js runTriageBody 的拼法（同一个 live-insight 模块）真调一次会中档模型
// （走 settings 的降级链，claude -p 用 Aaron 的订阅），状态（已出过的洞察 / 要点日志）逐轮累积、去重，和真会一样。
// 输出（都在 --out 目录）：
//   <sid>-<tag>.jsonl        每轮原始：窗口、耗时、token、模型原文、归一化结果
//   <sid>-<tag>.md           每 10 分钟卡片节奏、正文字符分布、@人名行动数，以及 10 张代表卡片原文
//   <sid>-<tag>-summary.json 数字
// 只读：不写会议文件、不写 usage.jsonl（dataDir 只当 cwd 用临时目录）。没有 Jev：回放按固定步长调用，真会里由门卫命中触发（≥2 s 间隔），条数只会更少不会更多。
const fs = require('fs'), path = require('path'), os = require('os');
const root = path.join(__dirname, '..');
const llm = require(path.join(root, 'app/llm.js'));
const contextPack = require(path.join(root, 'app/context-pack.js'));
const T = require(path.join(root, 'app/triage-fast.js'));
const L = require(path.join(root, 'app/live-insight.js'));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const VALUED = new Set(['--out', '--step', '--tag', '--settings', '--data', '--rounds']);
let file = ''; for (let i = 0; i < args.length; i++) { if (VALUED.has(args[i])) { i++; continue; } if (args[i].startsWith('--')) continue; file = args[i]; }
if (!file) { console.error('用法: replay-insight.js <场次JSON> --out <目录> [--step 60] [--tag after]'); process.exit(2); }
const outDir = opt('out', path.join(process.cwd(), 'replay-insight')); fs.mkdirSync(outDir, { recursive: true });
const step = Math.max(15, Number(opt('step', 60)) || 60);
const tag = opt('tag', 'after');
const maxRounds = Number(opt('rounds', 0)) || 0;
const dataDir = opt('data', path.join(os.homedir(), 'Library/Application Support/TinghuitaiAaron'));
const settingsPath = opt('settings', path.join(dataDir, 'settings.json'));
// 生产链路（app/server.js）用 config.js 的 load()：{...defaults, ...aliasJev(settings.json)}——settings.json 里没写的键吃 defaults
// （比如 LLM_LIVE_THINKING、JEV_GATE、THINK_PASS 的生产默认值）。回放以前直接 aliasJev(读原始 settings)，没套 defaults，
// settings.json 里缺的键就是 undefined，不代表生产真实取值；这里补上 defaults 合并，口径和 server.js 一致（Codex 2026-09-24 审计指出）。
const cfg = require(path.join(root, 'app/config.js'));
const env = { ...cfg.defaults, ...cfg.aliasJev(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))) };
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-replay-insight-'));

const sess = JSON.parse(fs.readFileSync(file, 'utf8'));
const sid = sess.id || path.basename(file, '.json').replace(/^sess-/, '');
const rows = (sess.transcript || []).filter(r => r && String(r.text || '').trim());
const enUI = sess.uiLang === 'en';
const REPEAT = /^(.{2,12})\1{2,}$/;   // 与 server.js repeatedASR 同义的粗版：同一小段重复 3 次以上
const fmt = r => `[${r.at}s]${r.speaker ? 'S' + r.speaker + ':' : ''}${r.text}`;
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]; };
const chars = text => [...String(text || '')].length;
const hasAssignee = md => String(md || '').split('\n').some(line => L.ASSIGN_RE.test(line));
const representative = (cards, n = 10) => { if (cards.length <= n) return [...cards]; return Array.from({ length: n }, (_, i) => cards[Math.round(i * (cards.length - 1) / (n - 1))]); };
const bucket = at => Math.floor((Number(at) || 0) / 600);   // 10 分钟桶
const lastAt = rows.length ? Number(rows[rows.length - 1].at) || 0 : 0;
const nBuckets = Math.floor(lastAt / 600) + 1;

// —— 改前：场次文件里已经有的条目，按 sourceRefs 找到时间进 10 分钟桶
const atOf = new Map(rows.map(r => [r.id, Number(r.at) || 0]));
function beforeBuckets(list) { const b = new Array(nBuckets).fill(0); for (const it of list || []) { const ref = (it.sourceRefs || [])[0]; const at = ref ? atOf.get(ref.segId) : (Number(it.at) > 1e10 ? (Number(it.at) - Date.parse(sess.start)) / 1000 : Number(it.at)); const k = bucket(at); if (k >= 0 && k < nBuckets) b[k]++; } return b; }
const before = { highlights: (sess.highlights || []).length, todos: (sess.todos || []).length, factchecks: (sess.factchecks || []).length,
  buckets: { highlights: beforeBuckets(sess.highlights), todos: beforeBuckets(sess.todos), factchecks: beforeBuckets(sess.factchecks) } };

(async () => {
  const started = Date.now();
  const state = { factchecks: [], highlights: [], memoryBlock: sess.memoryBlock || '' };
  const pack = contextPack.build(env, { purpose: 'live', dataDir, session: state, meetingId: sid });
  const jsonl = path.join(outDir, `${sid}-${tag}.jsonl`); fs.writeFileSync(jsonl, '');
  const log = [];
  let lastTriageIndex = 0, seq = 0, round = 0, lastCardAtSec = 0;
  const cardTimesSec = [];   // 与生产 Session.cardTimes 同义：配合 overBurstCap 卡滚动 10 分钟不超过 2 张
  const CARD_COOLDOWN_SEC = L.CARD_COOLDOWN_MS / 1000;   // 与生产同一套（app/live-insight.js inCooldown）：出卡后 5 分钟内不再触发；这里用会议时间 t 当 Date.now() 的替身
  for (let t = step; t <= lastAt + step; t += step) {
    let endIndex = rows.findIndex(r => (Number(r.at) || 0) > t); if (endIndex < 0) endIndex = rows.length;
    if (endIndex <= lastTriageIndex) continue;
    if (maxRounds && round >= maxRounds) break;
    if (L.inCooldown(lastCardAtSec * 1000, t * 1000)) continue;   // 冷却中：不推进 lastTriageIndex，增量留给冷却期满那一轮
    if (L.overBurstCap(cardTimesSec.map(s => s * 1000), t * 1000)) continue;   // 滚动 10 分钟已出够 2 张，和生产 server.js 同一层限制
    round++;
    const idx = L.windowRows(rows, { endIndex, lastTriageIndex });
    const win = idx.map(i => rows[i]).filter(r => !REPEAT.test(r.text));
    const recent = win.map(fmt).join('\n');
    const existing = state.factchecks.map(x => x.claim), logExisting = state.highlights.map(x => x.text);
    const sys = L.systemPrompt({ enUI, sweep: false });
    const user = L.userPrompt({ packText: pack.text, brief: sess.brief || '', existing, log: logExisting, recent, enUI });
    const t0 = Date.now();
    const res = await llm.ask(env, { kind: 'live', system: sys, user, maxTokens: L.MAX_OUTPUT_TOKENS, dataDir: cwd, log: () => {}, timeoutMs: 90000, thinking: T.liveThinking(env), tools: false });
    const ms = Date.now() - t0;
    const parsed = L.parse(res.text);
    const r = L.normalize(parsed, { existing, logExisting, enUI });
    const atStart = Number(rows[idx[0]] && rows[idx[0]].at) || 0, atEnd = Number(rows[endIndex - 1].at) || 0;
    if (r.insight) { r.insight.id = 'r' + (++seq); r.insight.at = atEnd; state.factchecks.push(r.insight); lastCardAtSec = atEnd; cardTimesSec.push(atEnd); if (cardTimesSec.length > 20) cardTimesSec.splice(0, cardTimesSec.length - 20); }
    for (const text of r.log) state.highlights.push({ id: 'r' + (++seq), text, at: atEnd, log: true });
    const row = { round, atStart, atEnd, rowsIn: win.length, ms, inTok: res.usage ? res.usage.in : null, outTok: res.usage ? res.usage.out : null, thinking: res.usage ? (res.usage.thinking || 0) : null, turns: res.usage ? (res.usage.turns || 0) : null, provider: res.provider || '', model: res.model || '', err: res.errorCode || '',
      parsedOk: !!parsed, insight: r.insight ? { md: r.insight.md, chars: chars(r.insight.md), hasAssignee: hasAssignee(r.insight.md), claim: r.insight.claim, type: r.insight.type, action: r.insight.action } : null, log: r.log, rawInsight: parsed ? parsed.md : null };
    log.push(row); fs.appendFileSync(jsonl, JSON.stringify({ ...row, raw: String(res.text || '').slice(0, 3000) }) + '\n');
    process.stderr.write(`  ${sid} #${round} ${atStart}-${atEnd}s ${ms}ms in=${row.inTok} out=${row.outTok} ${r.insight ? '洞察 ' + chars(r.insight.md) + '字 ' + r.insight.claim : '—'}${parsed ? '' : ' (未解析)'}${row.err ? ' err=' + row.err : ''}\n`);
    lastTriageIndex = endIndex;
  }
const ok = log.filter(x => !x.err);
const afterBuckets = list => { const b = new Array(nBuckets).fill(0); for (const it of list) { const k = bucket(it.at); if (k >= 0 && k < nBuckets) b[k]++; } return b; };
const cardChars = state.factchecks.map(x => chars(x.md));
const reps = representative(state.factchecks, 10).map(x => ({ at: x.at, chars: chars(x.md), hasAssignee: hasAssignee(x.md), md: x.md }));
const summary = { sid, title: sess.title || '', tag, step, minutes: +(lastAt / 60).toFixed(1), calls: log.length, failed: log.length - ok.length, unparsed: ok.filter(x => !x.parsedOk).length,
  before, after: { cards: state.factchecks.length, buckets: afterBuckets(state.factchecks), withAssignee: state.factchecks.filter(x => hasAssignee(x.md)).length,
    charStats: { min: cardChars.length ? Math.min(...cardChars) : 0, median: pct(cardChars, 0.5), p90: pct(cardChars, 0.9), max: cardChars.length ? Math.max(...cardChars) : 0 }, representative: reps },
  per10min: { before: +(((before.highlights + before.todos + before.factchecks) / Math.max(lastAt / 600, 1))).toFixed(1), after: +((state.factchecks.length / Math.max(lastAt / 600, 1))).toFixed(1) },
  targetPer10min: [1, 2], inTarget: state.factchecks.length > 0 && state.factchecks.length / Math.max(lastAt / 600, 1) >= 1 && state.factchecks.length / Math.max(lastAt / 600, 1) <= 2,
  msMedian: pct(ok.map(x => x.ms), 0.5), msP90: pct(ok.map(x => x.ms), 0.9), inMedian: pct(ok.map(x => x.inTok || 0), 0.5), outMedian: pct(ok.map(x => x.outTok || 0), 0.5),
  packChars: pack.text.length, packParts: (pack.parts || []).map(p => p.key + ':' + (p.chars || 0)), elapsedSec: Math.round((Date.now() - started) / 1000) };
fs.writeFileSync(path.join(outDir, `${sid}-${tag}-summary.json`), JSON.stringify(summary, null, 2));
const bucketRow = (name, arr) => `| ${name} | ${arr.join(' | ')} | ${arr.reduce((a, b) => a + b, 0)} |`;
const heads = Array.from({ length: nBuckets }, (_, i) => `${i * 10}–${i * 10 + 10}′`);
const repMd = summary.after.representative.flatMap((x, i) => [`### ${i + 1} · ${Math.floor(x.at / 60)}′${String(Math.round(x.at % 60)).padStart(2, '0')} · ${x.chars} 字${x.hasAssignee ? ' · 含 @行动' : ''}`, '', x.md, '']);
const md = [
  `# ${sess.title || sid}（${sid}）会中洞察回放 · ${tag}`, '',
  `时长 ${summary.minutes} 分钟 · 转写 ${rows.length} 段 · 步长 ${step} s → ${log.length} 次调用（失败 ${summary.failed}，未解析 ${summary.unparsed}）· 耗时中位 ${summary.msMedian} ms / p90 ${summary.msP90} ms`, '',
  `卡片 ${summary.after.cards} 张 · 每 10 分钟 ${summary.per10min.after} 张（目标 1–2）· 字数 min / median / p90 / max = ${summary.after.charStats.min} / ${summary.after.charStats.median} / ${summary.after.charStats.p90} / ${summary.after.charStats.max} · 含 @人名行动 ${summary.after.withAssignee} 张`, '',
  '## 每 10 分钟卡片数', '',
  `| | ${heads.join(' | ')} | 合计 |`, `|---|${heads.map(() => '---').join('|')}|---|`,
  bucketRow('自由洞察卡', summary.after.buckets), '',
  '## 10 张代表卡片原文', '', ...repMd,
  '## 全部卡片', '',
  ...state.factchecks.flatMap((x, i) => [`### ${i + 1} · ${Math.floor(x.at / 60)}′${String(Math.round(x.at % 60)).padStart(2, '0')} · ${chars(x.md)} 字${hasAssignee(x.md) ? ' · 含 @行动' : ''}`, '', x.md, '']),
  '## 逐轮', '',
  '| 轮 | 窗口 | 行 | ms | in | out | think | turns | 结果 |', '|---|---|---|---|---|---|---|---|---|',
  ...log.map(x => `| ${x.round} | ${x.atStart}–${x.atEnd}s | ${x.rowsIn} | ${x.ms} | ${x.inTok ?? ''} | ${x.outTok ?? ''} | ${x.thinking ?? ''} | ${x.turns ?? ''} | ${x.err ? '失败 ' + x.err : x.insight ? `${x.insight.chars} 字${x.insight.hasAssignee ? ' +@行动' : ''}` : (x.parsedOk ? 'NONE' : '未解析')} |`),
].join('\n');
  fs.writeFileSync(path.join(outDir, `${sid}-${tag}.md`), md);
  console.log(JSON.stringify({ sid, tag, calls: log.length, failed: summary.failed, cards: summary.after.cards, per10min: summary.per10min.after, charStats: summary.after.charStats, withAssignee: summary.after.withAssignee, inTarget: summary.inTarget, out: path.join(outDir, `${sid}-${tag}.md`) }));
  try { fs.rmSync(cwd, { recursive: true, force: true }); } catch (e) {}
})().catch(e => { console.error('回放失败：' + (e.stack || e.message)); process.exit(1); });
