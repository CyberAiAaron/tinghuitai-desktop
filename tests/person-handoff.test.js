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
    if (sub === 'task +create') { if (opts.taskFail) return cb(Error('boom'), '', '飞书拒绝'); return cb(null, JSON.stringify({ ok: true, data: { task: { guid: 'g-1', url: 'https://example.test/task/g-1' } } }), ''); }
    if (sub === 'im +messages-send') { if (opts.msgFail) return cb(Error('boom'), '', '对方不在通讯录'); return cb(null, JSON.stringify({ ok: true, data: { message_id: 'om_1' } }), ''); }
    if (sub === 'docs +create') { if (opts.docFail) return cb(Error('boom'), '', '没权限'); return cb(null, JSON.stringify({ ok: true, data: { document: { document_id: 'doxcnHANDOFF0001', url: 'https://example.test/docx/doxcnHANDOFF0001' } } }), ''); }
    if (sub === 'docs +update') { if (opts.docFail) return cb(Error('boom'), '', '没权限'); return cb(null, JSON.stringify({ ok: true, data: { document: { revision_id: 2 } } }), ''); }
    cb(Error('unexpected ' + sub), '', '');
  };
}
const arg = (a, flag) => a[a.indexOf(flag) + 1];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tht-person-handoff-'));
const body = (extra = {}) => ({ meetingId: 'm-1', person: 'Abel Mei', kind: 'decision', text: '手板像素定 12MP 还是 72 万', context: 'Aaron：这个给 Abel 决定', sourceId: 'u-abc123abc123', confirmed: true, meetingTitle: '硬件周会', ...extra });

test('三步都成功：任务派给解析到的人、私聊带任务链接和落款、行动清单新建并追加一行带 @', async () => {
  const dir = tmp(), calls = [];
  const r = await PH.run({ dataDir: dir, body: body(), execImpl: fakeExec(calls), archiveBase: 'http://127.0.0.1:47823' });
  assert.equal(r.status, 'sent'); assert.ok(!r.alreadySent);
  assert.deepEqual(r.assignee, { openId: 'ou_abel', name: 'Abel Mei' }); assert.equal(r.fallbackToAaron, false);
  assert.deepEqual(r.task, { ok: true, url: 'https://example.test/task/g-1', id: 'g-1' });
  assert.equal(r.message.ok, true); assert.equal(r.message.to, 'ou_abel');
  assert.deepEqual(r.doc, { ok: true, token: 'doxcnHANDOFF0001', url: 'https://example.test/docx/doxcnHANDOFF0001', created: true });
  assert.deepEqual(calls.map(a => a[0] + ' ' + a[1]), ['contact +search-user', 'task +create', 'im +messages-send', 'docs +create', 'docs +update']);
  const task = calls[1];
  assert.equal(arg(task, '--assignee'), 'ou_abel'); assert.equal(arg(task, '--summary'), '请拍板：手板像素定 12MP 还是 72 万');
  assert.match(arg(task, '--due'), /^\d{4}-\d{2}-\d{2}T18:00:00\+08:00$/, '截止必带');
  assert.match(arg(task, '--description'), /默认截止，可改/); assert.match(arg(task, '--description'), /archive\.html\?id=m-1/); assert.match(arg(task, '--description'), /依据：Aaron：这个给 Abel 决定/);
  const msg = calls[2];
  assert.equal(arg(msg, '--user-id'), 'ou_abel');
  const md = arg(msg, '--markdown');
  assert.match(md, /https:\/\/example\.test\/task\/g-1/); assert.match(md, /依据：/); assert.ok(md.endsWith('— Aaron 的 Claude 代发'));
  assert.equal(arg(calls[3], '--title'), '听会台行动清单');
  const xml = arg(calls[4], '--content');
  assert.equal(arg(calls[4], '--command'), 'append'); assert.equal(arg(calls[4], '--doc'), 'doxcnHANDOFF0001');
  assert.match(xml, /<cite type="user" user-id="ou_abel"\/>/); assert.match(xml, /<a href="https:\/\/example\.test\/task\/g-1">任务<\/a>/); assert.match(xml, /待决定/);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'handoff-doc.json'), 'utf8'));
  assert.equal(saved.token, 'doxcnHANDOFF0001');
  assert.ok(fs.readdirSync(path.join(dir, 'state', 'send-receipts', 'person-handoff')).length === 1, '收据落盘');

  // 文档已有：第二条不同事项不再 +create，直接 append
  const calls2 = [];
  await PH.run({ dataDir: dir, body: body({ sourceId: 'u-second', text: '另一件事' }), execImpl: fakeExec(calls2) });
  assert.ok(!calls2.some(a => a[0] === 'docs' && a[1] === '+create'));
  assert.ok(calls2.some(a => a[0] === 'docs' && a[1] === '+update'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('私聊失败不影响任务和文档：结果逐项写清，收据仍是 sent', async () => {
  const dir = tmp(), calls = [];
  const r = await PH.run({ dataDir: dir, body: body(), execImpl: fakeExec(calls, { msgFail: true }) });
  assert.equal(r.status, 'sent');
  assert.equal(r.task.ok, true); assert.equal(r.doc.ok, true);
  assert.equal(r.message.ok, false); assert.match(r.message.error, /对方不在通讯录/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('幂等：同 sourceId 第二次直接回上次结果，一条命令都不再跑；三件全败清收据允许重来', async () => {
  const dir = tmp(), calls = [];
  const r1 = await PH.run({ dataDir: dir, body: body(), execImpl: fakeExec(calls) });
  const n = calls.length;
  const r2 = await PH.run({ dataDir: dir, body: body({ text: '哪怕原文改了也不重发' }), execImpl: fakeExec(calls) });
  assert.equal(r2.alreadySent, true); assert.equal(r2.task.url, r1.task.url); assert.equal(calls.length, n);
  // 没 sourceId：按 人 + 类型 + 原文 指纹幂等
  const b0 = body({ sourceId: '' }); const c0 = [];
  await PH.run({ dataDir: dir, body: b0, execImpl: fakeExec(c0) }); const m = c0.length;
  const again = await PH.run({ dataDir: dir, body: b0, execImpl: fakeExec(c0) });
  assert.equal(again.alreadySent, true); assert.equal(c0.length, m);
  // 三件全败（全是确定的失败）→ 抛错、收据清掉、再来一次能真跑
  const dir2 = tmp();
  await assert.rejects(PH.run({ dataDir: dir2, body: body(), execImpl: fakeExec([], { taskFail: true, msgFail: true, docFail: true }) }), e => /三件事都没做成/.test(e.message) && e.results && e.results.task.ok === false);
  assert.equal(fs.existsSync(path.join(dir2, 'state', 'send-receipts', 'person-handoff')) ? fs.readdirSync(path.join(dir2, 'state', 'send-receipts', 'person-handoff')).length : 0, 0);
  const r3 = await PH.run({ dataDir: dir2, body: body(), execImpl: fakeExec([]) });
  assert.equal(r3.status, 'sent');
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(dir2, { recursive: true, force: true });
});

test('找不到的人：任务建给 Aaron 并注明代办对象，私聊和 @ 都退到 Aaron', async () => {
  const dir = tmp(), calls = [];
  const r = await PH.run({ dataDir: dir, body: body({ person: '不存在的人', kind: 'todo' }), execImpl: fakeExec(calls) });
  assert.equal(r.fallbackToAaron, true); assert.equal(r.assignee.openId, PH.AARON_OPEN_ID);
  assert.equal(arg(calls[1], '--assignee'), PH.AARON_OPEN_ID); assert.match(arg(calls[1], '--description'), /代办对象：不存在的人/);
  assert.equal(arg(calls[2], '--user-id'), PH.AARON_OPEN_ID);
  assert.match(arg(calls[4], '--content'), new RegExp('user-id="' + PH.AARON_OPEN_ID + '"'));
  fs.rmSync(dir, { recursive: true, force: true });
});

// 假 req/res 走路由：口令不对 401、没确认 400、字段不合法 400，这三种一条命令都不跑
function fakeReq(j, method = 'POST') { const r = Readable.from([Buffer.from(JSON.stringify(j))]); r.method = method; return r; }
function fakeRes() { const o = { code: 0, body: '' }; o.writeHead = c => { o.code = c; }; o.end = s => { o.body = String(s || ''); }; return o; }
test('路由：口令不对 401；没 confirmed 400；缺人 400——都不调命令', async () => {
  const dir = tmp(), calls = [];
  let res = fakeRes(); await PH.route(fakeReq(body()), res, { authed: false, dataDir: dir, execImpl: fakeExec(calls) });
  assert.equal(res.code, 401);
  res = fakeRes(); await PH.route(fakeReq(body({ confirmed: false })), res, { authed: true, dataDir: dir, execImpl: fakeExec(calls) });
  assert.equal(res.code, 400); assert.match(JSON.parse(res.body).error, /确认/);
  res = fakeRes(); await PH.route(fakeReq(body({ person: '' })), res, { authed: true, dataDir: dir, execImpl: fakeExec(calls) });
  assert.equal(res.code, 400); assert.match(JSON.parse(res.body).error, /交给谁/);
  res = fakeRes(); await PH.route(fakeReq(body({ due: '明天' })), res, { authed: true, dataDir: dir, execImpl: fakeExec(calls) });
  assert.equal(res.code, 400);
  assert.deepEqual(calls, []);
  res = fakeRes(); await PH.route(fakeReq(body()), res, { authed: true, dataDir: dir, execImpl: fakeExec(calls), port: 47823 });
  assert.equal(res.code, 200); const j = JSON.parse(res.body); assert.equal(j.ok, true); assert.equal(j.task.url, 'https://example.test/task/g-1');
  assert.match(arg(calls[1], '--description'), /http:\/\/127\.0\.0\.1:47823\/archive\.html\?id=m-1/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('部分成功可补发：retryFailed 只重做失败项，成功项一条命令都不再跑；不带 retryFailed 原样回收据', async () => {
  const dir = tmp(), calls = [];
  const r1 = await PH.run({ dataDir: dir, body: body(), execImpl: fakeExec(calls, { msgFail: true }) });
  assert.equal(r1.partial, true); assert.deepEqual(r1.failed, ['message']);
  const c2 = [];
  const r2 = await PH.run({ dataDir: dir, body: body(), execImpl: fakeExec(c2) });
  assert.equal(r2.alreadySent, true); assert.equal(c2.length, 0);
  const c3 = [];
  const r3 = await PH.run({ dataDir: dir, body: body({ retryFailed: true, retryConfirmed: true }), execImpl: fakeExec(c3) });
  assert.equal(r3.resumed, true); assert.equal(r3.partial, false); assert.equal(r3.message.ok, true);
  assert.deepEqual(r3.skipped, ['task', 'doc']);
  assert.deepEqual(c3.map(a => a[0] + ' ' + a[1]).filter(s => !/contact/.test(s)), ['im +messages-send'], '只补发私聊');
  assert.equal(r3.task.url, r1.task.url);
  // 补完后再点：不再跑
  const c4 = [];
  const r4 = await PH.run({ dataDir: dir, body: body({ retryFailed: true, retryConfirmed: true }), execImpl: fakeExec(c4) });
  assert.equal(r4.alreadySent, true); assert.equal(c4.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('补发时「不确定」的失败项没带 retryConfirmed 就不重做，收据仍标 partial', async () => {
  const dir = tmp();
  const uncertainExec = (bin, args, o, cb) => { if (args[0] + ' ' + args[1] === 'im +messages-send') return cb(Object.assign(Error('ETIMEDOUT'), { killed: true }), '', ''); return fakeExec([], {})(bin, args, o, cb); };
  const r1 = await PH.run({ dataDir: dir, body: body(), execImpl: uncertainExec });
  assert.equal(r1.message.ok, false);
  if (r1.message.uncertain) {
    const c = [];
    const r2 = await PH.run({ dataDir: dir, body: body({ retryFailed: true }), execImpl: fakeExec(c) });
    assert.equal(r2.partial, true); assert.equal(r2.message.uncertain, true);
    assert.equal(c.filter(a => a[1] === '+messages-send').length, 0, '不确定的项没确认不重发');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
