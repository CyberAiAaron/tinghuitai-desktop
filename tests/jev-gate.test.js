'use strict';
// 逐句门卫（app/jev-gate.js，主动智能需求单 F1 · 批 1 验收）：
//   ① 命中（noul ≥ 阈值且 kind ≠ none）→ 立刻分诊，绕过「≥60 新字」，prompt 里带【门卫标记】
//   ② 未命中 → 不触发
//   ③ 超时 / 5xx → 重试 1 次后按未命中处理，failures +1，不阻塞
//   ④ 间隔内多次命中合并成一次触发
//   ⑤ JEV_GATE=off（或没密钥）→ 一次都不调
// 前半是模块级（假 fetch），后半起真服务 + 本机假 Jev 接口（THT_JEV_URL 只在 THT_TEST 下认）+ 假命令行模型。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), http = require('http');
const { spawn } = require('child_process'); const WS = require('ws');
const root = path.join(__dirname, '..'), pause = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const G = require(path.join(root, 'app/jev-gate.js'));

const answer = (noul, choice) => ({ model: 'jev-1.13.0', answers: { worth: { type: 'noul', noul }, kind: { type: 'choice', choice, confidence: 0.9 } }, usage: { input_tokens: 42 } });
const okFetch = body => async () => ({ ok: true, status: 200, json: async () => body });
const ENV = { JEV_API_KEY: 'k'.repeat(20), JEV_GATE: 'on' };

test('settingsOf：on 且有密钥才 enabled；阈值 / 间隔非法回默认', () => {
  assert.equal(G.settingsOf({}).enabled, false);
  assert.equal(G.settingsOf({ JEV_GATE: 'on' }).enabled, false, '没密钥不能启用');
  assert.equal(G.settingsOf({ JEV_GATE: 'off', JEV_API_KEY: 'x' }).enabled, false);
  const s = G.settingsOf({ ...ENV, JEV_THRESHOLD: 'abc', JEV_MIN_GAP_MS: '-1' });
  assert.equal(s.enabled, true); assert.equal(s.threshold, 0.5); assert.equal(s.minGapMs, 2000);
  assert.equal(G.settingsOf({ ...ENV, JEV_THRESHOLD: '0.7', JEV_MIN_GAP_MS: '300' }).threshold, 0.7);
  assert.equal(G.buildState(['甲', '乙'], '丙'), '上文：甲\n上文：乙\n当前句：丙');
  assert.equal(G.buildState([], '丙'), '当前句：丙');
});

test('judge：命中 / 未命中 / none 不算命中 / 请求形状对', async () => {
  const seen = [];
  const f = async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, json: async () => answer(0.67, 'claim') }; };
  const r = await G.judge({ env: ENV, prev: ['上一句', '再上一句'], text: '流失率是 4.1%', fetchImpl: f });
  assert.deepEqual({ hit: r.hit, kind: r.kind, noul: r.noul, error: r.error }, { hit: true, kind: 'claim', noul: 0.67, error: '' });
  assert.equal(seen.length, 1); assert.equal(seen[0].url, G.JEV_URL);
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.model, 'jev-latest'); assert.equal(body.state, '上文：上一句\n上文：再上一句\n当前句：流失率是 4.1%');
  assert.deepEqual(Object.keys(body.questions), ['worth', 'kind']); assert.equal(body.questions.worth.type, 'noul'); assert.equal(body.questions.kind.type, 'choice');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer ' + ENV.JEV_API_KEY);
  assert.equal((await G.judge({ env: ENV, text: '嗯', fetchImpl: okFetch(answer(0.12, 'none')) })).hit, false, '低分不命中');
  assert.equal((await G.judge({ env: ENV, text: '嗯', fetchImpl: okFetch(answer(0.9, 'none')) })).hit, false, 'kind=none 不命中');
  assert.equal((await G.judge({ env: { ...ENV, JEV_THRESHOLD: '0.7' }, text: 'x', fetchImpl: okFetch(answer(0.67, 'claim')) })).hit, false, '阈值可调');
});

test('judge：5xx 重试 1 次后失败=未命中；超时也是；坏返回也是；账本记 provider jev', async () => {
  let n = 0; const bad = async () => { n++; return { ok: false, status: 503, json: async () => ({}) }; };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-usage-'));
  const r = await G.judge({ env: ENV, text: 'x', fetchImpl: bad, dataDir: dir, sessionId: 's1' });
  assert.equal(n, 2, '失败重试 1 次 = 共 2 次请求'); assert.equal(r.hit, false); assert.match(r.error, /HTTP 503/);
  const slow = (url, init) => new Promise((res, rej) => { init.signal.addEventListener('abort', () => { const e = Error('aborted'); e.name = 'AbortError'; rej(e); }); });
  const t = await G.judge({ env: ENV, text: 'x', fetchImpl: slow, timeoutMs: 40, retries: 0, dataDir: dir });
  assert.equal(t.hit, false); assert.match(t.error, /timeout/);
  const junk = await G.judge({ env: ENV, text: 'x', fetchImpl: okFetch({ nope: 1 }), retries: 0, dataDir: dir });
  assert.equal(junk.hit, false); assert.ok(junk.error);
  const ok = await G.judge({ env: ENV, text: 'x', fetchImpl: okFetch(answer(0.8, 'todo')), dataDir: dir, sessionId: 's1' });
  assert.equal(ok.hit, true);
  const rows = fs.readFileSync(path.join(dir, 'state/usage.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 4, '每次 judge 记一行（含失败）');
  assert.ok(rows.every(x => x.provider === 'jev' && x.purpose === 'jev-gate' && typeof x.ms === 'number'));
  assert.equal(rows[3].in, 42); assert.equal(rows[3].est, false); assert.equal(rows[3].hit, true); assert.equal(rows[3].kind, 'todo');
  assert.equal(rows[0].error.includes('503'), true); assert.equal(rows[0].est, true);
  assert.ok(!JSON.stringify(rows).includes(ENV.JEV_API_KEY), '账本里不能有密钥');
});

test('Gate：间隔内多次命中合并成一次；分诊在跑时并入下一次；off 零调用', async () => {
  let clock = 100000; const now = () => clock; let fired = 0; let calls = 0;
  const f = async () => { calls++; return { ok: true, status: 200, json: async () => answer(0.9, 'promise') }; };
  const g = new G.Gate({ env: { ...ENV, JEV_MIN_GAP_MS: '200' }, sessionId: 's', fetchImpl: f, now, onTrigger: () => fired++ });
  const row = (i, t) => ({ at: i * 10, text: t });
  await g.onFinal(row(1, '我回头把 BOM 表发给 Cary'), 0, []);
  assert.equal(fired, 1, '第一次命中立刻触发');
  clock += 50; await g.onFinal(row(2, '下周前给'), 1, ['a']);
  clock += 50; await g.onFinal(row(3, '再补一版'), 2, ['a', 'b']);
  assert.equal(fired, 1, '间隔内的命中不立刻再触发'); assert.equal(g.stats.merged, 2);
  assert.equal(g.marksBlock(3).split('\n').filter(l => /^\[\d+s\] promise：/.test(l)).length, 3, '三句都进【门卫标记】');
  assert.equal(g.marksBlock(2).includes('再补一版'), false, '标记块只给这轮覆盖到的下标');
  g.consume(2); assert.equal(g.marks.length, 1, '分诊过的标记清掉，没覆盖到的留着');
  clock += 200; await pause(260);
  assert.equal(fired, 2, '到点后合并成的那一次触发');
  // 分诊在跑：Session 会调 deferWhileBusy；这轮结束 takeDeferred → requestTrigger（仍按间隔）
  g.deferWhileBusy(); assert.equal(g.takeDeferred(), true); assert.equal(g.takeDeferred(), false);
  assert.deepEqual([g.stats.calls, g.stats.hits, g.stats.failures, g.stats.triggers], [3, 3, 0, 2]);
  g.close(); clock += 1000; g.requestTrigger(); assert.equal(fired, 2, 'close 后不再触发');
  const off = new G.Gate({ env: { ...ENV, JEV_GATE: 'off' }, fetchImpl: f, onTrigger: () => { throw Error('off 不该触发'); } });
  const before = calls; assert.equal(await off.onFinal(row(9, '决定了'), 0, []), null); assert.equal(calls, before, 'off 一次 fetch 都没有');
  assert.equal(off.enabled, false);
});

// ── 真服务 ─────────────────────────────────────────────────────────────────────────
const TOKEN = 'g'.repeat(48);
function fakeCli(dir, tag) {
  const bin = path.join(dir, tag + '.sh'), seen = path.join(dir, 'seen-' + tag); fs.mkdirSync(seen, { recursive: true });
  fs.writeFileSync(bin, `#!/bin/sh\nN=$(ls "${seen}" | wc -l | tr -d ' ')\ncat > "${seen}/in-$N.txt"\nprintf '%s' '{"highlights":[{"text":"要点 '"$N"'"}],"todos":[],"insights":[]}'\n`);
  fs.chmodSync(bin, 0o755);
  return { bin, files: () => fs.readdirSync(seen).sort(), read: f => fs.readFileSync(path.join(seen, f), 'utf8') };
}
// 假 Jev：按「当前句」里的关键字决定答案；记下每次请求
function fakeJev() {
  const seen = [];
  const srv = http.createServer((rq, rs) => {
    let b = ''; rq.on('data', c => b += c); rq.on('end', () => {
      const j = JSON.parse(b); seen.push({ auth: rq.headers.authorization, state: j.state });
      const cur = (j.state.split('\n').pop() || '');
      if (cur.includes('挂掉')) { rs.writeHead(503); return rs.end('{}'); }
      const hit = cur.includes('方案') || cur.includes('回头');   // 故意避开 Session.TRIGGERS（决定 / 截止 / 负责…），否则深推理会再叫一次模型，数不清
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      rs.end(JSON.stringify(answer(hit ? 0.88 : 0.1, hit ? (cur.includes('方案') ? 'decision' : 'promise') : 'none')));
    });
  });
  return { srv, seen };
}
async function startServer({ gate, jevUrl, cli, dir, port, extra = {} }) {
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ RELAY_TOKEN: TOKEN, ARCHIVE_TARGET: 'local', MEMORY_PROJECTION_DIR: path.join(dir, 'mem'),
    JEV_API_KEY: 'test-key-' + 'z'.repeat(16), JEV_GATE: gate, JEV_MIN_GAP_MS: '1500', JEV_THRESHOLD: '0.5',
    LLM_CHAIN: [{ type: 'cli', kind: 'custom', name: '快家', bin: cli.bin, stdin: 'prompt' }], ...extra }));
  const child = spawn(process.execPath, [path.join(root, 'app/server.js')],
    { env: { ...process.env, THT_DATA_DIR: dir, THT_PORT: String(port), THT_NO_OPEN: '1', THT_TEST: '1', THT_LARK_CLI: '/usr/bin/false', THT_JEV_URL: jevUrl }, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (e) {} await pause(100); }
  const ws = new WS('ws://127.0.0.1:' + port + '/?token=' + TOKEN);
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  await new Promise(res => { ws.once('message', () => res()); ws.send(JSON.stringify({ type: 'start', sessionId: 'jev-' + gate, rate: 16000, source: 'mac' })); });
  return { child, ws, base, health: async () => (await (await fetch(base + '/health')).json()) };
}
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await pause(50); } return fn(); };

test('真服务 JEV_GATE=on：命中立刻分诊（不足 60 字也触发）并带【门卫标记】；未命中不触发；5xx 记 failures；间隔内合并', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemate-jev-on-')), port = await freePort(), cli = fakeCli(dir, 'fast');
  const jev = fakeJev(); const jp = await freePort(); await new Promise(r => jev.srv.listen(jp, '127.0.0.1', r));
  const S = await startServer({ gate: 'on', jevUrl: 'http://127.0.0.1:' + jp + '/systemone', cli, dir, port });
  const say = text => S.ws.send(JSON.stringify({ type: '__test_final', text }));
  try {
    const h0 = await S.health();
    assert.deepEqual({ enabled: h0.jev.enabled, available: h0.jev.available, calls: h0.jev.calls, hits: h0.jev.hits, failures: h0.jev.failures }, { enabled: true, available: true, calls: 0, hits: 0, failures: 0 });
    // ② 未命中：Jev 被问了，分诊没被叫
    say('嗯，对。'); await until(() => jev.seen.length >= 1);
    await pause(400); assert.equal(cli.files().length, 0, '未命中不该分诊');
    assert.equal((await S.health()).jev.hits, 0);
    // ① 命中：这句只有 12 字（<60），照样立刻分诊，prompt 带【门卫标记】
    say('那就走 B 方案吧，大家都同意。');
    await until(() => jev.seen.length >= 2);
    // ④ 紧跟着（间隔 1500ms 内）连续 3 句命中 → 并进下一次，不立刻再分诊
    say('这个我回头弄一下。'); say('那个也回头补。'); say('第三件回头发你。');
    await until(() => jev.seen.length >= 5);
    assert.ok(await until(() => cli.files().length >= 1), '命中后没触发分诊');
    const p1 = cli.read(cli.files()[0]);
    assert.ok(p1.includes('【门卫标记】'), 'prompt 里没有【门卫标记】');
    assert.match(p1, /\[\d+s\] decision：那就走 B 方案吧，大家都同意。/);
    assert.ok(p1.lastIndexOf('【门卫标记】') < p1.lastIndexOf('【最新转写】'), '标记块在最新转写之前');
    assert.ok(!p1.includes('test-key-'), 'prompt 里不能出现 Jev 密钥');
    assert.equal(jev.seen[0].auth, 'Bearer test-key-' + 'z'.repeat(16));
    let h = await S.health(); assert.equal(h.jev.hits, 4); assert.equal(h.jev.calls, 5);
    await pause(300); assert.equal(cli.files().length, 1, '间隔内不该立刻再分诊');
    assert.ok(await until(() => cli.files().length >= 2, 4000), '到点后合并那一次没来');
    await pause(800); assert.equal(cli.files().length, 2, '三次命中合并后只该多一次');
    const p2 = cli.read(cli.files()[1]);
    for (const s of ['这个我回头弄一下', '那个也回头补', '第三件回头发你']) assert.ok(p2.includes('promise：' + s), '合并那轮缺标记：' + s);
    assert.ok(!p2.includes('decision：那就走 B 方案吧'), '上一轮分诊过的标记不该再带');
    h = await S.health(); assert.equal(h.jev.hits, 4); assert.equal(h.jev.failures, 0);
    // ③ 5xx：重试 1 次后按未命中，failures +1，不触发分诊
    const before = jev.seen.length; say('接口要挂掉了这句');
    await until(() => jev.seen.length >= before + 2);
    assert.equal(jev.seen.length, before + 2, '5xx 应重试 1 次（共 2 次请求）');
    assert.ok(await until(async () => (await S.health()).jev.failures === 1), 'failures 没 +1');
    await pause(300); assert.equal(cli.files().length, 2, '失败不该触发分诊');
    h = await S.health(); assert.equal(h.jev.sessions['jev-on'].calls, 6); assert.equal(h.jev.sessions['jev-on'].hits, 4); assert.equal(h.jev.sessions['jev-on'].failures, 1); assert.equal(h.jev.sessions['jev-on'].triggers, 2);
    // 账本：provider jev，6 行，不含密钥
    const rows = fs.readFileSync(path.join(dir, 'state/usage.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter(x => x.provider === 'jev');
    assert.equal(rows.length, 6); assert.ok(rows.every(x => x.sessionId === 'jev-on'));
    assert.ok(!fs.readFileSync(path.join(dir, 'state/usage.jsonl'), 'utf8').includes('test-key-'));
  } finally { try { S.ws.close(); } catch (e) {} S.child.kill('SIGKILL'); jev.srv.close(); }
});

test('真服务 JEV_GATE=off：Jev 零调用，/health 报 enabled=false，分诊仍按老规矩（≥60 字）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemate-jev-off-')), port = await freePort(), cli = fakeCli(dir, 'fast');
  const jev = fakeJev(); const jp = await freePort(); await new Promise(r => jev.srv.listen(jp, '127.0.0.1', r));
  const S = await startServer({ gate: 'off', jevUrl: 'http://127.0.0.1:' + jp + '/systemone', cli, dir, port });
  try {
    S.ws.send(JSON.stringify({ type: '__test_final', text: '那就走 B 方案吧，大家都同意。' }));
    await pause(600);
    assert.equal(jev.seen.length, 0, 'off 时不许调 Jev'); assert.equal(cli.files().length, 0, 'off 时短句不该触发分诊');
    const h = await S.health();
    assert.equal(h.jev.enabled, false); assert.equal(h.jev.available, true); assert.equal(h.jev.calls, 0);
    // 老路仍通：≥60 字 + 显式触发
    await new Promise(res => { const on = m => { try { if (JSON.parse(m).type === '__test_triaged') { S.ws.off('message', on); res(); } } catch (e) {} }; S.ws.on('message', on);
      S.ws.send(JSON.stringify({ type: '__test_final', text: Array.from({ length: 12 }, (_, k) => '第一段词' + k).join('，'), triage: true })); });
    assert.equal(cli.files().length, 1); assert.ok(!cli.read(cli.files()[0]).includes('【门卫标记】'), 'off 时 prompt 不该有标记块');
    assert.equal(jev.seen.length, 0);
  } finally { try { S.ws.close(); } catch (e) {} S.child.kill('SIGKILL'); jev.srv.close(); }
});
