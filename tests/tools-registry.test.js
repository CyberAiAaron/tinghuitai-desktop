'use strict';
// 工具权限层的登记表本身。这里盯住六件事，它们决定了「加一个工具」是安全的：
//   ① 写类工具不带 confirmedByUser 一律拒绝，而且连一个子进程都不起
//   ② 参数不合 schema 就不进 run（不认识的参数、缺必填、越界、枚举外）
//   ③ 工具卡住有上限，超时返回错误而不是把整条链挂死
//   ④ 结果太长先丢条目再切文本，永远还给模型一份完整 JSON，并标 truncated
//   ⑤ 每次调用落一行审计，像密钥的参数不落盘；没有数据目录就只记日志不在别处留文件
//   ⑥ 没接上的工具照样列在清单里，带写得清的 reason，而不是消失
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const reg = require('../app/tools');

const tmp = tag => fs.mkdtempSync(path.join(os.tmpdir(), 'tht-' + tag + '-'));

// 只在这个测试进程里存在的几个桩工具（node --test 每个文件一个进程，不会串到别处）
let writerRuns = 0, execCalls = 0;
reg.register({
  name: 'test.writer', title: '桩写工具', level: 'write', source: 'local',
  input: { type: 'object', properties: { what: { type: 'string', maxLength: 20 } } },
  run(args, ctx) { writerRuns++; (ctx.execImpl || (() => {}))('/bin/echo', ['x'], {}, () => {}); return { ok: true, data: { done: true } }; },
});
reg.register({
  name: 'test.slow', title: '桩慢工具', level: 'read', source: 'local',
  input: { type: 'object', properties: {} },
  run() { return new Promise(r => setTimeout(() => r({ ok: true, data: { late: true } }), 3000)); },
});
reg.register({
  name: 'test.big', title: '桩大结果', level: 'read', source: 'local',
  input: { type: 'object', properties: { one: { type: 'boolean', default: false } } },
  run(args) {
    if (args.one) return { ok: true, items: [{ ref: 'x:1', text: 'A'.repeat(20000) }] };
    return { ok: true, items: Array.from({ length: 40 }, (_, i) => ({ ref: 'x:' + i, text: 'B'.repeat(400) })) };
  },
});
reg.register({
  name: 'test.strict', title: '桩校验', level: 'read', source: 'local',
  input: { type: 'object', required: ['q'], properties: {
    q: { type: 'string', minLength: 1, maxLength: 10 },
    n: { type: 'integer', minimum: 1, maximum: 5, default: 2 },
    mode: { type: 'string', enum: ['a', 'b'], default: 'a' },
    token: { type: 'string', maxLength: 200 },
  } },
  run(args) { return { ok: true, data: { got: args } }; },
});
reg.register({
  name: 'test.off', title: '桩没接上', level: 'read', source: 'local',
  input: { type: 'object', properties: {} },
  available: () => ({ ok: false, reason: '未接：这台机器上没配这个' }),
  run() { return { ok: true, data: {} }; },
});
reg.register({
  name: 'test.boom', title: '桩会抛', level: 'read', source: 'local',
  input: { type: 'object', properties: {} },
  run() { throw new Error('里面炸了'); },
});

const lines = dir => fs.readFileSync(reg.auditFile(dir), 'utf8').trim().split('\n').map(x => JSON.parse(x));

test('写类工具：没有界面确认就拒绝，run 不执行、子进程一个都不起；带上确认才执行', async () => {
  const dir = tmp('reg-write');
  const spy = () => { execCalls++; };
  writerRuns = 0; execCalls = 0;

  const no = await reg.call('test.writer', { what: 'x' }, { dataDir: dir, caller: 'model:stub', execImpl: spy });
  assert.equal(no.ok, false);
  assert.match(no.error, /界面上确认/);
  assert.equal(writerRuns, 0, 'run 根本没被调用');
  assert.equal(execCalls, 0, '一个子进程都没起');

  // 显式给 false、给字符串 'true' 都不算确认——只有严格的 true 才放行
  for (const bad of [false, 'true', 1, null]) {
    const r = await reg.call('test.writer', { what: 'x' }, { dataDir: dir, confirmedByUser: bad, execImpl: spy });
    assert.equal(r.ok, false, String(bad) + ' 不该被当成确认');
  }
  assert.equal(writerRuns, 0);

  const yes = await reg.call('test.writer', { what: 'x' }, { dataDir: dir, caller: 'ui', confirmedByUser: true, execImpl: spy });
  assert.equal(yes.ok, true);
  assert.equal(writerRuns, 1);
  assert.equal(execCalls, 1);

  // 被拒绝的那几次也要留痕，不是静悄悄丢掉
  const rejected = lines(dir).filter(x => x.name === 'test.writer' && !x.ok);
  assert.equal(rejected.length, 5);
  assert.equal(rejected[0].caller, 'model:stub');
});

test('参数校验：不认识的参数、缺必填、超长、越界、枚举外一律不进 run；默认值补齐', async () => {
  const ok = await reg.call('test.strict', { q: '要求' }, {});
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data.got, { q: '要求', n: 2, mode: 'a' }, '默认值补上，没给的可选项不出现');

  const cases = [
    [{}, /q 是必填/],
    [{ q: '要求', zz: 1 }, /不是这个工具认识的参数/],
    [{ q: 'x'.repeat(11) }, /太长/],
    [{ q: 'x', n: 9 }, /不能大于 5/],
    [{ q: 'x', n: 1.5 }, /要是整数/],
    [{ q: 'x', mode: 'c' }, /只能是/],
    [{ q: 123 }, /要是字符串/],
  ];
  for (const [args, re] of cases) {
    const r = await reg.call('test.strict', args, {});
    assert.equal(r.ok, false, JSON.stringify(args) + ' 应该被挡下');
    assert.match(r.error, re);
  }
  assert.equal((await reg.call('没有这个名字', {}, {})).ok, false);
});

test('超时有上限：工具卡住就返回超时错误，不把整条链挂死', async () => {
  const t0 = Date.now();
  const r = await reg.call('test.slow', {}, { timeoutMs: 1000 });
  assert.equal(r.ok, false);
  assert.match(r.error, /超时/);
  assert.ok(Date.now() - t0 < 2500, '真的在 1 秒量级返回，没等满 3 秒');
});

test('工具自己抛异常：当失败返回，不让调用方崩', async () => {
  const r = await reg.call('test.boom', {}, {});
  assert.equal(r.ok, false);
  assert.match(r.error, /里面炸了/);
});

test('结果太长：先丢后面的条目，只剩一条还超就切它的文本，给出去的永远是完整 JSON', async () => {
  const many = await reg.call('test.big', {}, {});
  assert.equal(many.ok, true);
  assert.equal(many.truncated, true);
  assert.ok(many.items.length < 40 && many.items.length > 0);
  assert.ok(JSON.stringify(many).length <= reg.MAX_CHARS + 200);
  JSON.parse(JSON.stringify(many));   // 结构完整

  const one = await reg.call('test.big', { one: true }, {});
  assert.equal(one.truncated, true);
  assert.equal(one.items.length, 1);
  assert.ok(one.items[0].text.length < 20000);
  assert.equal(one.items[0].ref, 'x:1', '切文本不把 ref 切没');
});

test('审计：每次调用落一行，像密钥的参数不落盘；没有数据目录就只记日志不留文件', async () => {
  const dir = tmp('reg-audit');
  await reg.call('test.strict', { q: '密钥', token: 'xoxp-1234567890-abcdef' }, { dataDir: dir, caller: 'mcp', sessionId: 'sess-1' });
  const rows = lines(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'test.strict');
  assert.equal(rows[0].ok, true);
  assert.equal(rows[0].caller, 'mcp');
  assert.equal(rows[0].sessionId, 'sess-1');
  assert.equal(rows[0].args.token, '<已隐藏>');
  assert.equal(rows[0].args.q, '密钥');
  assert.ok(typeof rows[0].at === 'string' && rows[0].at.endsWith('Z'));
  assert.doesNotMatch(fs.readFileSync(reg.auditFile(dir), 'utf8'), /xoxp-/, '口令一个字都没进文件');

  const logged = [];
  const before = fs.existsSync(path.join(process.cwd(), 'state'));
  await reg.call('test.strict', { q: 'x' }, { log: m => logged.push(m) });
  assert.equal(logged.length, 1);
  assert.match(logged[0], /未落审计/);
  assert.equal(fs.existsSync(path.join(process.cwd(), 'state')), before, '没在仓库目录里留下 state/');
});

test('清单：没接上的工具照样列出来并写清缺什么；真正调用它时给同一句话', async () => {
  const all = reg.list({}, {});
  const off = all.find(x => x.name === 'test.off');
  assert.equal(off.available, false);
  assert.match(off.reason, /未接/);
  assert.equal((await reg.call('test.off', {}, {})).error, '未接：这台机器上没配这个');

  // 清单是全量的，写类也在，但带着 level 让上层自己挡（HTTP 路由和 MCP 桥就是按这个字段过滤的）
  assert.ok(all.some(x => x.name === 'lark.task.create' && x.level === 'write'));
  assert.ok(all.every(x => ['read', 'write'].includes(x.level)));
  assert.ok(all.every(x => x.input && x.input.type === 'object'), '每条都有 object 型 schema，MCP 那边直接用');
  assert.deepEqual([...reg.names()].sort(), reg.names(), '清单顺序固定，两家模型拿到的字节才一样');
});

test('重名和名字格式在登记时就挡住，不留到运行时', () => {
  assert.throws(() => reg.register({ name: 'test.strict', level: 'read', source: 'local', run() {} }), /重名/);
  assert.throws(() => reg.register({ name: 'BadName', level: 'read', source: 'local', run() {} }), /工具名/);
  assert.throws(() => reg.register({ name: 'test.nolevel', level: 'other', source: 'local', run() {} }), /level/);
  assert.throws(() => reg.register({ name: 'test.nosource', level: 'read', source: 'ftp', run() {} }), /source/);
  assert.throws(() => reg.register({ name: 'test.norun', level: 'read', source: 'local' }), /没有 run/);
});
