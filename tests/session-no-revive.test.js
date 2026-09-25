// 09-24 双记录 bug：同一场会被存成两场（muex6gxj13t1 / muex89wyoux4，84 秒间隔）。
// 事件日志：收尾时归档入队抛「本场正在归档」→ saved=false、日志没标 complete → 场次移出内存；旧标签页拿旧 id 重连，服务端当新会开了第二场。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const { spawn } = require('child_process'); const WS = require('ws');
const root = path.join(__dirname, '..'), pause = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const TOKEN = 'n'.repeat(32);
test('已落 pending 的场次 id 不能被重连复活（4409）；新 id 照常开', { timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revive-')), port = await freePort();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ RELAY_TOKEN: TOKEN, ARCHIVE_TARGET: 'local', LLM_CHAIN: [] }));
  fs.mkdirSync(path.join(dir, 'pending'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pending', 'sess-old1.json'), JSON.stringify({ id: 'old1', title: 'AIHW', transcript: [] }));
  const child = spawn(process.execPath, [path.join(root, 'app/server.js')], { env: { ...process.env, HOME: dir, THT_DATA_DIR: dir, THT_PORT: String(port), THT_NO_OPEN: '1', THT_TEST: '1', THT_LARK_CLI: '/usr/bin/false' }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch('http://127.0.0.1:' + port + '/health')).status) break; } catch (e) {} await pause(100); }
    const open = async sid => { const ws = new WS('ws://127.0.0.1:' + port + '/?token=' + TOKEN); await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
      return new Promise(res => { ws.once('close', code => res({ code })); ws.on('message', m => { const j = JSON.parse(m.toString()); if (j.type === 'snapshot') res({ snap: j, ws }); }); ws.send(JSON.stringify({ type: 'start', sessionId: sid, rate: 16000, source: 'mac' })); }); };
    const a = await open('old1'); assert.equal(a.code, 4409, '收过尾的旧 id 必须拒');
    const b = await open('new1'); assert.ok(b.snap && b.snap.session && b.snap.session.id === 'new1'); b.ws.close(); await pause(300);
    const c = await open('new1'); assert.ok(c.snap && c.snap.session && c.snap.session.id === 'new1', '未落 pending 的会中场次断线重连必须放行'); c.ws.close();
  } finally { child.kill('SIGKILL'); }
});
test('收尾时归档入队抛错不再让 saved=false', () => {
  const s = fs.readFileSync(path.join(root, 'app/server.js'), 'utf8');
  assert.match(s, /try\{if\(this\.transcript\.length\|\|[^\n]*meetingPipeline\.enqueue\(sess\);\}catch\(e\)\{log\('归档入队没成/);
});
