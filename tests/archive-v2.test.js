'use strict';
// 会后页 v2（Aaron 2026-09-24 拍板）：首屏块数、洞察上限、默认负责人映射、⌘E override 生效、编辑路由门禁。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), { Readable } = require('stream');
const root = path.join(__dirname, '..');
const V2 = require('../app/archive-v2');
const owners = require('../app/owners');

const ins = (n, q, extra = {}) => ({ n, question: q, answer: '第一句立场。第二句展开说明，很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长。', why: 'w', evidence: ['g1'], industry: [], action: { label: 'l', text: '做这件事 ' + n, owner: 'X' }, ...extra });
const sample = () => ({
  id: 'm-v2', topicTitle: '硬件周会', summary: '# 会议纪要\n\n本次会议围绕 OCR 展开。\n\n## 一、定位\n\n**讨论内容**\n- 甲\n\n**结论**\n定位定了。\n\n## 二、硬件\n\n**结论/分歧**\n未收敛。\n\n## 三、待办事项\n- x\n',
  todos: [{ text: '待办甲', owner: '未指定' }],
  calendar: { attendees: [{ name: 'Aaron Wang' }, { name: 'Abel Mei' }, { name: '不来的人', declined: true }] },
  brief: {
    overview: { conclusions: ['结论一', '结论二', '结论三', '结论四', '结论五', '结论六'], todos: [{ what: '调研主流 OCR 方案输入尺寸', owner: 'S0' }] },
    insights: [ins(1, 'Pin 摄像头比手机多出什么？这一句超过二十个字了吧', { stability: 0.7 }), ins(2, '高通 SM7750 路标怎么排？', { stability: 0.6 }), ins(3, '横屏 UI 交互怎么定？', { stability: 0.9 }),
      ins(4, '定价怎么定？', { unstable: true }), ins(5, '要不要做？', { unstable: true }), ins(6, '六', { stability: 0.8 }), ins(7, '七', { unstable: true })],
    insightsBrief: { purpose: 'p', decisionsForAaron: ['白板 OCR 第一版载体：手机摄像头先行，Pin 视觉只留触发，这句也很长超过四十个字符了应该被截断', '第二个要拍的'] },
    insightsMeta: { conflictsWithBoard: ['硬冲突甲', '追加 F 只是倾向，非硬冲突'] },
  },
});

test('首屏三块：改变 ≤3 行且每行 ≤40 字带类型标签；洞察 ≤3 条、稳定优先再按 n；下一步取最重要的 decision', () => {
  const v = V2.buildView(sample());
  assert.ok(v.changes.length >= 1 && v.changes.length <= 3);
  for (const c of v.changes) { assert.ok(['问题', '进展', '下一步'].includes(c.kind)); assert.ok([...c.text].length <= 40, c.text); }
  assert.deepEqual(v.changes.map(c => c.kind), ['问题', '进展', '下一步']);
  // 09-24 第二轮（Aaron「no template」）：第 2 块正文 = insights_md 自由 markdown；缺它时由旧 insights 数组兜底拼出来
  assert.ok(v.insightsMd.includes('**Pin 摄像头比手机多出什么？这一句超过二十个字了吧**'), '兜底 markdown 里有问题行');
  assert.ok(v.insightsMd.includes('@Abel Mei：做这件事 1'), '兜底 markdown 里有指派行');
  const sid = (o, t) => 'v2-ins-' + crypto.createHash('sha1').update(o + '|' + t).digest('hex').slice(0, 10);
  assert.deepEqual(v.insights.map(i => i.legacyId).slice(0, 2), ['v2-ins-1', 'v2-ins-2']);
  assert.equal(v.insights[0].sourceId, sid(v.insights[0].owner, v.insights[0].action), 'sourceId 按负责人|动作取哈希');
  assert.deepEqual(v.insights.map(i => i.action).slice(0, 2), ['做这件事 1', '做这件事 2'], '行动卡只从 @人名： 行来');
  // insights_md 在场时直接用它，且只对 @人名： 行出卡
  const md = V2.buildView({ ...sample(), insightsMd: '结论先说。\n\n- 一条\n\n@Hannah Yin：确认高通路标\n这行不是指派' });
  assert.match(md.insightsMd, /^结论先说。/);
  assert.equal(md.insights.length, 1);
  assert.deepEqual(md.insights[0], { n: 1, action: '确认高通路标', owner: 'Hannah Yin', topic: '高通路标', named: 'Hannah Yin', sourceId: sid('Hannah Yin', '确认高通路标'), legacyId: 'v2-ins-1' });
  // 洞察重跑换了顺序，同一条动作的 sourceId 不变
  const re = V2.buildView({ ...sample(), insightsMd: '@Abel Mei：先做别的\n\n@Hannah Yin：确认高通路标' });
  assert.equal(re.insights[1].sourceId, md.insights[0].sourceId);
  assert.equal(v.next.sourceId, 'v2-next'); assert.match(v.next.text, /^白板 OCR 第一版载体/);
  // 纪要：一句话主题 + 只保留有结论的二级标题 + 结论 ≤5 + 待办 + 参会人（谢绝的不算）
  assert.equal(v.minutes.topic, '本次会议围绕 OCR 展开。');
  assert.deepEqual(v.minutes.sections.map(s => [s.title, s.conclusion]), [['定位', '定位定了。'], ['硬件', '未收敛。']]);
  assert.equal(v.minutes.conclusions.length, 5);
  assert.deepEqual(v.minutes.participants, ['Aaron Wang', 'Abel Mei']);
  assert.equal(v.minutes.todos[0].text, '调研主流 OCR 方案输入尺寸');
});

test('默认负责人映射：硬件 → Abel Mei，高通路标 → Hannah Yin，软件 → Luna Min，判不出 → Aaron Wang；真源是 owners.json', () => {
  const tbl = JSON.parse(fs.readFileSync(process.env.THT_OWNERS_FILE, 'utf8'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'app/owners.json'), 'utf8')), { 默认: '' });   // 包里那份不带同事名字
  assert.deepEqual(tbl, { 硬件: 'Abel Mei', 高通路标: 'Hannah Yin', 软件: 'Luna Min', 默认: 'Aaron Wang' });
  assert.deepEqual(owners.classify('Pin 摄像头 sensor 功耗'), { topic: '硬件', owner: 'Abel Mei' });
  assert.deepEqual(owners.classify('高通 SM7750 路标'), { topic: '高通路标', owner: 'Hannah Yin' });
  assert.deepEqual(owners.classify('OS 交互 UI app'), { topic: '软件', owner: 'Luna Min' });
  assert.deepEqual(owners.classify('定价怎么定'), { topic: '默认', owner: 'Aaron Wang' });
  assert.equal(owners.AARON_OPEN_ID, undefined, '包里不再写死任何 open_id');
  const v = V2.buildView(sample());
  assert.deepEqual(v.insights.map(i => i.owner).slice(0, 3), ['Abel Mei', 'Hannah Yin', 'Luna Min']);
  // 正文里写了人名但不在 owners.json 里 → 退回 classify
  assert.equal(V2.buildView({ brief: {}, insightsMd: '@张三：Pin 摄像头 sensor 功耗要复核' }).insights[0].owner, 'Abel Mei');
  assert.equal(V2.buildView({ brief: { insights: [ins(9, '定价怎么定？')] } }).insights[0].owner, 'Aaron Wang');
});

test('⌘E override：按路径盖到视图上（insights 按 n 找，不按位置），非法路径和非字符串忽略；decorate 把 view 挂进 meeting-result 且原字段不动', () => {
  const r = { ...sample(), overrides: { 'changes.0': '改过的第一行', 'insights.2.stance': '改过的立场', 'insights.2.owner': 'Cary Luo', 'next.text': '改过的下一步', 'summary.1': '改过的结论二', 'minutes.topic': '改过的主题', 'bogus.path': 'x', 'changes.1': 123 } };
  const d = V2.decorate(r, { dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tht-v2-')) });
  assert.equal(d.summary, r.summary); assert.equal(d.overrides, r.overrides);
  const v = d.view;
  assert.equal(v.changes[0].text, '改过的第一行'); assert.equal(v.changes[0].edited, true);
  assert.equal(v.changes[1].text, '结论一');
  const i2 = v.insights.find(x => x.n === 2); assert.equal(i2.stance, '改过的立场'); assert.equal(i2.owner, 'Cary Luo');
  assert.equal(v.next.text, '改过的下一步'); assert.equal(v.minutes.conclusions[1], '改过的结论二'); assert.equal(v.minutes.topic, '改过的主题');
  assert.equal(v.insights[0].sent, null); assert.equal(v.next.sent, null);
  assert.equal(V2.decorate(null), null);
});

test('「发」过的卡片：从 person-handoff 收据读出已发时间（key = person-handoff / 会议 / sourceId）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-v2-sent-'));
  const k = require('../app/send-gate').hash(['person-handoff', 'm-v2', 'v2-next']);
  const f = path.join(dir, 'state', 'send-receipts', 'person-handoff'); fs.mkdirSync(f, { recursive: true });
  fs.writeFileSync(path.join(f, k + '.json'), JSON.stringify({ status: 'sent', at: 1790000000000, assignee: { name: 'Abel Mei' }, task: { ok: true, url: 'https://example.test/t/1' } }));
  const v = V2.decorate(sample(), { dataDir: dir }).view;
  assert.deepEqual(v.next.sent, { at: 1790000000000, partial: false, person: 'Abel Mei', taskUrl: 'https://example.test/t/1' });
  assert.equal(v.insights[0].sent, null);
});

test('「发」过的卡片（新）：一人一批的已发索引 state/person-handoff-sent/<会议>.json 按 sourceId 读出，压过旧收据', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-v2-sent2-'));
  const f = path.join(dir, 'state', 'person-handoff-sent'); fs.mkdirSync(f, { recursive: true });
  fs.writeFileSync(path.join(f, 'm-v2.json'), JSON.stringify({ 'v2-next': { at: 1790000001000, person: 'Abel Mei', partial: true, taskUrl: 'https://example.test/t/9' } }));
  const v = V2.decorate(sample(), { dataDir: dir }).view;
  assert.deepEqual(v.next.sent, { at: 1790000001000, partial: true, person: 'Abel Mei', taskUrl: 'https://example.test/t/9' });
  assert.equal(v.insights[0].sent, null);
  const js = fs.readFileSync(path.join(root, 'web/archive-v2.js'), 'utf8');
  assert.match(js, /items:b\.items\.map/, '前端一次 POST 整批 items');
  assert.match(js, /!c\.node\.sent/, '只收未发的卡');
});

function req(method, body) { const r = Readable.from([JSON.stringify(body)]); r.method = method; r.headers = {}; return r; }
function res() { const o = { code: 0, body: '' }; o.writeHead = c => { o.code = c; }; o.end = b => { o.body = String(b || ''); o.done = Promise.resolve(); }; return o; }

test('PATCH /archive-edit：无口令 401、非 PATCH 405、路径不认 400；合法请求走 pipeline.patchResult 写 overrides，返回新 view', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-v2-edit-'));
  let last = null; const store = sample();
  const pipeline = { patchResult: (id, patch) => { last = { id, patch }; store.overrides = { ...(store.overrides || {}), ...patch.overrides }; return store; } };
  const call = async (method, body, authed = true) => { const rs = res(); await V2.editRoute(req(method, body), rs, { authed, pipeline, dataDir: dir }); return rs; };
  assert.equal((await call('PATCH', { id: 'm-v2', path: 'changes.0', text: 'x' }, false)).code, 401);
  assert.equal((await call('POST', { id: 'm-v2', path: 'changes.0', text: 'x' })).code, 405);
  assert.equal((await call('PATCH', { id: 'm-v2', path: '__proto__.x', text: 'x' })).code, 400);
  assert.equal((await call('PATCH', { id: '../x', path: 'changes.0', text: 'x' })).code, 400);
  assert.equal((await call('PATCH', { id: 'm-v2', path: 'changes.0' })).code, 400);
  const ok = await call('PATCH', { id: 'm-v2', path: 'changes.0', text: '  改成\n这样 ' });
  assert.equal(ok.code, 200); const j = JSON.parse(ok.body);
  assert.deepEqual(last, { id: 'm-v2', patch: { overrides: { 'changes.0': '改成 这样' } } });
  assert.equal(j.view.changes[0].text, '改成 这样');
  // 空文本 = 撤掉这条 override
  const undo = await call('PATCH', { id: 'm-v2', path: 'changes.0', text: '' });
  assert.equal(JSON.parse(undo.body).ok, true); assert.deepEqual(last.patch, { overrides: { 'changes.0': null } });
  const nf = { patchResult: () => { const e = Error('这场会还没整理完'); e.code = 404; throw e; } };
  const rs = res(); await V2.editRoute(req('PATCH', { id: 'm-v2', path: 'changes.0', text: 'x' }), rs, { authed: true, pipeline: nf, dataDir: dir }); assert.equal(rs.code, 404);
});

test('PATCH /archive-edit：insights_md 保存换行不被压平（Codex 审计 2026-09-24，之前走 oneLine 会把 Markdown 压成一行）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-v2-md-'));
  const store = sample();
  const pipeline = { patchResult: (id, patch) => { store.overrides = { ...(store.overrides || {}), ...patch.overrides }; return store; } };
  const call = async body => { const rs = res(); await V2.editRoute(req('PATCH', body), rs, { authed: true, pipeline, dataDir: dir }); return rs; };
  const md = '结论先说。\n\n- 第一条\n- 第二条\n\n@Hannah Yin：确认高通路标';
  const out = await call({ id: 'm-v2', path: 'insights_md', text: '  ' + md + '  ' });
  assert.equal(out.code, 200);
  const j = JSON.parse(out.body);
  assert.equal(j.text, md, '换行原样保留，只 trim 首尾空白');
  assert.equal(store.overrides.insights_md, md);
  assert.equal(j.view.insightsMd, md, '回读的 view 也保留换行');
});

test('Python --patch-enhanced 认 overrides：合并、空值撤掉、别的字段不动', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-v2-py-'));
  const mp = require('../app/meeting-pipeline')({ dir, idle: () => false });
  const key = crypto.createHash('sha256').update('m-py').digest('hex').slice(0, 16);
  fs.writeFileSync(path.join(dir, key + '.job.json'), JSON.stringify({ key, sessionId: 'm-py', created: '2026-09-24', status: 'done', input: '' }));
  fs.writeFileSync(path.join(dir, key + '.job.enhanced.json'), JSON.stringify({ id: 'm-py', summary: 'S', names: { 1: '甲' }, overrides: { 'changes.1': '旧' } }));
  const a = mp.patchResult('m-py', { overrides: { 'changes.0': '新', 'changes.1': null } });
  assert.deepEqual(a.overrides, { 'changes.0': '新' }); assert.equal(a.summary, 'S'); assert.deepEqual(a.names, { 1: '甲' });
  assert.throws(() => mp.patchResult('nope', { overrides: {} }), /还没整理完/);
});

test('页面契约：首屏只有 v2 三块 + 纪要标题，旧版全量收进 #legacy 且默认不显示；「⋯」菜单五项；⌘E 与 💬 并存；发只走 /person-handoff', () => {
  const html = fs.readFileSync(path.join(root, 'web/archive.html'), 'utf8'), js = fs.readFileSync(path.join(root, 'web/archive-v2.js'), 'utf8');
  assert.match(html, /<main id="v2" class="v2" hidden><\/main>\s*<div id="legacy">/);
  assert.match(html, /#legacy>\*\{display:none\}/);
  assert.match(html, /<script src="archive-v2\.js\?v=\d+"><\/script><script src="page-comments\.js/);
  assert.equal((html.match(/id="v2-more"/g) || []).length, 1);
  for (const item of ["'录音'", "'下载 / 分享'", "'逐字稿'", "'旧版全量视图'"]) assert.ok(js.includes(item), '菜单缺 ' + item);
  assert.match(js, /这场会改变了什么/); assert.match(js, /想法/); assert.match(js, /下一步最重要的一件事/); assert.match(js, /会议纪要/);
  assert.doesNotMatch(js, /bf-updates|议题表|待办看板/, '首屏不出现记忆更新栏 / 议题表 / 待办看板');
  assert.equal((js.match(/fetch\('\/asr-relay\/person-handoff/g) || []).length, 1, '「发」只有一个出口');
  assert.match(js, /confirmed:true/); assert.match(js, /kind:'todo'/);
  assert.match(js, /fetch\('\/asr-relay\/archive-edit\?token=/); assert.match(js, /method:'PATCH'/);
  assert.match(js, /ev\.key==='Escape'.*cancel\(\)/, 'Esc = 撤回');
  assert.match(js, /onBlur=\(\)=>cancel\(\)/, '失焦 = 撤回');
  assert.match(fs.readFileSync(path.join(root, 'web/page-comments.js'), 'utf8'), /BLOCKS='\.v2-row,\.v2-md,\.v2-card,\.v2-ins,\.v2-next/, '💬 认 v2 的块');
  // 服务端：编辑路由挂在 person-handoff 之后、meeting-result 经 decorate
  const server = fs.readFileSync(path.join(root, 'app/server.js'), 'utf8');
  assert.match(server, /p\.endsWith\('\/archive-edit'\)\)return archiveV2\.editRoute/);
  assert.match(server, /'page-comments\.js','archive-v2\.js'/, 'archive-v2.js 要在静态文件白名单里，不然页面 404');
  assert.match(server, /let result=archiveV2\.decorate\(meetingPipeline\.result\(rid\),\{dataDir:DATA\}\)/);
});


test('旧序号收据：收件人对得上才算已发，对不上不挂到别人卡上', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-legacy-'));
  const d = path.join(dir, 'state', 'send-receipts', 'person-handoff'); fs.mkdirSync(d, { recursive: true });
  const k = require('../app/send-gate').hash(['person-handoff', 'm-l', 'v2-ins-1']);
  fs.writeFileSync(path.join(d, k + '.json'), JSON.stringify({ status: 'sent', at: 1, assignee: { name: 'Abel Mei' } }));
  const mk = (md) => V2.decorate({ id: 'm-l', brief: { insights_md: md } }, { dataDir: dir }).view.insights[0];
  assert.equal(mk('@Luna Min：画流程图').sent, null, '第 1 条换成 Luna 了，不能显示已发给 Abel');
  assert.ok(mk('@Abel Mei：算像素').sent, '第 1 条还是 Abel，旧收据照认，防止重发');
  fs.writeFileSync(path.join(d, k + '.json'), JSON.stringify({ status: 'sent', at: 1 }));
  assert.equal(mk('@Abel Mei：算像素').sent, null, '旧收据没有收件人，不认');
});

test('v2 部分没成：卡上有「补发没成的」，只收部分没成的卡，带 retryFailed', () => {
  const js = fs.readFileSync(path.join(root, 'web', 'archive-v2.js'), 'utf8');
  assert.match(js, /sent\.partial\?'<button type="button" class="go" data-retry=/);
  assert.match(js, /retry\?c\.node\.sent&&c\.node\.sent\.partial:!c\.node\.sent/);
  assert.match(js, /\.\.\.\(retry\?\{retryFailed:true,retryConfirmed:true\}:\{\}\)/);
});

test('会后页 v2：说话人编号不上界面——有名换名、没名写「未认人」、负责人只剩编号就留空；没在转写里出现的 S24 不动', () => {
  const v2 = require('../app/archive-v2');
  const r = { names: { 1: 'Cary Luo' }, transcript: [{ speaker: '1', text: 'a' }, { speaker: '3', text: 'b' }],
    brief: { overview: { conclusions: ['S1 同意，Galaxy S24 作参照'], todos: [{ what: 'S3 准备 CDCP 材料', owner: 'S3' }, { what: '说话人 1 跟进', owner: 'S1' }] } } };
  const view = v2.buildView(r);
  assert.equal(view.minutes.conclusions[0], 'Cary Luo 同意，Galaxy S24 作参照');
  assert.deepEqual(view.minutes.todos, [{ text: '未认人 准备 CDCP 材料', owner: '' }, { text: 'Cary Luo 跟进', owner: 'Cary Luo' }]);
  assert.equal(view.next.text, '未认人 准备 CDCP 材料');
});

test('没有个人 owners.json（试用版新用户）：判不出的负责人显示「我」，不出现任何写死的名字', () => {
  const { execFileSync } = require('child_process');
  const out = execFileSync(process.execPath, ['-e', "const o=require('./app/owners');process.stdout.write(JSON.stringify(o.classify('定价怎么定')))"], { cwd: root, env: { PATH: process.env.PATH, THT_OWNERS_FILE: '/nonexistent/owners.json' } }).toString();
  assert.deepEqual(JSON.parse(out), { topic: '默认', owner: '我' });
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'web/archive-v2.js'), 'utf8'), /Aaron Wang/);
});
