const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const md = require('../app/memory-diff');
const T = md.__test;

const STATE = ['# Chansey 项目状态（凝练版）', 'Last updated: 2026-09-01 ｜ x', '', '## 2. 已定的事', '- 旧决定一', '', '## 5. 技术评估', '- 像素倾向 12MP', '', '## 8b. 当前未定项与口径差', '- Pin 摄像头留不留', '', '## 9. 术语表', '- 无'].join('\n');

test('记忆差异：解析带解释的 JSON、节名兜底、拒绝指纹过滤、最多 8 条、状态永远待确认', () => {
  const raw = '好的，结果如下：\n{"updates":[' +
    '{"type":"changed_fact","section":"## 5. 技术评估","field":"像素","before":"像素倾向 12MP","after":"OCR 输入按 ROI 后尺寸定，72 万像素是下限","evidence":"720P 大概几十万像素","level":"discussed","confidence":"high"},' +
    '{"type":"xxx","section":"不存在的节","field":"","after":"横屏概念机加两个副屏","level":"proposed"},' +
    '{"type":"risk","after":"短"},' +
    '{"type":"changed_fact","section":"## 5. 技术评估","field":"像素","after":"OCR 输入按 ROI 后尺寸定，72 万像素是下限"}' +
    ']}\n以上。';
  const items = T.parse(raw);
  assert.strictEqual(items.length, 4);
  const secs = T.sections(STATE);
  assert.deepStrictEqual(secs, ['## 2. 已定的事', '## 5. 技术评估', '## 8b. 当前未定项与口径差', '## 9. 术语表']);
  const out = T.normalize(items, secs);
  assert.strictEqual(out.length, 2, '短的丢、重复的丢');
  assert.strictEqual(out[0].section, '## 5. 技术评估');
  assert.strictEqual(out[1].type, 'new_fact', '未知类型兜底');
  assert.strictEqual(out[1].section, '## 8b. 当前未定项与口径差', '未知节落到未定项');
  assert.strictEqual(out[1].sectionGuessed, true, '猜的节要标出来');
  assert.strictEqual(out[1].level, 'proposed');
  assert.ok(out.every(x => x.decision === null && /^u-[0-9a-f]{12}$/.test(x.uid)));
  const rejected = new Set([out[0].fp]);
  assert.strictEqual(T.normalize(items, secs, rejected).length, 1, '被拒过的不再提');
  const many = Array.from({ length: 12 }, (_, i) => ({ type: 'new_fact', section: '## 2. 已定的事', field: 'f' + i, after: '第 ' + i + ' 条新事实内容' }));
  assert.strictEqual(T.normalize(many, secs).length, md.MAX_ITEMS);
});

test('记忆差异：接受写回目标节末尾、带来源、改 Last updated；拒绝不碰状态文件；处理完镜像移到 applied', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-'));
  const stateFile = path.join(dir, 'project-state.md'); fs.writeFileSync(stateFile, STATE);
  const proj = path.join(dir, 'mem');
  const doc = { id: 'm1', title: 'OCR 会', date: '2026-09-24', at: 'now', stateFile, items: T.normalize([
    { type: 'changed_fact', section: '## 5. 技术评估', field: '像素', before: '像素倾向 12MP', after: 'OCR 输入按 ROI 后尺寸定', level: 'agreed' },
    { type: 'new_open_question', section: '## 8b. 当前未定项与口径差', field: '主流 OCR 输入', after: '主流 OCR 方案各吃多大的图尚未调研', level: 'discussed' },
  ], T.sections(STATE)) };
  fs.mkdirSync(path.join(dir, 'state', 'memory-updates'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'state', 'memory-updates', 'm1.json'), JSON.stringify(doc));
  const r1 = md.decide({ dataDir: dir, sid: 'm1', uid: doc.items[0].uid, action: 'edit', text: 'OCR 输入按 ROI 后尺寸定，72 万像素是下限', confirmed: true, projectionDir: proj });
  const s1 = fs.readFileSync(stateFile, 'utf8');
  const i5 = s1.indexOf('## 5.'), i8 = s1.indexOf('## 8b'), iLine = s1.indexOf('〔会议更新 2026-09-24〕**像素**');
  assert.ok(iLine > i5 && iLine < i8, '写在技术评估节内');
  assert.ok(s1.includes('72 万像素是下限（原：像素倾向 12MP）来源：会议 m1「OCR 会」，会上同意，Aaron 已确认'));
  assert.ok(/Last updated: \d{4}-\d{2}-\d{2}/.test(s1) && !s1.includes('Last updated: 2026-09-01'));
  assert.strictEqual(r1.written.length, 1);
  assert.ok(fs.existsSync(path.join(proj, 'pending', 'memory-updates', 'm1.md')), '还有一条没决定，镜像仍在 pending');
  const before = fs.readFileSync(stateFile, "utf8");
  md.decide({ dataDir: dir, sid: 'm1', uid: doc.items[1].uid, action: 'reject', confirmed: true, projectionDir: proj });
  assert.strictEqual(fs.readFileSync(stateFile, 'utf8'), before, '拒绝不改状态文件');
  const rej = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'memory-updates', 'rejected.json'), 'utf8'));
  assert.ok(rej[doc.items[1].fp]);
  assert.ok(!fs.existsSync(path.join(proj, 'pending', 'memory-updates', 'm1.md')));
  assert.ok(fs.existsSync(path.join(proj, 'pending', 'memory-updates', 'applied', 'm1.md')));
  assert.throws(() => md.decide({ dataDir: dir, sid: 'm1', uid: doc.items[0].uid, action: 'accept', all: true, confirmed: true, projectionDir: proj }), /没有待确认/);
  assert.throws(() => md.decide({ dataDir: dir, sid: 'zz', uid: 'u-000000000000', action: 'accept', confirmed: true }), /还没有差异数据/);
  assert.throws(() => md.decide({ dataDir: dir, sid: 'm1', uid: 'u-000000000000', action: 'accept' }), /没有界面确认/, '没带确认不写回');
  // 节不存在：拒绝写回，不兜底
  const gone = { ...doc, id: 'm2', items: [{ ...doc.items[0], uid: 'u-abcdefabcdef', fp: 'abcdefabcdef', section: '## 99. 不存在', decision: null }] };
  fs.writeFileSync(path.join(dir, 'state', 'memory-updates', 'm2.json'), JSON.stringify(gone));
  assert.throws(() => md.decide({ dataDir: dir, sid: 'm2', uid: 'u-abcdefabcdef', action: 'accept', confirmed: true, projectionDir: proj }), /找不到节/);
  // 空差异：镜像直接进 applied
  fs.writeFileSync(path.join(dir, 'state', 'memory-updates', 'm3.json'), JSON.stringify({ ...doc, id: 'm3', items: [] }));
  const st = require('../app/memory-diff');
  assert.strictEqual(st.summary(st.read(dir, 'm3')).total, 0);
  T.mirror(proj, st.read(dir, 'm3'));
  assert.ok(fs.existsSync(path.join(proj, 'pending', 'memory-updates', 'applied', 'm3.md')), '空差异镜像进 applied');
  assert.ok(!fs.existsSync(path.join(proj, 'pending', 'memory-updates', 'm3.md')), '空差异不留在 pending');
  // Codex 二审：全部接受时有一条节不存在 → 整批不落盘，状态文件和决定记录都不变
  const snapM4 = fs.readFileSync(stateFile, "utf8");
  const mixed = { ...doc, id: 'm4', items: [{ ...doc.items[0], uid: 'u-111111111111', fp: '111111111111', decision: null }, { ...doc.items[0], uid: 'u-222222222222', fp: '222222222222', section: '## 99. 不存在', decision: null }] };
  fs.writeFileSync(path.join(dir, 'state', 'memory-updates', 'm4.json'), JSON.stringify(mixed));
  assert.throws(() => md.decide({ dataDir: dir, sid: 'm4', action: 'accept', all: true, confirmed: true, projectionDir: proj }), /找不到节/);
  assert.strictEqual(fs.readFileSync(stateFile, "utf8"), snapM4, "整批失败状态文件不变");
  assert.ok(md.read(dir, 'm4').items.every(it => !it.decision), '整批失败决定记录不落盘');
  // 节是模型猜的：不进全部接受；单条接受写回并在行里标出
  const g = { ...doc, id: 'm5', items: [{ ...doc.items[0], uid: 'u-333333333333', fp: '333333333333', sectionGuessed: true, decision: null }] };
  fs.writeFileSync(path.join(dir, 'state', 'memory-updates', 'm5.json'), JSON.stringify(g));
  assert.throws(() => md.decide({ dataDir: dir, sid: 'm5', action: 'accept', all: true, confirmed: true, projectionDir: proj }), /模型推断/);
  md.decide({ dataDir: dir, sid: 'm5', uid: 'u-333333333333', action: 'accept', confirmed: true, projectionDir: proj });
  assert.ok(fs.readFileSync(stateFile, 'utf8').includes('节由模型推断'));
  // Last updated 行缺失：补到标题下
  const r = T.insertLine('# 标题\n\n## 2. 已定的事\n- a\n', { section: '## 2. 已定的事', field: 'f', before: 'b', level: 'decided' }, 'after text', { id: 'x', title: 't', date: '2026-09-24' });
  assert.ok(/^# 标题\nLast updated: \d{4}-\d{2}-\d{2}\n/.test(r.out), '缺 Last updated 时补一行');
});

test('记忆差异：提示词要求 level 分级、节列表、pending，不含 confirmed', () => {
  const sys = T.systemPrompt(['## 2. 已定的事']);
  assert.ok(sys.includes('mentioned / discussed / proposed / agreed / decided'));
  assert.ok(sys.includes('## 2. 已定的事') && sys.includes('最多 ' + md.MAX_ITEMS));
  assert.ok(!/confirmed/i.test(sys));
  const u = T.userPrompt({ stateText: 'S', meeting: { id: 'm', title: 't', date: 'd' }, cardsText: 'C', condensedText: '' });
  assert.ok(u.includes('id=m') && u.includes('（无）'));
});
