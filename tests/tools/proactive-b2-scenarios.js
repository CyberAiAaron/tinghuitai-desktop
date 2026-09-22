#!/usr/bin/env node
'use strict';
// 主动智能批 2 · 真实模型合成 5 场景（需求单 §6 批 2 验收）。不是单测：真的调一次 live 档模型（app/llm.js → app/cli-llm.js，
// 生产同一条链：LLM_PROVIDER=claude → 命令行 claude、模型 sonnet），每场景 1 次，共 5 次。
//   1 recheck 正例：沉淀里 09-12《硬件例会》有 [承诺]，本场又说「下周再去要」→ 出 recheck 卡
//   2 已做完不出：本场说「上周已经要到了」→ 不出 recheck
//   3 相近不出：沉淀是「demo 录屏」，本场说「报价单我回头催」→ 不出 recheck
//   4 截止未到不出：沉淀那条标了「（截止未到）」→ 不出 recheck
//   5 conflict 正例：会上说「CDCP 就是 22 号评审」，决策板 / 项目状态记「延期、新日期未定」→ 出 conflict 卡，带 evidence + refs
// 输入 = 合成转写 + 合成资料包（不读 Aaron 的真实 kb_backup / memory.db；用量账写到 --out 目录，不碰生产 state/usage.jsonl）。
// 用法：node tests/tools/proactive-b2-scenarios.js --out <目录>   结果落 <目录>/proactive-b2-scenarios.txt，退出码 = 未过场景数
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const llm = require(path.join(ROOT, 'app', 'llm'));
const ops = require(path.join(ROOT, 'app', 'memory-ops'));
const { normalizeInsight } = require(path.join(ROOT, 'app', 'insight-filter'));

const argv = process.argv.slice(2); const oi = argv.indexOf('--out');
const OUT = oi >= 0 ? path.resolve(argv[oi + 1]) : path.join(ROOT, '.tmp', 'proactive-b2');
fs.mkdirSync(OUT, { recursive: true });
const ENV = { LLM_PROVIDER: process.env.THT_SCENARIO_PROVIDER || 'claude', RELAY_TOKEN: 'x' };   // 与生产 settings 同一条链；不读生产 settings.json
const TIMEOUT = 180000;

// 与 app/server.js runTriageBody 同一套拼法：langHead + 背景 + TRIAGE（从构建产物抠）+ 洞察门槛 + langTail；user = 资料包 + 已有条目 + 最新转写
function triagePrompt() { const s = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8'); const m = s.match(/const\s+TRIAGE\s*=\s*([`"'])([\s\S]*?)\1/); if (!m) throw new Error('index.html 里没有 TRIAGE'); return m[2]; }
function gateLine() { const s = fs.readFileSync(path.join(ROOT, 'app', 'server.js'), 'utf8'); const m = s.match(/'\\n(【洞察门槛】[^']*)'/); if (!m) throw new Error('server.js 里没有【洞察门槛】'); return '\n' + m[1]; }
const BRIEF = '【本场背景（人名/公司/网站，判断时以此为准）】\n26191 Chansey 硬件周会。参会：Aaron Wang、Cary Luo、Abel Mei。S1 = Cary Luo，S2 = Abel Mei。\n\n';
const SYS = '所有 text / claim / note 字段一律用中文输出。冲突项的 text 以「⚠️ 冲突：」开头。\n' + BRIEF + triagePrompt() + gateLine() + '\n\n【输出语言】所有 text/claim/note 一律中文。';

const STATE = '【项目状态（凝练版，看法以此为准）】\n26191（Chansey）AI Phone。CDCP（概念决策评审点）原定 2026-09-22，2026-09-17 起延期、新日期未定（Aaron 口述）；PDT KO 2026-11-17 不变。D1（Pin 与手机绑定）卡 D2/D6/D7，D3（新品类定义）卡 D4/D8。';
const BOARD = '\n\n【决策板当前口径（D1–D8 各一行，来自飞书夜间导出；「对不上」只对照这里和项目状态里有具体数字 / 日期的记录）】\n决策板导出 2026-09-21（v1.2 ｜ 2026-09-17）\n'
  + 'D1 Pin 与手机的绑定关系：B：Pin 退出 KO 转预研，手机先行｜期限 CDCP 延期、新日期未定（09-17 Aaron 口述）｜状态 [倾向→定]\n'
  + 'D2 整机形态与屏幕：阔屏直板 [倾向]；尺寸比例做多比例模型后锁｜期限 CDCP 延期、新日期未定｜状态 [倾向]\n'
  + 'D3 新品类定义与对外 message：三候选（09-05），推荐①「不用喂的 AI」｜期限 CDCP 延期、新日期未定｜状态 [倾向]\n'
  + 'D5 BOM 口径统一：指定 Cary 成本模型为唯一口径｜期限 CDCP 延期、新日期未定｜状态 [待定]\n'
  + 'D6 无线充电规格：15W 首发、预留 25W；结构优先内置磁吸｜期限 09-05 前会前拍掉｜状态 [倾向] 自 08-21 挂起';
const promise = (text, extra = {}) => ({ kind: 'promise', text, owner: 'Cary Luo', meeting_title: '硬件例会', recorded_at: '2026-09-12T02:00:00.000Z', ...extra });
const EXISTED = JSON.stringify({ highlights: [], todos: [], factchecks: [] });
const ictx = { brief: BRIEF, names: ['Aaron Wang', 'Cary Luo', 'Abel Mei'] };

const SCENARIOS = [
  { n: 1, name: 'recheck 正例：09-12 承诺过 demo 录屏，本场又说下周再去要 → 出 recheck 卡',
    cards: [promise('向供应商索要 demo 录屏')],
    transcript: '[120s]S1:供应商那个 demo 录屏我下周再去要一下。\n[126s]S2:行，那 D6 的磁极环可行性我这边继续看。',
    expect: ins => ins.some(x => x.type === 'recheck' && /09-12|9 月 12 日|9月12日/.test(x.claim) && x.evidence) },
  { n: 2, name: '已做完不出：本场说上周已经要到了 → 不出 recheck',
    cards: [promise('向供应商索要 demo 录屏')],
    transcript: '[120s]S1:供应商的 demo 录屏我上周已经要到了，发在群里了，大家可以看。\n[128s]S2:看到了，清晰度还行。',
    expect: ins => !ins.some(x => x.type === 'recheck') },
  { n: 3, name: '相近不出：沉淀是 demo 录屏，本场说报价单回头催 → 不出 recheck',
    cards: [promise('向供应商索要 demo 录屏')],
    transcript: '[120s]S1:供应商的报价单我回头去催一下。\n[125s]S2:好。',
    expect: ins => !ins.some(x => x.type === 'recheck') },
  { n: 4, name: '截止未到不出：沉淀那条标了（截止未到）→ 不出 recheck',
    cards: [promise('把 BOM 成本表发给 Abel', { due: '2099-01-15' })],
    transcript: '[120s]S1:BOM 那个成本表我回头发给 Abel。\n[124s]S2:好，我等着。',
    expect: ins => !ins.some(x => x.type === 'recheck') },
  { n: 5, name: 'conflict 正例：会上说 CDCP 就是 22 号评审，决策板 / 项目状态记延期未定 → 出 conflict 卡带 evidence + refs',
    cards: [],
    transcript: '[200s]S2:CDCP 就是 22 号评审，大家把材料准备好。\n[207s]S1:那 D1 的三条前提这周要收口。',
    expect: ins => ins.some(x => x.type === 'conflict' && /CDCP/.test(x.claim) && /延期|未定/.test(x.claim) && x.evidence && x.refs.length && x.action.do === 'open_source') },
];

(async () => {
  const lines = [], t0 = Date.now(); let fails = 0;
  lines.push(`# 主动智能批 2 · 真实模型 5 场景 · ${new Date().toISOString()} · chain=${ENV.LLM_PROVIDER} kind=live`);
  for (const sc of SCENARIOS) {
    const user = `${STATE}${BOARD}${ops.toPromptBlock(sc.cards)}\n\n【已有条目】${EXISTED}\n\n【最新转写】\n${sc.transcript}`;
    const t = Date.now();
    const r = await llm.ask(ENV, { kind: 'live', system: SYS, user, maxTokens: 2000, dataDir: OUT, timeoutMs: TIMEOUT, log: m => lines.push('  · ' + m) });
    const ms = Date.now() - t;
    let j = null, raw = r.text || '';
    try { j = JSON.parse(raw.replace(/^```json?|```$/g, '').trim()); } catch (e) { j = null; }
    const rawIns = (j && Array.isArray(j.insights)) ? j.insights : [];
    const ins = rawIns.map(f => normalizeInsight(f, ictx)).filter(Boolean).slice(0, 2);
    const ok = !!r.text && !!j && sc.expect(ins);
    if (!ok) fails++;
    lines.push(`${ok ? '通过' : '未过'} 场景${sc.n}｜${sc.name}｜${ms}ms｜model=${r.model || '-'}｜模型给 ${rawIns.length} 条 → 门槛后 ${ins.length} 条${r.text ? '' : '｜模型没回应：' + r.errorCode}`);
    for (const x of ins) lines.push(`    → [${x.type}] ${x.claim}｜source=${x.source}｜refs=${JSON.stringify(x.refs)}｜evidence=${x.evidence}｜action=${x.action.do}`);
    for (const x of rawIns) if (!ins.find(y => y.claim === String(x.claim || '').slice(0, 60))) lines.push(`    ✗ 被门槛丢弃: ${JSON.stringify(x).slice(0, 200)}`);
    if (!j && r.text) lines.push('    模型原文（非 JSON）: ' + raw.slice(0, 300).replace(/\n/g, ' '));
    fs.writeFileSync(path.join(OUT, `scenario-${sc.n}.raw.txt`), `=== SYSTEM ===\n${SYS}\n=== USER ===\n${user}\n=== RAW ===\n${raw}`);
  }
  lines.push(`# 合计 ${SCENARIOS.length - fails}/${SCENARIOS.length} 通过 · ${Math.round((Date.now() - t0) / 1000)} 秒 · 每场景原文在 ${OUT}/scenario-N.raw.txt · 用量账 ${OUT}/state/usage.jsonl`);
  fs.writeFileSync(path.join(OUT, 'proactive-b2-scenarios.txt'), lines.join('\n') + '\n');
  console.log(lines.filter(l => /^(通过|未过|#)/.test(l)).join('\n'));
  process.exit(fails);
})().catch(e => { console.error('脚本异常：' + e.message); process.exit(9); });
