'use strict';
// 批 5 提速（app/triage-fast.js + 接线处），正反例：
//   ① 已有条目摘要：只留 id + 前 20 字、非 stale、各最近 20 条
//   ② 输出瘦身规则：只新增 + 字段上限；sweep（门卫开着的定时轮）多一句「只补漏」，门卫触发轮 / 门卫关着都没有
//   ③ 输出上限 700 进 askModel；命令行那条路把它变成 CLAUDE_CODE_MAX_OUTPUT_TOKENS 环境变量（claude 才设，codex / 第三家不设）
//   ④ 门卫窗口：命中句 ±5 + 未分诊增量，去重升序，不越界
//   ⑤ 资料占位：第一次 full，hash 相同 same（占位一行），hash 变了又 full；用量账 stamp 带 contextDelta
//   ⑥ 定时器：gate on → 120 s，off → 25 s；server.js 用的就是这个函数
//   ⑦ 别名：JEV_REALTIME 读成 JEV_GATE（config.aliasJev 与 jev-gate.settingsOf 两处），JEV_GATE 写了以它为准
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..');
const T = require(path.join(root, 'app/triage-fast.js'));
const G = require(path.join(root, 'app/jev-gate.js'));
const CP = require(path.join(root, 'app/context-pack.js'));
const server = fs.readFileSync(path.join(root, 'app/server.js'), 'utf8');

test('① existedSummary：id + 前 20 字，stale 不带，各最近 20 条', () => {
  const long = '这是一条很长很长的要点原文，超过二十个字的部分应该被截掉不要传给模型';
  const s = JSON.parse(T.existedSummary({
    highlights: [{ id: 'h1', text: long }, { id: 'h2', text: '陈旧', stale: true }],
    todos: Array.from({ length: 25 }, (_, i) => ({ id: 't' + i, text: '待办 ' + i })),
    factchecks: [{ id: 'f1', claim: '会上说 CDCP 09-22；决策板记的是延期未定', evidence: '不应出现的字段' }],
  }));
  assert.deepEqual(s.highlights, [{ id: 'h1', text: long.slice(0, 20) }]);
  assert.equal(s.highlights[0].text.length, 20);
  assert.equal(s.todos.length, 20); assert.equal(s.todos[0].id, 't5'); assert.equal(s.todos[19].id, 't24');
  assert.deepEqual(Object.keys(s.factchecks[0]), ['id', 'claim']); assert.equal(s.factchecks[0].claim.length, 20);
  assert.equal(T.existedSummary({}), JSON.stringify({ highlights: [], todos: [], factchecks: [] }), '空会话也给三个空数组');
});

test('② outputRules：只新增 + 上限；sweep 才有「只补漏」；英文 UI 给英文', () => {
  const zh = T.outputRules({ enUI: false, sweep: false });
  assert.match(zh, /只输出【新增】/); assert.match(zh, /text ≤40 字/); assert.match(zh, /why ≤30 字/); assert.match(zh, /evidence 只引原句片段 ≤40 字/);
  assert.doesNotMatch(zh, /兜底轮|只补/);
  const sweep = T.outputRules({ enUI: false, sweep: true });
  assert.match(sweep, /只补上一轮逐句门卫没触发到的遗漏/);
  const en = T.outputRules({ enUI: true, sweep: true });
  assert.match(en, /ONLY new items/); assert.match(en, /Sweep round/); assert.doesNotMatch(en, /只输出/);
});

test('③ 输出上限 700 只走接口路；命令行不设 CLAUDE_CODE_MAX_OUTPUT_TOKENS（超限是整次报错）；分诊关思考走 MAX_THINKING_TOKENS，只给 claude 设', () => {
  assert.equal(T.MAX_OUTPUT_TOKENS, 700);
  assert.match(server, /triageFast\.MAX_OUTPUT_TOKENS, 'live', trace\)/, '分诊 askModel 用常量');
  assert.doesNotMatch(server, /【最新转写】\\n\$\{recent\}\$\{userReminder\}`, 2000/, '2000 那个字面量该没了');
  const cli = fs.readFileSync(path.join(root, 'app/cli-llm.js'), 'utf8');
  assert.doesNotMatch(cli, /CLAUDE_CODE_MAX_OUTPUT_TOKENS:/, '不许给命令行设硬输出上限（09-22 实测 haiku 上限 60：is_error「exceeded the 60 output token maximum」，整次报废）');
  assert.match(cli, /kind === 'claude' && [^\n]*\{ MAX_THINKING_TOKENS: String\(Math\.max\(0, Math\.floor\(Number\(thinking\)\)\)\) \}/, '只有 claude 命令行按 thinking 设 MAX_THINKING_TOKENS');
  const llm = fs.readFileSync(path.join(root, 'app/llm.js'), 'utf8');
  assert.match(llm, /cliLlm\.askDetailed\(p\.kind, user, \{[^}]*thinking \}\)/, 'llm.js 的 cli 适配器把 thinking 传下去');
  assert.match(server, /thinking: triageFast\.liveThinking\(this\.env\)/, '分诊 trace 带 thinking');
  assert.match(server, /thinking: trace \? trace\.thinking : undefined/, 'askModel 把 trace.thinking 递给 llm.ask');
  // liveThinking 的解析：'0' 关；'' / 缺 / 非法 → 不干预；正整数原样
  assert.equal(T.liveThinking({ LLM_LIVE_THINKING: '0' }), 0);
  assert.equal(T.liveThinking({ LLM_LIVE_THINKING: '' }), undefined);
  assert.equal(T.liveThinking({}), undefined);
  assert.equal(T.liveThinking({ LLM_LIVE_THINKING: 'abc' }), undefined);
  assert.equal(T.liveThinking({ LLM_LIVE_THINKING: '-5' }), undefined);
  assert.equal(T.liveThinking({ LLM_LIVE_THINKING: '1024' }), 1024);
  // 用量账：命令行的 usage 多带 thinking / turns，noteUsage 落账
  assert.match(cli, /thinking: Number\(\(u\.output_tokens_details && u\.output_tokens_details\.thinking_tokens\) \|\| 0\)/);
  assert.match(llm, /\{ thinking: u\.thinking \}/);
});

test('④ gateWindow：命中 ±5 ∪ 未分诊增量，升序去重、不越界；没有命中就只剩增量', () => {
  // 转写 0..29，上次分诊到 20，末尾 30；命中在 22 和 3（3 早就分诊过，但 ±5 仍带回来给上下文）
  const w = T.gateWindow({ marks: [{ idx: 22 }, { idx: 3 }], lastTriageIndex: 20, endIndex: 30 });
  assert.deepEqual(w, [0, 1, 2, 3, 4, 5, 6, 7, 8, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
  assert.deepEqual(T.gateWindow({ marks: [], lastTriageIndex: 27, endIndex: 30 }), [27, 28, 29]);
  assert.deepEqual(T.gateWindow({ marks: [{ idx: 40 }], lastTriageIndex: 28, endIndex: 30 }), [28, 29], '下标 ≥ endIndex 的命中不算（这轮没覆盖到）');
  assert.deepEqual(T.gateWindow({ marks: [{ idx: 29 }], lastTriageIndex: 29, endIndex: 30 }), [24, 25, 26, 27, 28, 29], '末句命中：向前 5 句，不越过末尾');
  // 反例：整段 8000 字那条老路是 slice(lastTriageIndex-3, end)，门卫轮必须不是它
  assert.match(server, /\(gate && gateOn\)\s*\?\s*triageFast\.gateWindow\(/, 'server.js 门卫轮走 gateWindow');
});

test('⑤ PackDelta：首次 full，同 hash → 一行占位 + same，hash 变 → 重带 full；stamp 带 contextDelta', () => {
  const d = new T.PackDelta({ enabled: true });
  const pack = { hash: 'abc123', text: '【项目状态】'.padEnd(500, '字'), parts: [{ key: 'project-state', version: 'v1' }] };
  const a = d.apply(pack); assert.equal(a.delta, 'full'); assert.equal(a.text, pack.text);
  const b = d.apply({ ...pack }); assert.equal(b.delta, 'same'); assert.match(b.text, /同上一次分诊/); assert.match(b.text, /abc123/); assert.ok(b.text.length < 80); assert.equal(b.fullChars, 500);
  assert.equal(b.hash, 'abc123', '占位那轮 hash 仍是资料 hash，账本能对上是哪一版');
  const c = d.apply({ ...pack, hash: 'def456', text: '变了' }); assert.equal(c.delta, 'full'); assert.equal(c.text, '变了');
  assert.deepEqual(d.snapshot(), { lastHash: 'def456', full: 2, same: 1 });
  assert.equal(d.apply({ hash: 'x', text: '' }).text, '', '空资料原样过，不算 full 也不算 same');
  assert.deepEqual(CP.stamp(b), { contextHash: 'abc123', contextParts: [{ key: 'project-state', version: 'v1' }], contextDelta: 'same' });
  assert.equal('contextDelta' in CP.stamp(pack), false, '没经过 PackDelta 的调用不带这一列');
  assert.match(server, /this\.packDelta = new triageFast\.PackDelta\(\{ enabled: triageFast\.PackDelta\.enabledIn\(env\) \}\)/);
  // 默认关：不给 enabled / TRIAGE_CONTEXT_DELTA 不是 '1' → 每轮 full、原文不动
  const off = new T.PackDelta(); assert.equal(off.apply(pack).delta, 'full'); const o2 = off.apply({ ...pack }); assert.equal(o2.delta, 'full'); assert.equal(o2.text, pack.text); assert.equal(off.snapshot().same, 0);
  assert.equal(T.PackDelta.enabledIn({}), false); assert.equal(T.PackDelta.enabledIn({ TRIAGE_CONTEXT_DELTA: '0' }), false); assert.equal(T.PackDelta.enabledIn({ TRIAGE_CONTEXT_DELTA: '1' }), true);
  assert.match(fs.readFileSync(path.join(root, 'app/config.js'), 'utf8'), /TRIAGE_CONTEXT_DELTA:'0'/, '默认关'); assert.match(server, /this\.packDelta\.apply\(contextPack\.build\(this\.env, \{ purpose: 'live'/);
});

test('⑥ 定时器：gate on 120 s 兜底、off 25 s；server.js 用它', () => {
  assert.equal(T.triageInterval(true), 120000); assert.equal(T.triageInterval(false), 25000);
  assert.match(server, /setInterval\(\(\) => this\.runTriage\(\), triageFast\.triageInterval\(this\.jev\.enabled\)\)/);
  assert.doesNotMatch(server, /this\.jev\.enabled \? 60000 : 25000/, '旧的 60 s 三元该没了');
  // 兜底轮的提示词：门卫开着且不是门卫触发 → sweep
  assert.match(server, /triageFast\.outputRules\(\{ enUI, sweep: gateOn && !gate \}\)/);
});

test('⑦ JEV_REALTIME 是 JEV_GATE 的别名：config.aliasJev 与 settingsOf 两处；JEV_GATE 写了以它为准', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-alias-'));
  const prev = process.env.THT_DATA_DIR; process.env.THT_DATA_DIR = dir;
  try {
    const cfg = require(path.join(root, 'app/config.js'));
    assert.equal(cfg.aliasJev({ JEV_REALTIME: 'on' }).JEV_GATE, 'on');
    assert.equal(cfg.aliasJev({ JEV_REALTIME: 'on', JEV_GATE: 'off' }).JEV_GATE, 'off', '两个都写以 JEV_GATE 为准');
    assert.equal(cfg.aliasJev({ JEV_GATE: '', JEV_REALTIME: 'on' }).JEV_GATE, 'on', 'JEV_GATE 空串当没写');
    assert.equal(cfg.aliasJev({}).JEV_GATE, undefined, '都没写就不造字段（defaults 兜 off）');
    fs.writeFileSync(cfg.file, JSON.stringify({ RELAY_TOKEN: 'r'.repeat(48), JEV_REALTIME: 'on' }));
    assert.equal(cfg.load().JEV_GATE, 'on', 'load() 读文件时换好');
    assert.match(fs.readFileSync(path.join(root, 'app/config.js'), 'utf8'), /JEV_REALTIME 是 JEV_GATE 的别名/, '文档注释一句');
  } finally { if (prev === undefined) delete process.env.THT_DATA_DIR; else process.env.THT_DATA_DIR = prev; }
  const key = 'k'.repeat(20);
  assert.equal(G.settingsOf({ JEV_REALTIME: 'on', JEV_API_KEY: key }).enabled, true);
  assert.equal(G.settingsOf({ JEV_REALTIME: 'on', JEV_GATE: 'off', JEV_API_KEY: key }).enabled, false, 'JEV_GATE 优先');
  assert.equal(G.settingsOf({ JEV_REALTIME: 'off', JEV_API_KEY: key }).enabled, false);
  assert.equal(G.settingsOf({ JEV_REALTIME: 'on' }).enabled, false, '别名也不能绕过「没密钥不启用」');
});
