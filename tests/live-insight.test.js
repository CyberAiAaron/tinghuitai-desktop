'use strict';
// 会中唯一一种卡（app/live-insight.js + server.js 接线 + 会中页渲染），正反例（Aaron 2026-09-24：「会中我只要 pure insight + action」）：
//   ① 提示词：只出会改变下一句 / 会后动作的东西；复述 / 要点 / 进展汇报不出；每次最多 1 条；sweep 轮多一句只补漏
//   ② 窗口：没分诊过的增量 ∪ 最近 60 秒 ∪ 门卫命中 ±2
//   ③ 解析：新结构、代码围栏、旧结构（highlights → 日志、insights → 洞察）、坏 JSON → null
//   ④ 归一化：字段截断、动作校验、复述型 / 无法核实丢、与已出过的同一件事丢、日志去重封顶 2
//   ⑤ server.js 接线：窗口、提示词、常量、todos 不再自动抽、日志 log:true
//   ⑥ 会中页：live 卡 = insight 加粗 + why 灰 + 最多一个按钮；handoff 只显示；点过后显示结果；要点日志折叠
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const L = require(path.join(root, 'app/live-insight.js'));
const server = fs.readFileSync(path.join(root, 'app/server.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');

test('① 提示词：门槛、不算的、每次最多 1 条、四种 do、sweep 只补漏；英文版同样', () => {
  const zh = L.systemPrompt({ enUI: false });
  for (const s of ['改变 Aaron 下一句该说什么', '每次最多 1 条', '复述别人刚说的话', '要点总结', '进展汇报', '无法核实', 'insight ≤40 字', 'why ≤60 字', 'label ≤8 字', '"do":"ask|todo|note|handoff"', '没有明确动作就不给 action', 'log']) assert.ok(zh.includes(s), 'zh 缺：' + s);
  assert.ok(!zh.includes('补漏'), '非 sweep 轮没有补漏那句');
  assert.ok(L.systemPrompt({ enUI: false, sweep: true }).includes('定时补漏'));
  const en = L.systemPrompt({ enUI: true });
  for (const s of ['At most 1 insight per call', 'restating what was just said', 'ask|todo|note|handoff', 'insight ≤40 chars']) assert.ok(en.includes(s), 'en 缺：' + s);
  const u = L.userPrompt({ packText: '【项目状态】X', brief: '参会：Hannah', existing: ['A 已出过'], log: ['日志 1'], recent: '[10s]S1:你好', gateBlock: '\n\n【门卫标记】\n- decision：x', enUI: false });
  assert.ok(u.indexOf('【项目状态】X') < u.indexOf('【本场背景') && u.indexOf('【已出过的洞察') < u.indexOf('【门卫标记】') && u.indexOf('【门卫标记】') < u.indexOf('【最新转写'), '顺序：资料 → 背景 → 已出过 → 门卫标记 → 转写');
  assert.ok(u.includes('- A 已出过') && u.includes('- 日志 1') && u.includes('[10s]S1:你好'));
  assert.ok(L.userPrompt({ recent: 'x' }).includes('（还没有）'), '没出过洞察时写「还没有」');
});

test('② windowRows：增量 ∪ 最近 60 秒 ∪ 命中 ±2，升序去重不越界', () => {
  const tr = Array.from({ length: 40 }, (_, i) => ({ at: i * 10, text: 't' + i }));   // 每句 10 秒，共 400 秒
  const w = L.windowRows(tr, { endIndex: 40, lastTriageIndex: 38 });
  assert.deepEqual(w, [33, 34, 35, 36, 37, 38, 39], '最后一句 390s，60 秒窗口 = 330s 起（含）+ 增量 38、39');
  assert.deepEqual(L.windowRows(tr, { endIndex: 40, lastTriageIndex: 30 }).slice(0, 2), [30, 31], '增量比 60 秒窗口早时以增量为准');
  assert.deepEqual(L.windowRows(tr, { endIndex: 40, lastTriageIndex: 39, marks: [{ idx: 5 }, { idx: 99 }] }), [3, 4, 5, 6, 7, 33, 34, 35, 36, 37, 38, 39], '命中 ±2 带回来；越界的命中不算');
  assert.deepEqual(L.windowRows(tr, { endIndex: 0 }), []);
  assert.deepEqual(L.windowRows([{ text: 'a' }, { text: 'b' }], { endIndex: 2, lastTriageIndex: 2 }), [0, 1], '没有 at 的行按都在窗口内');
});

test('③ parse：新结构 / 代码围栏 / 旧结构兼容 / 坏 JSON', () => {
  const j = L.parse('```json\n{"insight":{"insight":"A","why":"B","kind":"冲突"},"log":["x","",null]}\n```');
  assert.deepEqual(j, { insight: { insight: 'A', why: 'B', kind: '冲突' }, log: ['x'] });
  assert.deepEqual(L.parse('{"insight":null,"log":[]}'), { insight: null, log: [] });
  const legacy = L.parse('{"highlights":[{"text":"要点 1"}],"todos":[],"insights":[]}');
  assert.deepEqual(legacy, { insight: null, log: ['要点 1'] }, '旧 fake 模型的 highlights 当日志');
  const legacy2 = L.parse('{"insights":[{"claim":"会上说 X；决策板记 Y","why":"省翻决策板","type":"conflict"}]}');
  assert.equal(legacy2.insight.insight, '会上说 X；决策板记 Y'); assert.equal(legacy2.insight.kind, 'conflict');
  assert.equal(L.parse('not json'), null); assert.equal(L.parse(''), null);
  assert.deepEqual(L.parse('前面有话 {"insight":null,"log":["a"]} 后面有话'), { insight: null, log: ['a'] }, '抢救大括号内的 JSON');
});

test('④ normalize：好卡通过、字段截断、动作校验；复述 / 无法核实 / 重复丢；日志去重封顶', () => {
  const ok = L.normalize({ insight: { insight: '会上说屏幕比例照 Mac，决策板 D2 记的是阔屏直板', why: '这会推翻 09-23 决策板 D2 的倾向，他现在该拦一句', kind: '冲突', action: { label: '问一句', do: 'ask', text: '我们是要改 D2 的阔屏直板倾向吗？' } }, log: ['ROI 图片识别失败后要有回滚', 'ROI 图片识别失败后要回滚', '第三条日志内容'] }, { existing: [], logExisting: [] });
  assert.ok(ok.insight); assert.equal(ok.insight.type, 'conflict', '冲突类标 conflict（推送白名单只认它）'); assert.equal(ok.insight.label, '冲突');
  assert.equal(ok.insight.claim, '会上说屏幕比例照 Mac，决策板 D2 记的是阔屏直板'); assert.equal(ok.insight.kind, 'insight'); assert.equal(ok.insight.live, 2);
  assert.deepEqual(ok.insight.action, { do: 'ask', label: '问一句', text: '我们是要改 D2 的阔屏直板倾向吗？', args: {} });
  assert.deepEqual(ok.log, ['ROI 图片识别失败后要有回滚', '第三条日志内容'], '日志：近似的合并，最多 2 条');
  // 截断：insight 40、why 60、label 8
  const long = L.normalize({ insight: { insight: '一'.repeat(50), why: '二'.repeat(70), kind: '一个很长的标签超过六字', action: { label: '这个按钮的名字太长了吧', do: 'todo', text: '三'.repeat(200) } }, log: [] }, {});
  assert.equal([...long.insight.claim].length, 40); assert.equal([...long.insight.why].length, 60); assert.equal([...long.insight.label].length, 6); assert.equal([...long.insight.action.label].length, 8); assert.equal([...long.insight.action.text].length, 160);
  // 动作：do 不在四种里 → 没有动作；缺 label → 默认 label；缺 text → 没有动作
  assert.deepEqual(L.normalize({ insight: { insight: '这是一条足够长的洞察句子', why: 'w', kind: 'k', action: { label: 'x', do: 'open_source', text: 't' } } }, {}).insight.action, { do: 'none', args: {} });
  assert.equal(L.normalize({ insight: { insight: '这是一条足够长的洞察句子', why: 'w', kind: 'k', action: { do: 'todo', text: 'Cary 周五前给回滚方案' } } }, {}).insight.action.label, '加待办');
  assert.equal(L.normalize({ insight: { insight: '这是一条足够长的洞察句子', why: 'w', kind: 'k', action: { do: 'todo', text: 'Cary 周五前给回滚方案' } } }, { enUI: true }).insight.action.label, 'To-do');
  assert.deepEqual(L.normalize({ insight: { insight: '这是一条足够长的洞察句子', why: 'w', kind: 'k', action: { do: 'ask', text: '' } } }, {}).insight.action, { do: 'none', args: {} });
  // 反例
  assert.equal(L.normalize({ insight: { insight: 'Hannah 提到高通路标下月更新', why: 'w', kind: '要点' } }, {}).insight, null, '「XX 提到」是复述不是洞察');
  assert.equal(L.normalize({ insight: { insight: '大家讨论了摄像头触发方式', why: 'w', kind: '要点' } }, {}).insight, null, '「讨论了」是复述');
  assert.equal(L.normalize({ insight: { insight: '这个数字无法核实需要会后确认一下', why: 'w', kind: '存疑' } }, {}).insight, null, '无法核实不出');
  assert.equal(L.normalize({ insight: { insight: '太短', why: 'w', kind: 'k' } }, {}).insight, null, '<6 字不出');
  assert.equal(L.normalize({ insight: { insight: '会上说屏幕比例照 Mac，决策板 D2 记的是阔屏直板', why: 'w', kind: '冲突' } }, { existing: ['会上说屏幕比例照 Mac；决策板 D2 记的是阔屏直板'] }).insight, null, '同一件事换标点不再出');
  assert.equal(L.normalize({ insight: { insight: '会上说屏幕比例照 Mac 做', why: 'w', kind: '冲突' } }, { existing: ['会上说屏幕比例照 Mac 做，决策板 D2 记的是阔屏直板'] }).insight, null, '被已出过的那条包含也算同一件事');
  assert.deepEqual(L.normalize({ insight: null, log: ['已有的一条', '新的一条'] }, { logExisting: ['已有的一条'] }).log, ['新的一条']);
  assert.deepEqual(L.normalize(null, {}), { insight: null, log: [] });
});

test('⑤ server.js 接线：窗口 / 提示词 / 常量 / todos 不自动抽 / 日志 log:true / 门卫轮仍走 gateWindow', () => {
  assert.match(server, /const liveInsight = require\('\.\/live-insight'\)/);
  assert.match(server, /liveInsight\.windowRows\(this\.transcript, \{ endIndex, lastTriageIndex: this\.lastTriageIndex \}\)/);
  assert.match(server, /\(gate && gateOn\)\s*\?\s*triageFast\.gateWindow\(/);
  assert.match(server, /const sys = liveInsight\.systemPrompt\(\{ enUI, sweep: gateOn && !gate \}\)/);
  assert.match(server, /liveInsight\.userPrompt\(\{ packText: pack\.text \+ fbBlock, brief: this\.brief \|\| '', existing, log: logExisting, recent, gateBlock, enUI \}\)/, '项目资料（context-pack purpose=live）+ 已出过的洞察 + 最近转写都进 user prompt');
  assert.match(server, /askModel\(this\.env, sys, user, liveInsight\.MAX_OUTPUT_TOKENS, 'live', trace\)/);
  assert.match(server, /const r = liveInsight\.normalize\(j, \{ existing, logExisting, enUI \}\)/);
  assert.match(server, /highlights: stamp\(r\.log\.map\(text => \(\{ text, log: true \}\)\)\), todos: \[\], factchecks: stamp\(r\.insight \? \[r\.insight\] : \[\]\)/);
  assert.doesNotMatch(server, /【洞察门槛】/, '旧门槛不再进会中分诊');
  // 分诊不给工具：trace.tools=false → askModel → llm.ask → cli-llm args '--tools' ''（09-24 回放实测模型会去 Read 文件，一轮 35 s）
  assert.match(server, /thinking: triageFast\.liveThinking\(this\.env\), tools: false \}/);
  assert.match(server, /tools: trace && trace\.tools === false \? false : undefined/);
  const cli = require(path.join(root, 'app/cli-llm.js'));
  const a = cli.args('claude', { model: 'sonnet', system: 's', tools: false });
  assert.ok(a[a.indexOf('--tools') + 1] === '' && !a.includes('--allowedTools'), 'tools:false → --tools 空、不给 allowedTools');
  const b = cli.args('claude', { model: 'sonnet', system: 's' });
  assert.equal(b[b.indexOf('--tools') + 1], 'Read', '默认仍只留 Read');
  assert.doesNotMatch(server, /triageFast\.existedSummary\(this\)/, '已有条目摘要换成「已出过的洞察」列表');
  assert.equal(L.MAX_OUTPUT_TOKENS <= 400, true, '一条洞察 + 两行日志，输出上限压到 400 以内才快');
});

// 会中页：同 tests/frontend.test.js 的 viewsCtx 取法（从构建产物里切那几段跑在 vm 里）
const code = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
function ctx() {
  const c = { esc: s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])), tt: t => t || '', hms: () => '10:20:00', ui: 'zh', T: () => '', Date };
  vm.createContext(c);
  vm.runInContext(code('  const insightNorm', '  function applyFeedback('), c);
  vm.runInContext(code('  const VIEW_SHOW', '  function viewItemOf('), c);
  c.cur = { id: 's1', threads: {} };
  vm.runInContext(code('  const threadDrafts', '  async function threadSend('), c);
  return c;
}
test('⑥ 会中页：live 卡 = insight 加粗 + why 灰 + 最多一个按钮；handoff 只显示；点过显示结果；旧卡不受影响', () => {
  const c = ctx();
  const card = { id: 'i1', live: 2, type: 'answer', label: '该问', claim: '回滚链路没人认领，Aaron 该现在点名', why: '否则 ROI 识别失败的处理会漏到 PDT KO 之后', at: 120, action: { do: 'ask', label: '问一句', text: '回滚这块谁来出方案？' } };
  const h = c.viewListHtml([card], true);
  assert.ok(h.includes('class="card ck live kind-live'), '走 live 卡');
  assert.ok(h.includes('<b>回滚链路没人认领，Aaron 该现在点名</b>'), 'insight 加粗');
  assert.ok(h.includes('<span class="kind">该问</span>'), 'kind 自由标签');
  assert.ok(h.includes('<div class="v src">否则 ROI 识别失败的处理会漏到 PDT KO 之后</div>'), 'why 一行灰');
  assert.equal((h.match(/<button/g) || []).length, 1, '只有一个按钮（对话框输入不算）'.replace('（对话框输入不算）', '') || true);
  assert.ok(/class="btn sm live-act" type="button" data-do="ask"/.test(h), '按钮 do=ask');
  assert.ok(!h.includes('insight-act'), '不走旧的 insight-action 按钮');
  // 点过（liveDone）→ 显示「你可以问」，按钮消失
  const asked = c.viewListHtml([{ ...card, liveDone: { do: 'ask', copied: true } }], true);
  assert.ok(asked.includes('你可以问：回滚这块谁来出方案？（已复制）') && !asked.includes('live-act'));
  const todo = c.viewListHtml([{ ...card, action: { do: 'todo', label: '加待办', text: 'Cary 周五前出回滚方案' }, liveDone: { do: 'todo' } }], true);
  assert.ok(todo.includes('已加待办：Cary 周五前出回滚方案'));
  // handoff：只显示，按钮禁用
  const ho = c.viewListHtml([{ ...card, action: { do: 'handoff', label: '交给人', text: '交给 Cary 出回滚方案' } }], true);
  assert.ok(/live-act" type="button" data-do="handoff" disabled/.test(ho) && ho.includes('交给 Cary 出回滚方案'));
  // 没动作 → 没按钮；冲突类 → kind-conflict（红条沿用）
  const none = c.viewListHtml([{ ...card, type: 'conflict', action: { do: 'none', args: {} } }], true);
  assert.ok(none.includes('kind-conflict') && !none.includes('<button'));
  // 旧洞察卡（0.6.14 三类）照旧渲染
  const old = c.viewListHtml([{ id: 'o1', type: 'conflict', claim: '会上说 CDCP 09-22；决策板记延期未定', source: '决策板 D1', why: '省一次翻决策板', evidence: 'CDCP 就是 22 号评审', action: { do: 'open_source', args: {} } }], true);
  assert.ok(old.includes('class="card ck kind-conflict') && old.includes('insight-act') && !old.includes('card ck live'));
  // 要点日志：折叠、带条数、最多 40 行
  const log = c.hlLogHtml(Array.from({ length: 45 }, (_, i) => ({ text: '要点 ' + i, at: i, log: true })));
  assert.ok(log.startsWith('<details class="hl-log"><summary>要点日志 <span class="count">45</span></summary>'));
  assert.equal((log.match(/hl-log-row/g) || []).length, 40); assert.ok(log.includes('要点 44') && !log.includes('要点 4<'));
  assert.equal(c.hlLogHtml([]), '');
  // 按钮处理器在构建产物里：todo 走本场待办 + 收进工作台；ask 复制剪贴板
  assert.ok(html.includes("button.live-act") && html.includes("cur.todos.push({id:'m'+at,at,text,owner:") && html.includes("navigator.clipboard.writeText(text)") && html.includes("hubAPI('session',{session:cur})"));
  assert.ok(html.includes('viewListHtml(cks, first) + hlLogHtml(cur.highlights)'), '要点日志挂在看法栏底部');
});
