#!/usr/bin/env node
'use strict';
// 会中分诊离线回放 · 对照模式（批 5 提速的度量，Aaron 2026-09-22）：
//   node scripts/replay-triage.js --compare <场次JSON> [--rounds 15] [--group before|after|both] [--out 结果.txt] [--settings settings.json] [--data 数据目录]
// 把一场已结束会议的逐字稿切成 N 轮（等句数），每轮按 server.js runTriageBody 的拼法真调一次会中档模型（走 settings 的降级链，claude -p 用 Aaron 的订阅）：
//   before = 改前拼法：已有条目整条回传、无输出瘦身、2000 输出上限、每轮全量带项目资料
//   after  = 改后拼法（app/triage-fast.js）：已有条目 id+20 字、输出瘦身规则、700 上限（接口路才生效）、资料 hash 不变占位；思考沿用命令行默认
//   after-nothink = after + MAX_THINKING_TOKENS=0（LLM_LIVE_THINKING='0'，批 5 实测后加的一项）
// 每组 ≤ rounds 次调用（--group both = before + after + after-nothink 三组）。输出：条目数（h/t/f）、每次耗时中位 / p90、输出 token 中位、输入 token 中位，并排落到 --out。
// 逐次原始数据落 <out>.jsonl。用量不记进生产账本（不调 noteUsage；dataDir 只当 cwd）。
// 注意：回放没有 Jev（不调门卫），after 组衡量的是 ①③⑤ 三项（输出瘦身 / existed 摘要 / 资料占位）；② 门卫窗口和 ④ 定时器由单测覆盖。
// 只读：不写会议文件、不写 usage.jsonl。app/replay-triage.js（会后补跑）是另一件事，不动它。
const fs = require('fs'), path = require('path'), os = require('os');
const root = path.join(__dirname, '..');
const llm = require(path.join(root, 'app/llm.js'));
const contextPack = require(path.join(root, 'app/context-pack.js'));
const T = require(path.join(root, 'app/triage-fast.js'));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
if (!args.includes('--compare')) { console.error('用法: replay-triage.js --compare <场次JSON> [--rounds 15] [--group before|after|both] [--out f]'); process.exit(2); }
const VALUED = new Set(['--rounds', '--group', '--out', '--settings', '--data']);
let file = ''; for (let i = 0; i < args.length; i++) { if (VALUED.has(args[i])) { i++; continue; } if (args[i].startsWith('--')) continue; file = args[i]; }
if (!file) { console.error('缺场次 JSON'); process.exit(2); }
const rounds = Math.max(1, Math.min(15, Number(opt('rounds', 15))));
const group = opt('group', 'both');
const GROUPS = ['before', 'after', 'after-nothink'];
if (group !== 'both' && !GROUPS.includes(group)) { console.error('--group 只认 ' + GROUPS.join(' / ') + ' / both'); process.exit(2); }
const out = opt('out', path.join(process.cwd(), 'fast-compare.txt'));
const dataDir = opt('data', path.join(os.homedir(), 'Library/Application Support/TinghuitaiAaron'));
const settingsPath = opt('settings', path.join(dataDir, 'settings.json'));
const env = require(path.join(root, 'app/config.js')).aliasJev(JSON.parse(fs.readFileSync(settingsPath, 'utf8')));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-replay-'));

const sess = JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = (sess.transcript || []).filter(r => r && String(r.text || '').trim());
const TRIAGE = (() => { const m = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8').match(/const\s+TRIAGE\s*=\s*([`"'])([\s\S]*?)\1/); return m ? m[2] : ''; })();
const enUI = sess.uiLang === 'en';
const langHead = enUI ? 'Write every text / claim / note field in ENGLISH, regardless of the language spoken. Prefix any conflict item text with "⚠️ Conflict: ".\n' : '所有 text / claim / note 字段一律用中文输出。冲突项的 text 以「⚠️ 冲突：」开头。\n';
const langTail = enUI ? '\n\n【输出语言 / OUTPUT LANGUAGE】Every text/claim/note value MUST be written in English, even though the meeting is spoken in Chinese. Do NOT output Chinese in these fields.' : '\n\n【输出语言】所有 text/claim/note 一律中文。';
const INSIGHT_RULE = '\n【洞察门槛】insights 每条必须带 type（conflict / recheck / answer 之一）、source（引用【本场背景】/ 决策板 / 项目记忆里的具体文档名、决策编号、会议日期或数字）和 why（省了本人哪一步）；conflict 还必须带 evidence（会上原话）和 refs，recheck 必须带 evidence；缺任一项的不要输出；不给建议、不纠听写、不写「无法核实 / 需确认」；每轮 ≤2 条，没有就 []。';
const briefBlock = sess.brief ? `【本场背景（人名/公司/网站，判断时以此为准）】\n${sess.brief}\n\n` : '';
const TRIAGE_RECENT_CAP = 8000;

const fmt = r => `[${r.at}s]${r.speaker ? 'S' + r.speaker + ':' : ''}${r.text}`;
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]; };
const median = arr => pct(arr, 0.5);

function parseItems(raw) {
  const cleaned = String(raw || '').replace(/^```json?|```$/g, '').trim();
  try { const j = JSON.parse(cleaned); return { ok: true, h: (j.highlights || []).length, t: (j.todos || []).length, f: (j.insights || j.factchecks || []).length, j }; }
  catch (e) { return { ok: false, h: (cleaned.match(/"text"\s*:/g) || []).length, t: 0, f: (cleaned.match(/"claim"\s*:/g) || []).length, j: null }; }
}

async function runGroup(mode) {
  const fast = mode !== 'before', nothink = mode === 'after-nothink';
  const state = { highlights: [], todos: [], factchecks: [], memoryBlock: sess.memoryBlock || '' };
  const delta = new T.PackDelta();
  const per = Math.ceil(rows.length / rounds);
  const log = [];
  let last = 0, seq = 0;
  for (let r = 0; r < rounds && last < rows.length; r++) {
    const end = Math.min(rows.length, last + per);
    let recent = rows.slice(Math.max(0, last - 3), end).map(fmt).join('\n');
    if (recent.length > TRIAGE_RECENT_CAP) { const cut = recent.slice(-TRIAGE_RECENT_CAP), nl = cut.indexOf('\n'); recent = nl >= 0 ? cut.slice(nl + 1) : cut; }
    const notStale = a => a.filter(x => !x.stale);
    const existed = !fast
      ? JSON.stringify({ highlights: notStale(state.highlights).slice(-20), todos: notStale(state.todos).slice(-20), factchecks: notStale(state.factchecks).slice(-20) })
      : T.existedSummary(state);
    const sys = langHead + briefBlock + (TRIAGE || '你是会议实时助手，从转写提取 highlights/todos/factchecks，只输出 JSON。') + INSIGHT_RULE
      + (fast ? T.outputRules({ enUI, sweep: false }) : '') + langTail;
    let pack = contextPack.build(env, { purpose: 'live', dataDir, session: state, meetingId: sess.id });
    if (fast) pack = delta.apply(pack);
    const user = `${pack.text}\n\n【已有条目】${existed}\n\n【最新转写】\n${recent}`;
    const maxTokens = fast ? T.MAX_OUTPUT_TOKENS : 2000;
    const t0 = Date.now();
    const res = await llm.ask(env, { kind: 'live', system: sys, user, maxTokens, dataDir: cwd, log: () => {}, thinking: nothink ? 0 : undefined });
    const ms = Date.now() - t0;
    const p = parseItems(res.text);
    const inTok = res.usage ? res.usage.in : Math.ceil((sys.length + user.length) / 2), outTok = res.usage ? res.usage.out : Math.ceil(String(res.text || '').length / 2);
    if (p.j) {
      const stamp = a => (Array.isArray(a) ? a : []).filter(x => x && typeof x === 'object').map(x => ({ ...x, id: 'r' + (++seq) }));
      state.highlights.push(...stamp(p.j.highlights)); state.todos.push(...stamp(p.j.todos));
      state.factchecks.push(...stamp((p.j.insights || p.j.factchecks || [])).map(x => ({ ...x, claim: x.claim || x.text || '' })));
    }
    const row = { mode, round: r + 1, rows: end - last, ms, inTok, outTok, thinking: res.usage ? (res.usage.thinking || 0) : null, turns: res.usage ? (res.usage.turns || 0) : null, est: !res.usage, ok: p.ok, h: p.h, t: p.t, f: p.f, provider: res.provider || '', model: res.model || '', err: res.errorCode || '', packDelta: pack.delta || 'n/a', packChars: pack.text.length, userChars: user.length, existedChars: existed.length };
    log.push(row); fs.appendFileSync(out + '.jsonl', JSON.stringify({ ts: Date.now(), ...row, raw: String(res.text || '').slice(0, 4000) }) + '\n');
    process.stderr.write(`  ${mode} #${r + 1}/${rounds} ${ms}ms in=${inTok} out=${outTok} think=${row.thinking} turns=${row.turns} h=${p.h} t=${p.t} f=${p.f}${p.ok ? '' : ' (JSON 未解析)'} ${pack.delta || ''}\n`);
    last = end;
  }
  const ok = log.filter(x => !x.err);
  return { mode, calls: log.length, failed: log.length - ok.length, badJson: ok.filter(x => !x.ok).length,
    items: { h: ok.reduce((s, x) => s + x.h, 0), t: ok.reduce((s, x) => s + x.t, 0), f: ok.reduce((s, x) => s + x.f, 0) },
    msMedian: median(ok.map(x => x.ms)), msP90: pct(ok.map(x => x.ms), 0.9), outMedian: median(ok.map(x => x.outTok)), inMedian: median(ok.map(x => x.inTok)),
    thinkMedian: median(ok.map(x => x.thinking || 0)), turnsMax: Math.max(0, ...ok.map(x => x.turns || 0)),
    est: ok.some(x => x.est), packSame: log.filter(x => x.packDelta === 'same').length, log };
}

(async () => {
  const started = new Date().toISOString();
  const groups = group === 'both' ? GROUPS : [group];
  const results = [];
  for (const g of groups) results.push(await runGroup(g));
  const line = r => `| ${r.mode} | ${r.calls}（失败 ${r.failed}，JSON 未解析 ${r.badJson}） | h=${r.items.h} t=${r.items.t} f=${r.items.f}（合 ${r.items.h + r.items.t + r.items.f}） | ${(r.msMedian / 1000).toFixed(1)} s / ${(r.msP90 / 1000).toFixed(1)} s | ${r.outMedian}（思考 ${r.thinkMedian}） | ${r.inMedian} | ${r.packSame} | ${r.turnsMax} |`;
  const text = [
    `# 会中分诊改前 / 改后回放对照（批 5 提速）`,
    `场次 ${sess.id}「${sess.title || ''}」 ${rows.length} 句，切 ${rounds} 轮（每轮 ≈${Math.ceil(rows.length / rounds)} 句）；模型链 ${results[0] && results[0].log[0] ? results[0].log[0].provider + ' / ' + results[0].log[0].model : '?'}；开始 ${started}，结束 ${new Date().toISOString()}`,
    `token 数${results.some(r => r.est) ? '含估算（est）' : '来自 claude -p 的 usage（精确）'}；耗时 = 一次 llm.ask 的墙钟（含 claude -p 冷启动）。`,
    '',
    '| 组 | 调用次数 | 条目数 | 耗时中位 / p90 | 输出 token 中位（其中思考） | 输入 token 中位 | 资料占位轮数 | 最多轮数 |',
    '|---|---|---|---|---|---|---|---|',
    ...results.map(line),
    '',
    '逐轮：', ...results.flatMap(r => r.log.map(x => `${x.mode} #${x.round} ${x.ms}ms in=${x.inTok} out=${x.outTok} think=${x.thinking} turns=${x.turns} h=${x.h} t=${x.t} f=${x.f}${x.ok ? '' : ' JSON未解析'}${x.err ? ' ERR ' + x.err : ''} pack=${x.packDelta}/${x.packChars}字 existed=${x.existedChars}字`)),
    '',
    `原始逐次数据（含模型回文前 4000 字）：${out}.jsonl`,
  ].join('\n');
  fs.writeFileSync(out, text + '\n');
  console.log(text);
})().catch(e => { console.error('回放失败 ' + (e && e.stack || e)); process.exit(1); });
