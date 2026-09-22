'use strict';
// 本机 MCP 出口。这条路是给外面的 agent（claude -p 之类）用的，所以门禁要在服务端那一份，
// 不能靠桥自己自觉。这里起一个真的听会台服务 + 真的桥进程，盯住：
//   ① /tools 和 /tools/call 的鉴权跟现有路由同一套（本机放行 + token）
//   ② /tools/call 只接读类工具，写类一律 403（不是「失败」，是根本不让走）
//   ③ 桥的 tools/list 里连写类工具的名字都没有
//   ④ 桥的 stdout 只出协议帧，日志一律走 stderr（掺一行日志就会把 MCP 客户端弄崩）
//   ⑤ /health 报得出工具接了几个、没接的缺什么
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const pause = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const write = (f, j) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof j === 'string' ? j : JSON.stringify(j)); };

const TOKEN = 'm'.repeat(32);

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-mcp-'));
  write(path.join(dir, 'settings.json'), { RELAY_TOKEN: TOKEN, ARCHIVE_TARGET: 'local' });
  write(path.join(dir, 'state/meeting-pipeline/m.job.enhanced.json'), {
    id: 'sess-mcp-1', topicTitle: '端云切分与功耗账', start: '2026-09-17T09:58:17.476Z',
    brief: { overview: { conclusions: ['算法尽量放在片上，MCU 优先'], todos: [], topics: [] } },
    transcript: [{ t: 1, text: '端侧 ASR 的功耗账要和 always-on 摄像头放在一起比' }],
  });
  return dir;
}

// 一个桥进程，按行收发 JSON-RPC；同时把 stdout 原样留着，供「只出协议帧」那条断言用
function bridge(dir, port) {
  const child = spawn(process.execPath, [path.join(root, 'app/mcp-bridge.js')],
    { env: { ...process.env, THT_DATA_DIR: dir, THT_PORT: String(port) }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', errOut = '';
  const waiters = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', d => {
    out += d;
    let nl;
    while ((nl = out.indexOf('\n')) >= 0) {
      const line = out.slice(0, nl); out = out.slice(nl + 1);
      if (!line.trim()) continue;
      let j; try { j = JSON.parse(line); } catch (e) { j = { _bad: line }; }
      const w = waiters.get(j && j.id);
      if (w) { waiters.delete(j.id); w(j); }
    }
    raw.push(d);
  });
  const raw = [];
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', d => { errOut += d; });
  let seq = 0;
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    waiters.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n');
    setTimeout(() => { if (waiters.has(id)) { waiters.delete(id); reject(new Error('桥没回 ' + method)); } }, 20000);
  });
  const notify = m => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: m }) + '\n');
  return { child, rpc, notify, raw: () => raw.join(''), err: () => errOut, stop: () => { try { child.stdin.end(); child.kill('SIGKILL'); } catch (e) {} } };
}

test('MCP 出口端到端：初始化 → 列工具 → 调一个读类工具；写类连名字都不出现，stdout 只出协议帧', async () => {
  const dir = fixture(), port = await freePort();
  const base = 'http://127.0.0.1:' + port + '/asr-relay';
  const server = spawn(process.execPath, [path.join(root, 'app/server.js')],
    { env: { ...process.env, THT_DATA_DIR: dir, THT_PORT: String(port), THT_NO_OPEN: '1', THT_TEST: '1' }, stdio: 'ignore' });
  let br = null;
  try {
    for (let i = 0; i < 120; i++) { try { if ((await fetch('http://127.0.0.1:' + port + '/health')).ok) break; } catch (e) {} await pause(100); }

    // ---- 路由本身 ----
    // 鉴权照现有路由那一套：本机来的请求直接放行，外来的要 token。测试跑在本机，
    // 所以这里验的是「带 token 能用」，「没 token 从外面进不来」由 isLocalReq 那一份统一保证。
    const listed = await (await fetch(base + '/tools?token=' + TOKEN)).json();
    assert.equal(listed.ok, true);
    assert.ok(listed.tools.some(t => t.name === 'meetings.search' && t.level === 'read'));
    assert.ok(listed.tools.some(t => t.name === 'lark.task.create' && t.level === 'write'));

    const post = (body) => fetch(base + '/tools/call?token=' + TOKEN, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const readRes = await post({ name: 'meetings.search', args: { query: '端侧 ASR 功耗' } });
    assert.equal(readRes.status, 200);
    const readJson = await readRes.json();
    assert.equal(readJson.ok, true);
    assert.ok(readJson.items.some(x => x.meetingId === 'sess-mcp-1'));

    for (const w of ['lark.task.create', 'lark.calendar.create']) {
      const r = await post({ name: w, args: {} });
      assert.equal(r.status, 403, w + ' 必须 403，不是失败');
      assert.match((await r.json()).error, /只接读类工具/);
    }
    assert.equal((await post({ name: '不存在的工具', args: {} })).status, 404);
    assert.equal((await fetch(base + '/tools/call?token=' + TOKEN)).status, 405, 'GET 不接');

    // ---- /health ----
    const h = await (await fetch('http://127.0.0.1:' + port + '/health?token=' + TOKEN)).json();
    assert.equal(typeof h.tools.total, 'number');
    assert.ok(h.tools.total >= 13);
    assert.ok(h.tools.available >= 3, '本机这几条读类工具是接上的');
    assert.ok(Array.isArray(h.tools.unavailable));
    for (const u of h.tools.unavailable) { assert.ok(u.name); assert.ok(u.reason); }
    assert.doesNotMatch(JSON.stringify(h.tools), new RegExp(TOKEN), '健康信息里不带口令');

    // ---- 桥 ----
    br = bridge(dir, port);
    const init = await br.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'tinghuitai');
    br.notify('notifications/initialized');
    assert.deepEqual((await br.rpc('ping')).result, {});

    const tools = (await br.rpc('tools/list')).result.tools;
    assert.ok(tools.some(t => t.name === 'meetings_search'), '点号换成下划线');
    assert.ok(tools.every(t => t.inputSchema && t.inputSchema.type === 'object'));
    for (const forbidden of ['lark_task_create', 'lark_calendar_create', 'lark.task.create']) {
      assert.equal(tools.some(t => t.name === forbidden), false, forbidden + ' 不该出现在 MCP 清单里');
    }

    const called = await br.rpc('tools/call', { name: 'meetings_search', arguments: { query: '端侧 ASR 功耗' } });
    assert.equal(called.result.isError, false);
    const payload = JSON.parse(called.result.content[0].text);
    assert.equal(payload.ok, true);
    assert.ok(payload.items.some(x => x.meetingId === 'sess-mcp-1'));

    // 写类工具从桥这边点名也拿不到
    const blocked = await br.rpc('tools/call', { name: 'lark_task_create', arguments: {} });
    assert.equal(blocked.result.isError, true);
    assert.match(blocked.result.content[0].text, /没有这个工具/);

    const unknown = await br.rpc('nope/method');
    assert.equal(unknown.error.code, -32601);

    // stdout 一行一帧，没有任何日志混进来
    for (const line of br.raw().split('\n').filter(x => x.trim())) {
      const j = JSON.parse(line);   // 解析不了就在这里炸，正是要盯的
      assert.equal(j.jsonrpc, '2.0');
    }
    assert.match(br.err(), /已启动/, '日志确实走了 stderr');
  } finally {
    if (br) br.stop();
    server.kill('SIGKILL');
  }
});

test('听会台服务没起时：桥不假装成功，给一句说得清的话', async () => {
  const dir = fixture(), port = await freePort();   // 这个端口上没有服务
  const br = bridge(dir, port);
  try {
    const r = await br.rpc('tools/list');
    assert.ok(r.error, '列不出来就报错，不给空清单让对面以为没工具');
    assert.match(r.error.message, /连不上本机听会台服务/);
    assert.match(r.error.message, /先把听会台跑起来/);
  } finally { br.stop(); }
});

test('数据目录里没有 RELAY_TOKEN：直说缺什么，不去猜一个', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-mcp-bare-'));
  write(path.join(dir, 'settings.json'), { ARCHIVE_TARGET: 'local' });
  const br = bridge(dir, 47911);
  try {
    const r = await br.rpc('tools/list');
    assert.match(r.error.message, /RELAY_TOKEN/);
  } finally { br.stop(); }
});
