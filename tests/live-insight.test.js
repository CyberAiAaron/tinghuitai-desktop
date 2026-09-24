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
const replay = fs.readFileSync(path.join(root, 'scripts/replay-insight.js'), 'utf8');

test('① 提示词：自由 markdown、没有模板、NONE、≤120 字、@人名 约定、sweep 只补漏；英文版同样', () => {
  const zh = L.systemPrompt({ enUI: false });
  for (const s of ['自由 markdown', '没有模板', '不要「洞察 / 原因 / 行动」这种表头', '≤120 字', '`@人名：` 开头的一行', 'NONE', '不要 JSON']) assert.ok(zh.includes(s), 'zh 缺：' + s);
  assert.ok(!/"do"|ask\|todo\|note\|handoff|insight ≤40 字/.test(zh), '旧的 JSON schema 不该再出现');
  assert.ok(!zh.includes('补漏'), '非 sweep 轮没有补漏那句');
  assert.ok(L.systemPrompt({ enUI: false, sweep: true }).includes('定时补漏'));
  const en = L.systemPrompt({ enUI: true });
  for (const s of ['free Markdown', 'no template', 'output exactly: NONE', '`@<name>:`']) assert.ok(en.includes(s), 'en 缺：' + s);
  const u = L.userPrompt({ packText: '【项目状态】X', brief: '参会：Hannah', existing: ['A 已说过'], recent: '[10s]S1:你好', gateBlock: '\n\n【门卫标记】\n- decision：x', enUI: false });
  assert.ok(u.indexOf('【项目状态】X') < u.indexOf('【本场背景') && u.indexOf('【已经说过的') < u.indexOf('【门卫标记】') && u.indexOf('【门卫标记】') < u.indexOf('【最新转写'), '顺序：资料 → 背景 → 已说过 → 门卫标记 → 转写');
  assert.ok(u.includes('- A 已说过') && u.includes('[10s]S1:你好'));
  assert.ok(L.userPrompt({ recent: 'x' }).includes('（还没有）'), '还没说过时写「还没有」');
});

test('回放报告：按 10 分钟统计节奏、正文字符分布、@人名行动数，并原样输出 10 张代表卡', () => {
  assert.match(replay, /Math\.floor\(\(Number\(at\) \|\| 0\) \/ 600\)/, '10 分钟桶');
  assert.match(replay, /charStats:\s*\{ min:.*median:.*p90:.*max:/s, '字符分布');
  assert.match(replay, /withAssignee:/, '@人名行动数');
  assert.match(replay, /representative\(state\.factchecks, 10\)/, '固定抽 10 张代表卡');
  assert.match(replay, /'## 10 张代表卡片原文'/);
  assert.match(replay, /x\.md/, '报告保留卡片完整 markdown');
  assert.doesNotMatch(replay, /rawInsight: parsed && parsed\.insight/, '不再依赖旧 JSON insight 字段');
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

test('③ parse：整段 markdown 原样回；代码围栏 / NONE / 旧 JSON 兼容；空输入 null', () => {
  assert.deepEqual(L.parse('回滚链路没人认领。\n\n@Abel Mei：周五前给方案'), { md: '回滚链路没人认领。\n\n@Abel Mei：周五前给方案' });
  assert.deepEqual(L.parse('```markdown\n**结论**在这\n```'), { md: '**结论**在这' }, '去代码围栏');
  assert.deepEqual(L.parse('NONE'), { md: '' }); assert.deepEqual(L.parse('none.'), { md: '' });
  assert.equal(L.parse(''), null); assert.equal(L.parse(null), null);
  assert.deepEqual(L.parse('{"insight":{"insight":"会上说 X，决策板记 Y","why":"省翻决策板"},"log":[]}'), { md: '会上说 X，决策板记 Y\n\n省翻决策板' }, '旧 JSON 抽正文当 markdown');
  assert.deepEqual(L.parse('{"insight":null}'), { md: '' });
});

test('④ normalize：markdown 原样当正文、claim 取第一行、@人名 出动作；复述 / 无法核实 / 太短 / 重复丢；超长截断', () => {
  const md = '屏幕比例照 Mac 会和决策板 D2 的阔屏直板打架。\n\n@Abel Mei：今天把 D2 的倾向确认掉';
  const ok = L.normalize({ md }, { existing: [] });
  assert.equal(ok.insight.md, md, '整段 markdown 就是卡片正文');
  assert.equal(ok.insight.claim, '屏幕比例照 Mac 会和决策板 D2 的阔屏直板打架。', 'claim = 第一行纯文本');
  assert.equal(ok.insight.type, 'conflict', '正文里有「打架」→ conflict（推送白名单只认它）');
  assert.equal(ok.insight.kind, 'insight'); assert.equal(ok.insight.live, 2);
  assert.deepEqual(ok.insight.action, { do: 'handoff', who: 'Abel Mei', label: '交给人', text: '交给 Abel Mei：今天把 D2 的倾向确认掉', args: { person: 'Abel Mei' } });
  assert.deepEqual(ok.log, [], '要点日志这一栏没有了');
  // markdown 标记不影响第一行取值 / 指派行识别
  const b = L.normalize({ md: '## 先看这一条\n- **@Hannah Yin：** 把高通路标的日期定下来' }, {});
  assert.equal(b.insight.claim, '先看这一条');
  assert.equal(b.insight.action.who, 'Hannah Yin');
  // 没有 @ 行 → 没有动作
  assert.deepEqual(L.normalize({ md: '这一条只是判断，没有要谁做什么' }, {}).insight.action, { do: 'none', args: {} });
  // 超长截断到 MD_MAX
  const long = L.normalize({ md: '一'.repeat(600) }, {});
  assert.equal([...long.insight.md].length, L.MD_MAX + 1, '截到 MD_MAX 再加一个省略号');
  // 反例
  assert.equal(L.normalize({ md: '' }, {}).insight, null);
  assert.equal(L.normalize({ md: 'Hannah 提到高通路标下月更新' }, {}).insight, null, '「XX 提到」是复述不是想法');
  assert.equal(L.normalize({ md: '大家讨论了摄像头触发方式' }, {}).insight, null, '「讨论了」是复述');
  assert.equal(L.normalize({ md: '这个数字无法核实需要会后确认一下' }, {}).insight, null, '无法核实不出');
  assert.equal(L.normalize({ md: '太短' }, {}).insight, null, '<6 字不出');
  assert.equal(L.normalize({ md: '屏幕比例照 Mac 会和决策板 D2 的阔屏直板打架。' }, { existing: ['屏幕比例照 Mac；会和决策板 D2 的阔屏直板打架'] }).insight, null, '同一件事换标点不再出');
  assert.deepEqual(L.normalize(null, {}), { insight: null, log: [] });
});

test('冷却：出卡后 5 分钟内不再触发，NONE 不启动，冷却期满恢复（Aaron 2026-09-24）', () => {
  assert.equal(L.CARD_COOLDOWN_MS, 5 * 60 * 1000);
  assert.equal(L.inCooldown(0), false, '还没出过卡（lastCardAt=0）→ 第一张卡立即出，不冷却');
  assert.equal(L.inCooldown(undefined), false);
  const now = 1_700_000_000_000;
  assert.equal(L.inCooldown(now - 1000, now), true, '1 秒前刚出过卡 → 冷却中');
  assert.equal(L.inCooldown(now - 4 * 60 * 1000, now), true, '4 分钟 → 仍在冷却');
  assert.equal(L.inCooldown(now - 5 * 60 * 1000 + 1, now), true, '差 1ms 未满 5 分钟 → 仍冷却');
  assert.equal(L.inCooldown(now - 5 * 60 * 1000, now), false, '整 5 分钟 → 冷却期满，恢复触发');
  assert.equal(L.inCooldown(now - 10 * 60 * 1000, now), false, '早就过了 5 分钟 → 不冷却');
});

test('burst 上限：滚动 10 分钟已出 2 张就拦下一张，跟 5 分钟冷却各管各的（Codex 审计 2026-09-24：生产默认口径重放峰值到 5 张/10min）', () => {
  assert.equal(L.CARD_BURST_LIMIT, 2);
  assert.equal(L.CARD_BURST_WINDOW_MS, 10 * 60 * 1000);
  const now = 1_700_000_000_000;
  assert.equal(L.overBurstCap([], now), false, '还没出过卡不拦');
  assert.equal(L.overBurstCap([now - 9 * 60 * 1000], now), false, '窗口内只有 1 张，还没到上限');
  assert.equal(L.overBurstCap([now - 9 * 60 * 1000, now - 1 * 60 * 1000], now), true, '窗口内已有 2 张，第 3 张被拦');
  assert.equal(L.overBurstCap([now - 11 * 60 * 1000, now - 9 * 60 * 1000], now), false, '11 分钟前那张已滚出窗口，只算窗口内 1 张');
  assert.equal(L.overBurstCap([now - 10 * 60 * 1000, now - 1000], now), false, '差 1ms 满 10 分钟的那张已滚出窗口边界');
});

test('⑤b server.js 接线：冷却检查在推进游标之前 return，增量不丢；只有真出卡（r.insight 非空）才启动冷却，NONE 不启动', () => {
  const runTriageSrc = server.slice(server.indexOf('async runTriage(opts)'), server.indexOf('async runTriageBody(gate)'));
  assert.match(runTriageSrc, /if \(liveInsight\.inCooldown\(this\.lastCardAt\)\) return;/, 'runTriage 里冷却直接 return，不调用 runTriageBody');
  // 冷却检查必须在「推进 lastTriageIndex / charsSinceTriage」之前 —— runTriage 本身不推进游标（只有 runTriageBody 推进），
  // 所以冷却期间反复调用 runTriage 都不会动 lastTriageIndex，下一次窗口会把这段时间的转写整段带上（windowRows 的增量 ∪ 见②）。
  assert.doesNotMatch(runTriageSrc, /this\.lastTriageIndex\s*=/, 'runTriage 本身不推进游标，冷却期的增量原样保留给下一次');
  assert.match(server, /if \(r\.insight\) \{ this\.lastCardAt = Date\.now\(\); this\.cardTimes\.push\(this\.lastCardAt\);/, '只有真出卡（insight 非空）才记录出卡时间/入 burst 窗口，启动冷却');
  assert.match(server, /this\.cardTimes\.push\(this\.lastCardAt\);[^\n]*\/\/[^\n]*NONE/, '注释里说明 NONE 不启动冷却（旁证：normalize 对 NONE 返回 insight:null，见③④）');
  // this.lastCardAt / this.cardTimes 初始化（第一张卡不受冷却和 burst 限制）
  assert.match(server, /this\.lastCardAt = 0;/);
  assert.match(server, /this\.cardTimes = \[\];/);
  // burst 上限也在冷却检查同一处查，跟 5 分钟冷却各管各的（Codex 审计 2026-09-24）
  assert.match(runTriageSrc, /if \(liveInsight\.overBurstCap\(this\.cardTimes, Date\.now\(\)\)\) return;/, 'runTriage 里 burst 上限直接 return');
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
