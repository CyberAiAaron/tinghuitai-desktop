'use strict';
// 旧场次兼容（Codex b0d361a5 复审 major #4）：0.6.14 之前的场次只有 factchecks（kind: fix/link/doubt…，带 note / evidence / verdict），没有 insights。
// 真起服务（THT_TEST），两条路都用只有 factchecks 的旧快照喂进去：
//   ① 会中恢复：state/live-sessions/<id>.json 是未结束的旧 journal → 说话人重连 start，收到的 snapshot 里 factchecks 原样回来
//   ② 回看：pending/sess-<id>.json 是已结束的旧场次 → GET /export-state?ids=<id>&full=1 里 factchecks 原样回来，/share-export 也能生成
// 全程抓 stderr，进程不许有 uncaughtException / unhandledRejection。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const { spawn } = require('child_process'); const WS = require('ws');
const root = path.join(__dirname, '..'), pause = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const TOKEN = 'l'.repeat(48);

// 旧格式的看法：没有 source / why，只有 note / evidence / verdict / label
const LEGACY_FACTCHECKS = [
  { id: 'f1', kind: 'doubt', label: '存疑', claim: '价格不是 599', note: '项目状态写的是 699', evidence: '我们定的 599', verdict: 'false', at: 1758500000000 },
  { id: 'f2', kind: 'link', label: '承诺回查', claim: '这件事 9 月 12 日《硬件例会》已承诺过', note: '当时是 S1 承诺的', evidence: '我下周再去要一下', verdict: 'true', at: 1758500060000 },
];

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemate-legacy-')), port = await freePort();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ RELAY_TOKEN: TOKEN, ARCHIVE_TARGET: 'local', MEMORY_PROJECTION_DIR: path.join(dir, 'mem') }));
  // ① 未结束的旧 journal（会中恢复用）
  fs.mkdirSync(path.join(dir, 'state', 'live-sessions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'state', 'live-sessions', 'legacy-live.json'), JSON.stringify({
    id: 'legacy-live', startTs: Date.now() - 60000, updated: Date.now(), title: '旧版会中', source: 'mac', complete: false,
    transcript: [{ id: 's1', at: 3, text: '我们定的 599', speaker: 'S1' }], highlights: [{ id: 'h1', text: '定价 599' }], todos: [], factchecks: LEGACY_FACTCHECKS,
  }));
  // ② 已结束的旧场次（回看用）
  fs.mkdirSync(path.join(dir, 'pending'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pending', 'sess-legacy-done.json'), JSON.stringify({
    id: 'legacy-done', title: '旧版回看', start: '2026-09-12T02:00:00.000Z', end: '2026-09-12T03:00:00.000Z', mode: 'online-火山', source: 'mac', names: {}, brief: '', fixes: [],
    transcript: [{ id: 's1', at: 3, text: '我们定的 599', speaker: 'S1' }], highlights: [{ id: 'h1', text: '定价 599' }], todos: [], factchecks: LEGACY_FACTCHECKS, summary: '',
  }));
  let stderr = '';
  const child = spawn(process.execPath, [path.join(root, 'app/server.js')],
    { env: { ...process.env, THT_DATA_DIR: dir, THT_PORT: String(port), THT_NO_OPEN: '1', THT_TEST: '1', THT_LARK_CLI: '/usr/bin/false', THT_CALENDAR_DELAY_MS: '0' }, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', d => { stderr += d; });
  for (let i = 0; i < 80; i++) { try { if ((await fetch('http://127.0.0.1:' + port + '/health')).ok) break; } catch (e) {} await pause(100); }
  return { dir, port, child, stderr: () => stderr, async done() { const exited = new Promise(r => { if (child.exitCode !== null || child.signalCode) return r(); child.once('exit', r); }); try { child.kill('SIGTERM'); } catch (e) {} await Promise.race([exited, pause(1500)]); fs.rmSync(dir, { recursive: true, force: true }); } };
}

const noCrash = t => assert.ok(!/uncaughtException|unhandledRejection|TypeError|ReferenceError/.test(t.stderr()), '进程报了异常：' + t.stderr().slice(0, 500));

test('会中恢复：旧 journal 只有 factchecks，重连后 snapshot 原样带回、不报错', async () => {
  const t = await setup();
  try {
    const ws = new WS('ws://127.0.0.1:' + t.port + '/?token=' + TOKEN);
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    const snap = await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('5s 没收到 snapshot')), 5000);
      ws.on('message', m => { try { const j = JSON.parse(String(m)); if (j.type === 'snapshot') { clearTimeout(timer); res(j); } } catch (e) {} });
      ws.send(JSON.stringify({ type: 'start', sessionId: 'legacy-live', rate: 16000, source: 'mac' }));
    });
    assert.equal(snap.session.id, 'legacy-live');
    assert.deepEqual(snap.session.factchecks, LEGACY_FACTCHECKS, '旧 factchecks 一条不少、字段不改');
    assert.deepEqual(snap.session.threads, {}, '旧场次没有 threads 字段，恢复后是空对象而不是 undefined');
    assert.equal(snap.session.highlights.length, 1);
    ws.close(); await pause(200);
    assert.equal((await (await fetch('http://127.0.0.1:' + t.port + '/health')).json()).activeSessions, 1);
    noCrash(t);
  } finally { await t.done(); }
});

test('回看：pending 里只有 factchecks 的旧场次，/export-state 与 /share-export 都正常返回原 factchecks', async () => {
  const t = await setup();
  try {
    const r = await (await fetch('http://127.0.0.1:' + t.port + '/export-state?ids=legacy-done&full=1&token=' + TOKEN)).json();
    assert.equal(r.sessions.length, 1);
    const s = r.sessions[0];
    assert.equal(s.id, 'legacy-done');
    assert.deepEqual(s.factchecks, LEGACY_FACTCHECKS, '回看接口把旧 factchecks 原样带回');
    assert.equal(s.transcript.length, 1);
    const ex = await (await fetch('http://127.0.0.1:' + t.port + '/share-export?id=legacy-done&token=' + TOKEN)).json();
    assert.equal(ex.ok, true, '分享导出应能生成：' + JSON.stringify(ex).slice(0, 200));
    assert.ok(typeof ex.markdown === 'string' && ex.markdown.length > 0);
    // 会中恢复的那场没被回看接口误当成同一场
    const all = await (await fetch('http://127.0.0.1:' + t.port + '/export-state?token=' + TOKEN)).json();
    assert.ok(all.sessions.some(x => x.id === 'legacy-done') && all.sessions.some(x => x.id === 'legacy-live' && x.recoveryStatus === 'interrupted'), '旧 journal 也在列表里、标为 interrupted');
    noCrash(t);
  } finally { await t.done(); }
});
