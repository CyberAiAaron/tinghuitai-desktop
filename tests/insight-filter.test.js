'use strict';
// 洞察门槛（app/insight-filter.js）正反例。Codex b0d361a5 复审：claim 没按 30 字截、source / why 只查了非空没查内容。
const test = require('node:test'), assert = require('node:assert/strict');
const { normalizeInsight, sourceGrounded, whyOk, briefTerms } = require('../app/insight-filter');

const ctx = { brief: '本场是 26191 整机产品定义评审。背景材料：《产品需求总纲》第 3 章、决策板、「定位屋 09-10」。公司：Nothing；供应商：歌尔。', names: ['Shawn Liu', 'Cary Luo', 'Hannah Yin'] };
const ok = (f, c = ctx) => normalizeInsight(f, c);

test('claim 截到 30 字，超过的截断而不是丢', () => {
  const long = '一'.repeat(45);
  const r = ok({ claim: long, source: '决策板 D1', why: '省一次查找' });
  assert.ok(r); assert.equal([...r.claim].length, 30);
});

test('source 正例：本场背景里的文档名 / 章节、名单人名、日期、决策编号、会中时间戳都算具体出处', () => {
  for (const src of ['《产品需求总纲》第 3 章', '产品需求总纲', '定位屋 09-10', '决策板 D1', 'D3 新品类定义', '09-05 推演', '9月5日会议', '2026-09-17 会议', 'Cary Luo 在会上说', 'Hannah 的路标', '会中 [125s]', '会中 12:30 那句', '歌尔的报价单'])
    assert.ok(sourceGrounded(src, ctx), '应当通过：' + src);
});

test('source 反例：只说「项目记忆 / 之前讨论过 / 某文档」这种没有具体出处的整条丢', () => {
  for (const src of ['项目记忆', '之前的会议', '某份文档', '内部资料显示', 'project memory', '大家都知道', ''])
    assert.equal(sourceGrounded(src, ctx), false, '应当拦下：' + src);
  assert.equal(ok({ claim: 'CDCP 已延期', source: '项目记忆', why: '省一次查找' }), null);
});

test('source 里的人名 / 文档名要真的在本场背景或名单里，别的名字不算', () => {
  assert.equal(sourceGrounded('Parker 说的', ctx), false);
  assert.equal(sourceGrounded('《技术架构》第二章', ctx), false, '本场背景没提这份文档');
  assert.equal(sourceGrounded('《技术架构》第二章', { brief: '参考《技术架构》', names: [] }), true);
  assert.equal(sourceGrounded('决策板 D1', { brief: '', names: [] }), true, '决策编号本身就是具体出处，不依赖背景');
});

test('why 正例：含「省 / 不用 / 已 / 已经 / 直接」之一，或 ≥8 字的具体说明', () => {
  for (const w of ['省一次查找', '不用再翻决策板', '这件事 09-05 已经拍过', '直接拿这个数字用', '免得三个人再各自去查一遍这个参数'])
    assert.ok(whyOk(w), '应当通过：' + w);
});

test('why 反例：泛词、太短、含禁词的整条丢', () => {
  for (const w of ['有帮助', '很有帮助', '值得注意', '供参考', '重要', '注意', '相关信息', '很重要。', '有用', '背景信息'])
    assert.equal(whyOk(w), false, '应当拦下：' + w);
  assert.equal(whyOk('对他有用'), false, '4 字、没说省了什么');
  // Codex 94dd3aa4：泛词前后加几个字凑够 8 字也不放（以前只拦整句全等）
  assert.equal(whyOk('这条很有帮助'), false, '泛词片段「很有帮助」加了主语');
  assert.equal(whyOk('对项目很重要'), false, '泛词片段「很重要」加了对象');
  assert.equal(whyOk('这条信息对大家都很有价值'), false, '泛词片段夹在长句里');
  assert.equal(whyOk('这个参数很重要，已经在 D3 拍过'), true, '同一句说清了「已经」拍过就过');
  assert.equal(ok({ claim: 'CDCP 已延期', source: '决策板 D1', why: '值得注意' }), null);
  assert.equal(ok({ claim: 'CDCP 已延期', source: '决策板 D1', why: '建议他去确认一下' }), null, '禁词「建议」');
  assert.equal(ok({ claim: '这条无法核实', source: '决策板 D1', why: '省一次查找' }), null, '禁词在 claim 里');
});

test('三项齐全才留；缺任一项、非对象、空 ctx 下只有编号 / 日期能过', () => {
  assert.equal(ok(null), null); assert.equal(ok('x'), null);
  assert.equal(ok({ claim: 'x', source: 'D1', why: '' }), null);
  assert.equal(ok({ claim: '', source: 'D1', why: '省一次' }), null);
  const r = ok({ claim: 'CDCP 原定 09-22 已延期', source: '决策板 D1', why: '省一次查找', refs: ['D1', 1] }, { brief: '', names: [] });
  assert.deepEqual(r, { kind: 'insight', type: 'answer', claim: 'CDCP 原定 09-22 已延期', source: '决策板 D1', why: '省一次查找', refs: ['D1', '1'], evidence: '', action: { do: 'none', args: {} }, note: '省一次查找', verdict: 'true' });
  assert.equal(ok({ claim: 'CDCP 原定 09-22 已延期', source: '产品需求总纲', why: '省一次查找' }, { brief: '', names: [] }), null, '背景为空时文档名对不上');
});

test('briefTerms：抽书名号 / 引号里的整段和 ≥3 字片段，不带标点', () => {
  const t = briefTerms(ctx.brief);
  assert.ok(t.includes('产品需求总纲') && t.includes('定位屋0910') && t.includes('Nothing') && t.includes('26191'));
  assert.ok(!t.some(x => /[《》「」，。]/.test(x)));
  assert.deepEqual(briefTerms(''), []);
});

// ——— 主动智能批 2：三类 type（需求单 §5.2 / F2）———
const base = { source: '决策板 D1（2026-09-21）', why: '省一次翻决策板', refs: ['D1'], evidence: 'CDCP 就是 22 号评审' };
test('conflict 正例：type + evidence + source + refs 齐 → 留，claim 放宽到 60 字，action 定为 open_source', () => {
  const r = ok({ type: 'conflict', claim: '会上说 CDCP 09-22；决策板 D1（2026-09-21）记的是延期、新日期未定', ...base, action: { do: 'open_source', args: {} } }, { brief: '', names: [] });
  assert.ok(r); assert.equal(r.type, 'conflict'); assert.deepEqual(r.action, { do: 'open_source', args: {} }); assert.equal(r.evidence, 'CDCP 就是 22 号评审');
  assert.ok([...r.claim].length > 30 && [...r.claim].length <= 60, 'conflict 的 claim 不按 30 截：' + [...r.claim].length);
  const r2 = ok({ type: 'conflict', claim: '会上说流失率 4.1%；决策板 D3（09-17）记的是 6.3%', source: '决策板 D3 2026-09-17', refs: ['D3'], evidence: '流失率是 4.1%', why: '不用会后再核', action: { do: 'set_date' } }, { brief: '', names: [] });
  assert.ok(r2); assert.equal(r2.action.do, 'open_source', 'action.do 写错按 type 改回');
  const r3 = ok({ type: 'conflict', claim: 'x'.repeat(70), ...base, evidence: '原'.repeat(50) }, { brief: '', names: [] });
  assert.equal([...r3.claim].length, 60); assert.equal([...r3.evidence].length, 40, 'evidence 截到 40');
});
test('conflict 反例：缺 evidence / 缺 refs / source 没出处 / type 不在三类里 → 整条丢', () => {
  assert.equal(ok({ type: 'conflict', claim: '会上说 A，记录 B', ...base, evidence: '' }, { brief: '', names: [] }), null, '缺 evidence');
  assert.equal(ok({ type: 'conflict', claim: '会上说 A，记录 B', ...base, refs: [] }, { brief: '', names: [] }), null, '缺 refs');
  assert.equal(ok({ type: 'conflict', claim: '会上说 A，记录 B', ...base, refs: ['', null] }, { brief: '', names: [] }), null, 'refs 全空等于缺');
  assert.equal(ok({ type: 'conflict', claim: '会上说 A，记录 B', ...base, source: '项目记忆' }, { brief: '', names: [] }), null, 'source 没具体出处');
  assert.equal(ok({ type: 'warning', claim: '会上说 A，记录 B', ...base }, { brief: '', names: [] }), null, 'type 不在三类');
  assert.equal(ok({ type: 'conflict', claim: '建议核对 CDCP 日期', ...base }, { brief: '', names: [] }), null, '禁词「建议」');
});
test('recheck 正例：source（承诺回查 + 会名日期）+ evidence 齐 → 留，action 定为 set_date', () => {
  const r = ok({ type: 'recheck', claim: '这件事 09-12《硬件例会》已承诺过，记录里没看到落地', source: '承诺回查 硬件例会 2026-09-12', evidence: '供应商那个 demo 我下周再去要', why: '当时是 S1 承诺的，省他翻一遍记录' }, { brief: '', names: [] });
  assert.ok(r); assert.equal(r.type, 'recheck'); assert.deepEqual(r.action, { do: 'set_date', args: {} }); assert.deepEqual(r.refs, []);
  const r2 = ok({ type: 'recheck', claim: '这件事 09-08、09-15《周会》已承诺过两次，记录里没看到落地', source: '承诺回查《周会》09-08 / 09-15', evidence: '这个我回头弄', why: '省他翻两场记录', action: { do: 'none', args: { owner: 'Cary' } } }, { brief: '', names: [] });
  assert.ok(r2); assert.deepEqual(r2.action, { do: 'set_date', args: { owner: 'Cary' } }, 'do 改回 set_date，args 原样留');
});
test('recheck 反例：缺 evidence / source 没日期没会名 / why 空话 → 整条丢', () => {
  assert.equal(ok({ type: 'recheck', claim: '这件事已承诺过', source: '承诺回查 硬件例会 2026-09-12', evidence: '', why: '省他翻记录' }, { brief: '', names: [] }), null, '缺 evidence');
  assert.equal(ok({ type: 'recheck', claim: '这件事已承诺过', source: '承诺回查', evidence: '我回头弄', why: '省他翻记录' }, { brief: '', names: [] }), null, 'source 没日期没会名');
  assert.equal(ok({ type: 'recheck', claim: '这件事已承诺过', source: '承诺回查 硬件例会 2026-09-12', evidence: '我回头弄', why: '值得注意' }, { brief: '', names: [] }), null, 'why 空话');
});
test('answer 正例：现状不变（claim ≤30、source、why），缺 type 按 answer，action 定为 none，evidence 可空', () => {
  const r = ok({ type: 'answer', claim: 'D5 口径以 Cary 成本模型为准', source: '决策板 D5', why: '省一次查找' }, { brief: '', names: [] });
  assert.ok(r); assert.equal(r.type, 'answer'); assert.deepEqual(r.action, { do: 'none', args: {} }); assert.equal(r.evidence, '');
  const r2 = ok({ claim: 'D5 口径以 Cary 成本模型为准', source: '决策板 D5', why: '省一次查找', action: { do: 'open_source' } }, { brief: '', names: [] });
  assert.equal(r2.type, 'answer'); assert.equal(r2.action.do, 'none', '答案类没有按钮');
  assert.equal([...ok({ type: 'answer', claim: '一'.repeat(45), source: '决策板 D5', why: '省一次查找' }, { brief: '', names: [] }).claim].length, 30);
});
test('answer 反例：source 没出处 / why 空话 / claim 含禁词 → 丢（沿用旧门槛）', () => {
  assert.equal(ok({ type: 'answer', claim: 'D5 口径以 Cary 成本模型为准', source: '项目记忆', why: '省一次查找' }, { brief: '', names: [] }), null);
  assert.equal(ok({ type: 'answer', claim: 'D5 口径以 Cary 成本模型为准', source: '决策板 D5', why: '有帮助' }, { brief: '', names: [] }), null);
  assert.equal(ok({ type: 'answer', claim: '这条待核实', source: '决策板 D5', why: '省一次查找' }, { brief: '', names: [] }), null);
});
