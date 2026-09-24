// 会后页议题表（Aaron 09-24 13:58 批「议题改表」）：五列 议题 / 结论 / 状态 / 未对齐 / 下一步，一行一句话，空就不渲染。
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const js = fs.readFileSync(path.join(__dirname, '..', 'web/archive.js'), 'utf8');
const pick = re => { const m = re.exec(js); assert.ok(m, '没找到 ' + re); return m[0]; };
const src = [pick(/const DEC=\[[^\n]+/), pick(/const decOf=[^\n]+/), pick(/function oneLine\(x\)\{[^\n]+\}/),
  js.slice(js.indexOf('function topicRows(b){'), js.indexOf('\n', js.indexOf('.filter(r=>r.title);}')) + 1)].join('\n');
const { topicRows, oneLine } = new Function(src + '\nreturn {topicRows,oneLine};')();
const brief = {
  overview: { topics: [{ n: 1, title: '定价' }, { n: 2, title: 'Pin 绑定' }, { n: 3, title: '排期' }],
    todos: [{ what: '出成本表', owner: 'Cary', topic: 1 }, { what: '约 ID 评审', owner: '', topic: 2 }] },
  topics: [{ n: 1, conclusion: '先按 299 美元测。后面再谈渠道。', decision: '已一致', open: [] },
    { n: 2, conclusion: '未形成结论', decision: '有分歧', open: ['是否强绑定', '备用方案'] },
    { n: 3, conclusion: '', decision: '胡说', open: [] }],
  decisions: { '3': '搁置' },
};
test('五列取自已有 brief：结论、状态、未对齐、下一步（按议题归属的待办）', () => {
  const r = topicRows(brief);
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], { n: 1, title: '定价', conclusion: '先按 299 美元测。后面再谈渠道。', status: '已一致', open: '', next: '出成本表（Cary）' });
  assert.equal(r[1].conclusion, '', '「未形成结论」显示成空格');
  assert.equal(r[1].status, '有分歧');
  assert.equal(r[1].open, '是否强绑定；备用方案');
  assert.equal(r[1].next, '约 ID 评审');
  assert.equal(r[2].status, '搁置', '人手改过的状态压过模型');
});
test('状态只有四个取值，模型给了别的落到待讨论', () => {
  const r = topicRows({ overview: { topics: [{ n: 1, title: 'x' }] }, topics: [{ n: 1, decision: '已决定' }] });
  assert.equal(r[0].status, '待讨论');
  for (const x of topicRows(brief)) assert.ok(['已一致', '待讨论', '有分歧', '搁置'].includes(x.status));
});
test('空就不渲染：没有议题返回空数组，页面按 rows.length 决定整节出不出', () => {
  assert.deepEqual(topicRows({ overview: { topics: [] } }), []);
  assert.deepEqual(topicRows({}), []);
  assert.match(js, /\(rows\.length\?'<section class="fs">/);
});
test('每格一句话：取第一句、超 40 字截断', () => {
  assert.equal(oneLine('先按 299 美元测。后面再谈渠道。'), '先按 299 美元测');
  assert.equal(oneLine('甲'.repeat(60)).length, 40);
  assert.equal(oneLine(''), '');
});
test('表头是这五列，旧的详细议题卡片不再渲染', () => {
  for (const h of ["T('议题','Topic')", "T('结论','Conclusion')", "T('状态','Status')", "T('未对齐','Open')", "T('下一步','Next')"]) assert.ok(js.includes(h), h);
  assert.ok(!js.includes('bf-detail') && !js.includes('class="bf-card"'), '详细议题展开块要移除');
});

// ===== 主页面（v2 会后页）：服务端算好 minutes.topicTable，前端只渲染 =====
const V2 = require('../app/archive-v2');
const v2js = fs.readFileSync(path.join(__dirname, '..', 'web/archive-v2.js'), 'utf8');
test('v2：buildView 产出 minutes.topicTable，五列一句话、状态四选一、人手改的状态优先', () => {
  const v = V2.buildView({ brief: brief, summary: '' });
  assert.deepEqual(v.minutes.topicTable.map(r => [r.title, r.conclusion, r.status, r.open, r.next]), [
    ['定价', '先按 299 美元测', '已一致', '', '出成本表（Cary）'],
    ['Pin 绑定', '', '有分歧', '是否强绑定', '约 ID 评审'],
    ['排期', '', '搁置', '', ''],
  ]);
  for (const r of v.minutes.topicTable) assert.ok(V2.TOPIC_STATUS.includes(r.status));
  assert.equal(V2.topicTable({ overview: { topics: [{ n: 1, title: 'x' }] }, topics: [{ n: 1, decision: '拍板' }] })[0].status, '待讨论');
});
test('v2：没有议题就是空表，页面整块不渲染；旧的「各议题」展开列表不再出现', () => {
  assert.deepEqual(V2.buildView({ brief: {}, summary: '## 定位\n**结论**\n定了。' }).minutes.topicTable, []);
  assert.match(v2js, /\(\(m\.topicTable\|\|\[\]\)\.length\?'<h3>议题<\/h3>/);
  assert.ok(!v2js.includes("'<h3>各议题</h3>"), '各议题列表要移除渲染');
  for (const h of ['<th>议题</th>', '<th>结论</th>', '<th>状态</th>', '<th>未对齐</th>', '<th>下一步</th>']) assert.ok(v2js.includes(h), h);
});
test('v2：复制纪要的 Markdown 也是五列表，单元格里的竖线被转义', () => {
  assert.match(v2js, /\| 议题 \| 结论 \| 状态 \| 未对齐 \| 下一步 \|/);
  assert.match(v2js, /replace\(\/\\\|\/g,'／'\)/);
});
