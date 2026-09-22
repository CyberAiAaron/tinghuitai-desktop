'use strict';
// 「这次整理看了哪些资料、哪一版」要事后查得到。用量账 state/usage.jsonl 每行记 contextHash + contextParts，
// 这个只读接口按 contextHash 把那份资料还原成人能看的东西：哪几块、各自哪个文件、什么版本、多少字。
// 本轮不做界面（Aaron：界面以后再说），先把接口和权限钉死。
// 权限：和别的接口同一套（本机直连或带口令）。默认只回元数据——资料原文是项目内部内容，
// 要全文得显式 &full=1，不能因为一次随手 GET 就整段吐出来。
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..'), APP = path.join(root, 'app');
const pause = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const TOKEN = 't'.repeat(32);

test('只读接口 /context-pack：没口令进不来、用途认不出就报错、默认不吐原文', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-ctxroute-'));
  const home = path.join(dir, 'home'); fs.mkdirSync(home, { recursive: true });
  const ctx = path.join(dir, 'ctx'); fs.mkdirSync(path.join(ctx, 'kb_reorg'), { recursive: true });
  fs.writeFileSync(path.join(ctx, 'kb_reorg', '02_总纲.md'), '【总纲】整机产品定义 v0.7。\n');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ RELAY_TOKEN: TOKEN, ARCHIVE_TARGET: 'local',
    PROJECT_CONTEXT_DIR: ctx, PROJECT_CONTEXT_FILES: ['kb_reorg/*.md'] }));
  const port = await freePort(), base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, [path.join(APP, 'server.js')], { stdio: 'ignore',
    env: { ...process.env, HOME: home, THT_DATA_DIR: dir, THT_PORT: String(port), THT_NO_OPEN: '1', THT_LARK_CLI: '/usr/bin/false' } });
  try {
    for (let i = 0; i < 80; i++) { try { await (await fetch(base + '/health')).json(); break; } catch (e) { await pause(100); } }
    // 带代理头 = 不算本机直连（tailscale funnel 会把外网请求转成 127.0.0.1，见 server.js 的 isLocalReq）
    const outside = { 'x-forwarded-for': '203.0.113.9' };
    assert.equal((await fetch(base + '/context-pack?purpose=review', { headers: outside })).status, 401);

    const bad = await fetch(base + '/context-pack?purpose=没有这个&token=' + TOKEN);
    assert.equal(bad.status, 400);
    assert.ok((await bad.json()).purposes.includes('post-summary'), '报错要顺手告诉调用方有哪些用途');

    const r = await fetch(base + '/context-pack?purpose=review&token=' + TOKEN);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.purpose, 'review');
    assert.equal(j.configured, true);
    assert.match(j.hash, /^[0-9a-f]{12}$/, 'hash 要能和用量账里的 contextHash 对上');
    assert.ok(j.chars > 0);
    assert.equal(j.text, undefined, '默认不该吐原文');
    const part = j.parts.find(x => /02_总纲/.test(x.key));
    assert.ok(part, '没说清带了哪一份：' + JSON.stringify(j.parts));
    assert.match(part.version, /#[0-9a-f]{8}$/, '版本号要能认出「是哪一版」');

    const full = await (await fetch(base + '/context-pack?purpose=review&full=1&token=' + TOKEN)).json();
    assert.ok(full.text.includes('整机产品定义 v0.7'), '要全文时才给全文');
    assert.equal(full.hash, j.hash, '同一份资料两次取，hash 要一样');

    // 会中那档没开会也能问：没有 session 就只有项目状态那一块，不该报错
    const live = await (await fetch(base + '/context-pack?purpose=live&token=' + TOKEN)).json();
    assert.equal(live.purpose, 'live');
    assert.ok(Array.isArray(live.parts));
  } finally { try { child.kill('SIGTERM'); } catch (e) {} await pause(200); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
});
