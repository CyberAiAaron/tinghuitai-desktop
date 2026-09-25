'use strict';
// 「交给某人」（app/person-handoff.js）：三件事逐项成败、幂等、门禁。全部用注入的假 exec，绝不真外发。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { Readable } = require('stream');
const PH = require('../app/person-handoff');

function fakeExec(calls, opts = {}) {
  return (bin, args, o, cb) => {
    calls.push(args);
    const sub = args[0] + ' ' + args[1];
    if (sub === 'contact +search-user') { const q = args[args.indexOf('--queries') + 1]; return cb(null, JSON.stringify({ ok: true, data: { users: q === 'Abel Mei' ? [{ open_id: 'ou_abel', localized_name: 'Abel Mei', matched_query: 'Abel Mei' }] : [] } }), ''); }
    if (sub === 'contact +get-user') return cb(null, JSON.stringify({ ok: true, data: { user: { open_id: 'ou_self' } } }), '');
    if (sub === 'task +create') { if (opts.taskFail) return cb(Error('boom'), '', '飞书拒绝'); return cb(null, JSON.stringify({ ok: true, data: { task: { guid: 'g-1', url: 'https://example.test/task/g-1' } } }), ''); }
    if (sub === 'im +messages-send') { if (opts.msgFail) return cb(Error('boom'), '', '对方不在通讯录'); return cb(null, JSON.stringify({ ok: true, data: { message_id: 'om_1' } }), ''); }
    if (sub === 'docs +create') { if (opts.docFail) return cb(Error('boom'), '', '没权限'); return cb(null, JSON.stringify({ ok: true, data: { document: { document_id: 'doxcnHANDOFF0001', url: 'https://example.test/docx/doxcnHANDOFF0001' } } }), ''); }
    if (sub === 'docs +update') { if (opts.docFail) return cb(Error('boom'), '', '没权限'); return cb(null, JSON.stringify({ ok: true, data: { document: { revision_id: 2 } } }), ''); }
    cb(Error('unexpected ' + sub), '', '');
  };
}
const arg = (a, flag) => a[a.indexOf(flag) + 1];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tht-person-handoff-'));
const body = (extra = {}) => ({ meetingId: 'm-1', person: 'Abel Mei', kind: 'decision', text: '手板像素定 12MP 还是 72 万', context: 'Aaron：这个给 Abel 决定', sourceId: 'u-abc123abc123', confirmed: true, meetingTitle: '硬件周会', meetingDate: '2026-09-24', ...extra });
const items3 = [
  { text: '手板像素定 12MP 还是 72 万', sourceId: 'v2-next', due: '2026-09-30' },
  { text: '把 Pin 的功耗曲线给到 ID', sourceId: 'v2-ins-1', due: '2026-09-26' },
  { text: '约歌尔看结构手板', sourceId: 'v2-ins-2' },
];
const batch = (extra = {}) => ({ meetingId: 'm-1', person: 'Abel Mei', kind: 'todo', items: items3, confirmed: true, meetingTitle: '硬件周会', meetingDate: '2026-09-24', ...extra });
const FORBID = [/依据/, /127\.0\.0\.1/, /localhost/, /来自《/, /默认值，可改/, /默认截止/];
const clean = (s, what) => { for (const re of FORBID) assert.doesNotMatch(s, re, what + ' 不该出现 ' + re); };


test('同一个人 3 件事 → 一条任务 + 一条私聊 + 文档一行；正文按 Aaron 定的格式，不带依据 / 来源 / 内网链接', async () => {
  const dir = tmp(), calls = [];
  const r = await PH.run({ dataDir: dir, body: batch(), execImpl: fakeExec(calls) });
  assert.equal(r.status, 'sent'); assert.ok(!r.alreadySent); assert.equal(r.supplement, false);
  assert.deepEqual(r.assignee, { openId: 'ou_abel', name: 'Abel Mei' });
  assert.deepEqual(calls.map(a => a[0] + ' ' + a[1]), ['contact +search-user', 'task +create', 'im +messages-send', 'docs +create', 'docs +update'], '三件事各一次');
  const task = calls[1];
  assert.equal(arg(task, '--assignee'), 'ou_abel');
  assert.equal(arg(task, '--summary'), '手板像素定 12MP 还是 72 万（等 3 件）');
  assert.match(arg(task, '--due'), /^2026-09-26/, '截止取最早');
  const desc = arg(task, '--description');
  assert.match(desc, /会议：硬件周会（2026-09-24）/); assert.match(desc, /1\. 手板像素定 12MP 还是 72 万（截止 2026-09-30）/); assert.match(desc, /3\. 约歌尔看结构手板（截止 \d{4}-\d{2}-\d{2}）/);
  clean(desc, '任务描述');
  const msg = calls[2];
  assert.equal(arg(msg, '--user-id'), 'ou_abel');
  const md = arg(msg, '--markdown');
  const lines = md.split('\n');
  assert.equal(lines[0], '硬件周会（2026-09-24）后的 3 件事：');
  assert.equal(lines[1], '1. 手板像素定 12MP 还是 72 万（截止 2026-09-30）');
  assert.equal(lines[2], '2. 把 Pin 的功耗曲线给到 ID（截止 2026-09-26）');
  assert.match(lines[3], /^3\. 约歌尔看结构手板（截止 \d{4}-\d{2}-\d{2}）$/);
  assert.equal(lines[4], '任务：https://example.test/task/g-1');
  assert.equal(lines[5], '— 由听会台代发');
  assert.equal(lines.length, 6, '正文就这 6 行');
  clean(md, '私聊');
  const xml = arg(calls[4], '--content');
  assert.equal(arg(calls[4], '--command'), 'append'); assert.equal(arg(calls[4], '--doc'), 'doxcnHANDOFF0001');
  assert.match(xml, /<cite type="user" user-id="ou_abel"\/>/); assert.match(xml, /<a href="https:\/\/example\.test\/task\/g-1">任务<\/a>/);
  assert.match(xml, /1\. 手板像素.*；2\. 把 Pin.*；3\. 约歌尔/, '三件合在一行'); clean(xml, '文档行');
  assert.equal((xml.match(/<p>/g) || []).length, 1, '只追加一段');
  // 索引：三个 sourceId 都记为已发，会后页按它画「已发」
  for (const it of items3) { const s = PH.sentState(dir, 'm-1', it.sourceId); assert.equal(s.person, 'Abel Mei'); assert.equal(s.taskUrl, 'https://example.test/task/g-1'); assert.equal(s.partial, false); }
  assert.equal(PH.sentState(dir, 'm-1', 'nope'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('旧的单条请求体仍收：当 items 长度 1，正文「后的 1 件事」，待决定加「请拍板：」', async () => {
  const dir = tmp(), calls = [];
  const r = await PH.run({ dataDir: dir, body: body(), execImpl: fakeExec(calls), archiveBase: 'http://127.0.0.1:47823' });
  assert.equal(r.status, 'sent'); assert.equal(r.items.length, 1);
  assert.equal(arg(calls[1], '--summary'), '请拍板：手板像素定 12MP 还是 72 万');
  assert.match(arg(calls[1], '--due'), /^\d{4}-\d{2}-\d{2}/, '截止必带（默认 +3 天）');
  const md = arg(calls[2], '--markdown');
  assert.match(md, /^硬件周会（2026-09-24）后的 1 件事：\n1\. 请拍板：手板像素定 12MP 还是 72 万（截止 \d{4}-\d{2}-\d{2}）\n任务：https:\/\/example\.test\/task\/g-1\n— 由听会台代发$/);
  clean(md, '私聊'); clean(arg(calls[1], '--description'), '任务描述');
  assert.ok(PH.sentState(dir, 'm-1', 'u-abc123abc123'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('重复点不重发：同一批再 POST 一条命令不跑；已发的条目混进新一批会被剔掉，只发新增的那件、标「补 1 件」', async () => {
  const dir = tmp(), c1 = [];
  await PH.run({ dataDir: dir, body: batch(), execImpl: fakeExec(c1) });
  const c2 = [];
  const r2 = await PH.run({ dataDir: dir, body: batch(), execImpl: fakeExec(c2) });
  assert.equal(r2.alreadySent, true); assert.equal(c2.length, 0); assert.equal(r2.task.url, 'https://example.test/task/g-1');
  // 只发过其中一件也算已发
  const c2b = [];
  const r2b = await PH.run({ dataDir: dir, body: batch({ items: [items3[1]] }), execImpl: fakeExec(c2b) });
  assert.equal(r2b.alreadySent, true); assert.equal(c2b.length, 0);
  // 新增一件（前端没剔干净，把旧的也带上了）→ 只发新增的
  const c3 = [];
  const r3 = await PH.run({ dataDir: dir, body: batch({ items: [...items3, { text: '补一份 BOM 成本表', sourceId: 'v2-ins-9', due: '2026-10-01' }] }), execImpl: fakeExec(c3) });
  assert.equal(r3.status, 'sent'); assert.ok(!r3.alreadySent); assert.equal(r3.supplement, true); assert.equal(r3.items.length, 1);
  assert.deepEqual(c3.map(a => a[0] + ' ' + a[1]), ['contact +search-user', 'task +create', 'im +messages-send', 'docs +update']);
  assert.equal(arg(c3[1], '--summary'), '补一份 BOM 成本表');
  const md = arg(c3[2], '--markdown');
  assert.equal(md, '硬件周会（2026-09-24）补 1 件：\n1. 补一份 BOM 成本表（截止 2026-10-01）\n任务：https://example.test/task/g-1\n— 由听会台代发');
  assert.doesNotMatch(md, /12MP|功耗|歌尔/, '旧的不重发');
  assert.ok(PH.sentState(dir, 'm-1', 'v2-ins-9'));
  const c4 = [];
  const r4 = await PH.run({ dataDir: dir, body: batch({ items: [{ text: '补一份 BOM 成本表', sourceId: 'v2-ins-9', due: '2026-10-01' }] }), execImpl: fakeExec(c4) });
  assert.equal(r4.alreadySent, true); assert.equal(c4.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('私聊失败不影响任务和文档：结果逐项写清，收据仍是 sent；索引标 partial', async () => {
  const dir = tmp(), calls = [];
  const r = await PH.run({ dataDir: dir, body: batch(), execImpl: fakeExec(calls, { msgFail: true }) });
  assert.equal(r.status, 'sent'); assert.equal(r.partial, true); assert.deepEqual(r.failed, ['message']);
  assert.equal(r.task.ok, true); assert.equal(r.message.ok, false); assert.equal(r.doc.ok, true);
  assert.equal(PH.sentState(dir, 'm-1', 'v2-next').partial, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('通讯录解析不到：不发、不改发给本人，422 带可读原因「通讯录里没找到 X，改个名字再发」；收据清掉可改名重发', async () => {
  const dir = tmp(), calls = [];
  await assert.rejects(PH.run({ dataDir: dir, body: batch({ person: '不存在的人' }), execImpl: fakeExec(calls) }), e => e.code === 422 && e.notFound && /通讯录里没找到「不存在的人」，改个名字再发/.test(e.message));
  assert.deepEqual(calls.map(a => a[0] + ' ' + a[1]), ['contact +search-user'], '没找到人就一条外发都不跑');
  const r = await PH.run({ dataDir: dir, body: batch({ person: 'Abel Mei' }), execImpl: fakeExec([]) });
  assert.equal(r.status, 'sent');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('路由：找不到收件人回 422 + notFound，不是 500', async () => {
  const dir = tmp(), calls = [];
  const req = Readable.from([Buffer.from(JSON.stringify(batch({ person: '不存在的人' })))]); req.method = 'POST';
  let code = 0, text = ''; const res = { writeHead: c => { code = c; }, end: t => { text = t; } };
  await PH.route(req, res, { authed: true, dataDir: dir, execImpl: fakeExec(calls) });
  assert.equal(code, 422); const j = JSON.parse(text); assert.equal(j.notFound, true); assert.match(j.error, /改个名字再发/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('三件全败且都是确定失败：抛错、收据清掉可重来', async () => {
  const dir2 = tmp();
  await assert.rejects(PH.run({ dataDir: dir2, body: batch(), execImpl: fakeExec([], { taskFail: true, msgFail: true, docFail: true }) }), /三件事都没做成/);
  assert.equal(fs.existsSync(path.join(dir2, 'state', 'send-receipts', 'person-handoff')) ? fs.readdirSync(path.join(dir2, 'state', 'send-receipts', 'person-handoff')).length : 0, 0);
  assert.equal(PH.sentState(dir2, 'm-1', 'v2-next'), null);
  fs.rmSync(dir2, { recursive: true, force: true });
});

// 假 req/res 走路由：口令不对 401、没确认 400、字段不合法 400，这三种一条命令都不跑
function fakeReq(j, method = 'POST') { const r = Readable.from([Buffer.from(JSON.stringify(j))]); r.method = method; return r; }
function fakeRes() { const o = { code: 0, body: '' }; o.writeHead = c => { o.code = c; }; o.end = s => { o.body = String(s || ''); }; return o; }
test('路由：口令不对 401；没 confirmed 400；缺人 400；items 空 / 截止格式错 400——都不调命令', async () => {
  const dir = tmp(), calls = [];
  let res = fakeRes(); await PH.route(fakeReq(batch()), res, { authed: false, dataDir: dir, execImpl: fakeExec(calls) });
  assert.equal(res.code, 401);
  res = fakeRes(); await PH.route(fakeReq(batch({ confirmed: false })), res, { authed: true, dataDir: dir, execImpl: fakeExec(calls) });
  assert.equal(res.code, 400); assert.match(JSON.parse(res.body).error, /确认/);
  res = fakeRes(); await PH.route(fakeReq(batch({ person: '' })), res, { authed: true, dataDir: dir, execImpl: fakeExec(calls) });
  assert.equal(res.code, 400); assert.match(JSON.parse(res.body).error, /交给谁/);
  res = fakeRes(); await PH.route(fakeReq(batch({ items: [] })), res, { authed: true, dataDir: dir, execImpl: fakeExec(calls) });
  assert.equal(res.code, 400);
  res = fakeRes(); await PH.route(fakeReq(batch({ items: [{ text: 'x', due: '明天' }] })), res, { authed: true, dataDir: dir, execImpl: fakeExec(calls) });
  assert.equal(res.code, 400);
  assert.deepEqual(calls, []);
  res = fakeRes(); await PH.route(fakeReq(batch()), res, { authed: true, dataDir: dir, execImpl: fakeExec(calls), port: 47823 });
  assert.equal(res.code, 200); const j = JSON.parse(res.body); assert.equal(j.ok, true); assert.equal(j.task.url, 'https://example.test/task/g-1');
  clean(arg(calls[1], '--description'), '任务描述'); clean(arg(calls[2], '--markdown'), '私聊');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('部分成功可补发：retryFailed 只重做失败项，成功项一条命令都不再跑；不带 retryFailed 原样回收据', async () => {
  const dir = tmp(), calls = [];
  const r1 = await PH.run({ dataDir: dir, body: batch(), execImpl: fakeExec(calls, { msgFail: true }) });
  assert.equal(r1.partial, true); assert.deepEqual(r1.failed, ['message']);
  const c2 = [];
  const r2 = await PH.run({ dataDir: dir, body: batch(), execImpl: fakeExec(c2) });
  assert.equal(r2.alreadySent, true); assert.equal(c2.length, 0);
  const c3 = [];
  const r3 = await PH.run({ dataDir: dir, body: batch({ retryFailed: true, retryConfirmed: true }), execImpl: fakeExec(c3) });
  assert.equal(r3.resumed, true); assert.equal(r3.partial, false); assert.equal(r3.message.ok, true);
  assert.deepEqual(r3.skipped, ['task', 'doc']);
  assert.deepEqual(c3.map(a => a[0] + ' ' + a[1]).filter(s => !/contact/.test(s)), ['im +messages-send'], '只补发私聊');
  assert.equal(r3.task.url, r1.task.url);
  assert.equal(PH.sentState(dir, 'm-1', 'v2-next').partial, false, '索引跟着更新');
  const c4 = [];
  const r4 = await PH.run({ dataDir: dir, body: batch({ retryFailed: true, retryConfirmed: true }), execImpl: fakeExec(c4) });
  assert.equal(r4.alreadySent, true); assert.equal(c4.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('补发时「不确定」的失败项没带 retryConfirmed 就不重做，收据仍标 partial', async () => {
  const dir = tmp();
  const uncertainExec = (bin, args, o, cb) => { if (args[0] + ' ' + args[1] === 'im +messages-send') return cb(Object.assign(Error('ETIMEDOUT'), { killed: true }), '', ''); return fakeExec([], {})(bin, args, o, cb); };
  const r1 = await PH.run({ dataDir: dir, body: batch(), execImpl: uncertainExec });
  assert.equal(r1.message.ok, false);
  if (r1.message.uncertain) {
    const c = [];
    const r2 = await PH.run({ dataDir: dir, body: batch({ retryFailed: true }), execImpl: fakeExec(c) });
    assert.equal(r2.partial, true); assert.equal(r2.message.uncertain, true);
    assert.equal(c.filter(a => a[1] === '+messages-send').length, 0, '不确定的项没确认不重发');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('route：非 POST 一律 405，未鉴权 401，缺 confirmed 被拒', async () => {
  const PH = require('../app/person-handoff');
  const mk = (method) => { const r = require('stream').Readable.from([Buffer.from('{}')]); r.method = method; return r; };
  const res = () => { const o = { code: 0, body: '' }; o.writeHead = (c) => { o.code = c; }; o.end = (b) => { o.body = String(b || ''); }; return o; };
  for (const m of ['GET', 'PUT', 'DELETE', 'PATCH']) { const o = res(); await PH.route(mk(m), o, { authed: true, dataDir: require('os').tmpdir() }); assert.equal(o.code, 405, m); }
  const u = res(); await PH.route(mk('POST'), u, { authed: false }); assert.equal(u.code, 401);
  const c = res(); await PH.route(mk('POST'), c, { authed: true, dataDir: require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'ph-')), execImpl: () => { throw new Error('不该执行'); } });
  assert.ok(c.code >= 400 && c.code < 500, '缺 confirmed/字段 → 4xx，未执行外发：' + c.code);
});

test('负责人是「我」：不查通讯录，直接发给当前登录飞书用户本人（包里不写死任何人）', async () => {
  const dir = tmp(), calls = [];
  const r = await PH.run({ dataDir: dir, body: batch({ person: '我' }), execImpl: fakeExec(calls) });
  assert.equal(r.status, 'sent'); assert.equal(r.assignee.openId, 'ou_self'); assert.equal(r.assignee.name, '你本人'); assert.ok(!r.fallbackToSelf);
  assert.equal(calls[0][0] + ' ' + calls[0][1], 'contact +get-user');
  assert.ok(!calls.some(a => a[0] + ' ' + a[1] === 'contact +search-user'));
  fs.rmSync(dir, { recursive: true, force: true });
});
