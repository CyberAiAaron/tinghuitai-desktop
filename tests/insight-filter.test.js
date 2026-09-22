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
  assert.deepEqual(r, { kind: 'insight', claim: 'CDCP 原定 09-22 已延期', source: '决策板 D1', why: '省一次查找', refs: ['D1', '1'], note: '省一次查找', verdict: 'true' });
  assert.equal(ok({ claim: 'CDCP 原定 09-22 已延期', source: '产品需求总纲', why: '省一次查找' }, { brief: '', names: [] }), null, '背景为空时文档名对不上');
});

test('briefTerms：抽书名号 / 引号里的整段和 ≥3 字片段，不带标点', () => {
  const t = briefTerms(ctx.brief);
  assert.ok(t.includes('产品需求总纲') && t.includes('定位屋0910') && t.includes('Nothing') && t.includes('26191'));
  assert.ok(!t.some(x => /[《》「」，。]/.test(x)));
  assert.deepEqual(briefTerms(''), []);
});
