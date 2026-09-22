'use strict';
// 主动智能批 3（需求单 F3 / F4 / §5.3）：出处解析 + 两个动作 + POST /insight-action 路由。
// 出处解析只用这里造的小样本（不依赖真实 kb_backup 内容）；lark-cli 全部走假命令，绝不真外发。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const { spawn } = require('child_process'); const WS = require('ws');
const root = path.join(__dirname, '..'), pause = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const IA = require(path.join(root, 'app/insight-actions.js'));
const TOKEN = 'k'.repeat(40);

// ---------- 小样本资料 ----------
function fixtures() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemate-ia-kb-'));
  const board = (date, d3) => `v1.0 ｜ ${date}\n\n# 二、CDCP D1–D8\n\n| # | 决策 | 问题 | 选项 | 当前倾向 | Owner | 门 | 期限 | 状态 |\n|---|---|---|---|---|---|---|---|---|\n| D1 | Pin 与手机的绑定关系 | x | A/B/C | B：Pin 退出 KO 转预研 | Aaron | 单向 | 09-22 | [倾向→定] |\n| D3 | 新品类定义 | x | 三候选 | 流失率按 ${d3} 算；09-10 拍 | Shawn Liu | 单向 | 09-22 | [倾向] |\n\n# 四、决策日志\n\n- 09-12 暂停调价，按 4.1% 做\n`;
  fs.writeFileSync(path.join(dir, '决策板D1-D8_2026-09-10.md'), board('2026-09-10', '5.0%'));
  fs.writeFileSync(path.join(dir, '决策板D1-D8_2026-09-17.md'), board('2026-09-17', '6.3%'));
  fs.writeFileSync(path.join(dir, '产品需求总纲_2026-09-17.md'), '# 设计原则\n\n## 场景判据：两个筛子（顺序不能反）[定｜08-24]\n\n① 描述成本高不高 → ② 手机自己能不能干。\n\n顺序不能反，先问描述成本。\n\n# 硬件需求\n\n## 整机\n\n| 项 | 值 |\n|---|---|\n| 屏幕 | 5.5 寸 |\n| 首发价 | USD 500 |\n');
  const kbMap = { branches: [{ items: [{ title: '② 技术架构 v0.2', url: 'https://example.test/docx/UifYd8eGCoxyyuxEIZjlzBHNgae', id: 'd:UifYd8eGCoxyyuxEIZjlzBHNgae' }, { title: 'CDCP 汇报框架', url: 'https://example.test/docx/FRAMEWORKtoken0000000', id: 'd:FRAMEWORKtoken0000000' }] }] };
  return { dir, kbMap };
}
const inspectOk = async token => ({ ok: true, url: 'https://example.test/docx/' + token, title: '文档 ' + token.slice(0, 4) });
const inspectFail = async () => ({ ok: false, error: 'lark-cli 没跑起来' });

test('resolveSource：决策板 D3 → 最新一份的 D3 行、正确值取 claim 里「记的是 Y」、日期取文件名、链接由 lark-cli 回读', async () => {
  const { dir } = fixtures();
  const r = await IA.resolveSource('决策板 D3（2026-09-17）', ['D3'], { dir, claim: '会上说流失率 4.1%；决策板 D3 记的是 6.3%', evidence: '流失率是 4.1%', inspect: inspectOk });
  assert.equal(r.found, true); assert.equal(r.kind, 'board'); assert.equal(r.date, '2026-09-17', '取文件名日期最新的那份，不是 09-10');
  assert.ok(r.quote.startsWith('D3 新品类定义｜流失率按 6.3% 算') && r.quote.length <= 200, r.quote);
  assert.equal(r.value, '6.3%'); assert.equal(r.label, '决策板 D3');
  assert.deepEqual(r.doc, { title: '文档 A2hQ', url: 'https://example.test/docx/A2hQdjgAUoIV1vxecJzlFw57gId', token: 'A2hQdjgAUoIV1vxecJzlFw57gId' });
  // refs 没写 D 编号、source 只写「决策板」也能靠 needle 落到含那个数的段
  const r2 = await IA.resolveSource('决策板', [], { dir, claim: '会上说 09-12 没调价；决策板记的是 暂停调价', inspect: inspectOk });
  assert.equal(r2.found, true); assert.ok(r2.quote.includes('暂停调价'), r2.quote);
  // 没有这个 D、也没有数：如实说没有
  const r3 = await IA.resolveSource('决策板 D7', ['D7'], { dir, claim: '会上说 Trust owner 是 Marcus', inspect: inspectOk });
  assert.equal(r3.found, false); assert.equal(r3.message, '资料里没有这个数');
});

test('resolveSource：总纲小节按标题 / 编号定位，摘含正确值的那一段；正确值从 claim 或原文里取', async () => {
  const { dir } = fixtures();
  const r = await IA.resolveSource('产品需求总纲 §两个筛子', [], { dir, claim: '会上说筛子顺序可以反；总纲记的是 顺序不能反', evidence: '顺序可以反', inspect: inspectOk });
  assert.equal(r.found, true); assert.equal(r.kind, 'prd'); assert.ok(r.label.includes('两个筛子')); assert.ok(r.quote.includes('顺序不能反'), r.quote); assert.equal(r.value, '顺序不能反');
  assert.equal(r.doc.token, 'COqzdiAr6oGyX3xZb6alPLxQghg');
  const r2 = await IA.resolveSource('总纲 整机', [], { dir, claim: '会上说首发价 USD 600', evidence: '首发价 600 美元', inspect: inspectOk });
  assert.equal(r2.found, true); assert.ok(r2.quote.includes('USD 500'), r2.quote); assert.ok(['5.5寸', 'USD', '500'].some(v => r2.value.includes(v)), '原文里有、会上没说的那个数：' + r2.value);
  const r3 = await IA.resolveSource('产品需求总纲 §不存在的章', [], { dir, claim: '会上说 X', inspect: inspectOk });
  assert.equal(r3.found, false); assert.equal(r3.message, '资料里没有这个数');
});

test('resolveSource：《会名》日期 → memory.db 承诺 / 决定卡 → 会后台那场的页面', async (t) => {
  const mem = require(path.join(root, 'app/memory.js'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemate-ia-mem-'));
  const db = mem.open(dataDir); if (!db) { t.skip('这台 node 没有 sqlite'); return; }
  mem.putCard(db, { kind: 'promise', text: 'BOM 那个表回头发给 Cary', owner: 'Aaron', meeting_id: 'm-0912', meeting_title: '硬件例会', recorded_at: '2026-09-12T10:00:00Z' });
  mem.putCard(db, { kind: 'promise', text: '屏幕短名单下周给', owner: 'Shawn', meeting_id: 'm-0915', meeting_title: '硬件例会', recorded_at: '2026-09-15T10:00:00Z' });
  const r = await IA.resolveSource('《硬件例会》2026-09-12', [], { dir: '', db, claim: '这件事 09-12《硬件例会》已承诺过，记录里没看到落地', evidence: 'BOM 表我回头发' , inspect: inspectOk });
  assert.equal(r.found, true); assert.equal(r.kind, 'meeting'); assert.equal(r.quote, 'BOM 那个表回头发给 Cary'); assert.equal(r.date, '2026-09-12');
  assert.equal(r.doc.url, 'archive.html?id=m-0912'); assert.equal(r.doc.meetingId, 'm-0912');
  const r2 = await IA.resolveSource('09-15 硬件例会', [], { dir: '', db, claim: 'x', inspect: inspectOk });
  assert.equal(r2.found, true); assert.equal(r2.quote, '屏幕短名单下周给');
  const r3 = await IA.resolveSource('《不存在的会》2026-09-01', [], { dir: '', db, claim: 'x', inspect: inspectOk });
  assert.equal(r3.found, false);
});

test('resolveSource：其它文档名走 kb-map.json 查 token；lark-cli 回不出链接就不附链接；查不到只写来源名', async () => {
  const { dir, kbMap } = fixtures();
  const r = await IA.resolveSource('技术架构 v0.2', [], { dir: path.join(dir, 'nope'), kbMap, claim: 'x', inspect: inspectOk });
  assert.equal(r.found, false, '本机没有导出、摘不到原文 → 不编原文'); assert.equal(r.message, '资料里没有这个数');
  assert.equal(r.doc.url, 'https://example.test/docx/UifYd8eGCoxyyuxEIZjlzBHNgae', '链接还是附上');
  const r2 = await IA.resolveSource('CDCP 汇报框架', [], { dir, kbMap, claim: 'x', inspect: inspectFail });
  assert.deepEqual(r2.doc, { title: 'CDCP 汇报框架', url: '', token: 'FRAMEWORKtoken0000000', linkError: 'lark-cli 没跑起来' }, '回读失败 → 不附链接、不拿 kb-map 里存的旧链接顶（Codex 1edd4fc4）');
  const r3 = await IA.resolveSource('某个谁也没听过的文档', [], { dir, kbMap, claim: 'x', inspect: inspectOk });
  assert.deepEqual({ found: r3.found, message: r3.message, doc: r3.doc }, { found: false, message: '资料里没有这个数', doc: undefined });
  // 决策板 token 由 lark-cli 回读失败、kb-map 里也没有 → 有原文、没链接、说明原因
  const r4 = await IA.resolveSource('决策板 D1', ['D1'], { dir, kbMap, claim: '会上说 Pin 进 KO；决策板记的是 Pin 退出 KO', inspect: inspectFail });
  assert.equal(r4.found, true); assert.equal(r4.doc.url, ''); assert.equal(r4.doc.linkError, 'lark-cli 没跑起来');
});

test('openSource：写回 correction / quote / doc，找到才出冲突条；找不到写「资料里没有这个数」且不出冲突条', async () => {
  const { dir } = fixtures();
  const card = { id: 'c1', type: 'conflict', claim: '会上说流失率 4.1%；决策板 D3 记的是 6.3%', evidence: '流失率是 4.1%', source: '决策板 D3', refs: ['D3'] };
  const r = await IA.openSource({ card, env: { DECISION_BOARD_DIR: dir }, inspect: inspectOk });
  assert.equal(r.patch.correction, '记录：6.3%（决策板 D3，2026-09-17）'); assert.ok(r.patch.quote.includes('6.3%')); assert.equal(r.patch.doc.url, 'https://example.test/docx/A2hQdjgAUoIV1vxecJzlFw57gId');
  assert.equal(r.highlight, '⚠️ 冲突：会上 流失率是 4.1%，记录 6.3%（决策板 D3 2026-09-17）');
  const miss = await IA.openSource({ card: { ...card, source: '决策板 D8', refs: ['D8'], claim: '会上说预算 20M' }, env: { DECISION_BOARD_DIR: dir }, inspect: inspectOk });
  assert.equal(miss.patch.correction, '资料里没有这个数'); assert.equal(miss.patch.quote, ''); assert.equal(miss.highlight, '');
});

// 假 lark-cli 的 execFile：记下每次参数；contact 搜人按名字回；task +create 按模式文件决定成 / 败
function fakeExec(calls, opts = {}) {
  return (bin, args, o, cb) => {
    calls.push(args);
    const sub = args[0] + ' ' + args[1];
    if (sub === 'contact +search-user') { const q = args[args.indexOf('--queries') + 1]; return cb(null, JSON.stringify({ ok: true, data: { users: q === 'Cary Luo' ? [{ open_id: 'ou_cary', localized_name: 'Cary Luo', matched_query: 'Cary Luo' }] : [] } }), ''); }
    if (sub === 'task +create') { if (opts.fail) { const e = Error('boom'); return cb(e, '', '飞书拒绝'); } return cb(null, JSON.stringify({ ok: true, data: { task: { guid: 'g-1', url: 'https://example.test/task/g-1' } } }), ''); }
    if (sub === 'drive +inspect') return cb(null, JSON.stringify({ ok: true, data: { url: 'https://example.test/docx/' + args[3], title: 'T' } }), '');
    cb(Error('unexpected ' + sub), '', '');
  };
}

test('setDate：owner 解析到 → 派给他；解析不到 → 建给本人并写「代办对象」；没 owner → 本人；截止默认今天 +7；承诺卡写 due', async (t) => {
  const mem = require(path.join(root, 'app/memory.js'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemate-ia-set-'));
  const db = mem.open(dataDir);
  if (db) mem.putCard(db, { id: 'p-bom', kind: 'promise', text: 'BOM 那个表回头发给 Cary', owner: 'Aaron', meeting_id: 'm-0912', meeting_title: '硬件例会', recorded_at: '2026-09-12T10:00:00Z' });
  const card = { id: 'r1', type: 'recheck', claim: '这件事 09-12《硬件例会》已承诺过（BOM 表发给 Cary），记录里没看到落地', evidence: 'BOM 表我回头发', source: '硬件例会 2026-09-12', action: { do: 'set_date', args: {} } };
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }), plus7 = new Date(new Date(today + 'T00:00:00Z').getTime() + 7 * 86400e3).toISOString().slice(0, 10);
  let calls = [];
  let r = await IA.setDate({ card, args: { owner: 'Cary Luo' }, session: { id: 's1', title: '硬件周会' }, db, execImpl: fakeExec(calls) });
  let a = calls.find(x => x[1] === '+create');
  assert.equal(a[a.indexOf('--assignee') + 1], 'ou_cary'); assert.equal(a[a.indexOf('--due') + 1], plus7 + 'T18:00:00+08:00', '截止发成当天 18:00+08:00，裸日期在飞书会早一天'); assert.ok(a.includes('--as') && a[a.indexOf('--as') + 1] === 'user');
  assert.equal(r.patch.task.url, 'https://example.test/task/g-1'); assert.equal(r.patch.task.owner, 'Cary Luo'); assert.equal(r.patch.task.note, '');
  if (db) { const row = db.prepare('SELECT * FROM cards WHERE id=?').get('p-bom'); assert.equal(row.due, plus7, '同一件事的承诺卡写了 due'); assert.equal(row.owner, 'Cary Luo'); assert.ok(JSON.parse(row.source_refs).includes('https://example.test/task/g-1')); }
  calls = [];
  r = await IA.setDate({ card, args: { owner: '不存在的人', due: '2026-10-01' }, session: { id: 's1', title: '硬件周会' }, db: null, execImpl: fakeExec(calls) });
  a = calls.find(x => x[1] === '+create');
  assert.equal(a[a.indexOf('--assignee') + 1], IA.SELF_OPEN_ID, '解析不到建给本人'); assert.ok(a[a.indexOf('--description') + 1].includes('代办对象：不存在的人')); assert.equal(a[a.indexOf('--due') + 1], '2026-10-01T18:00:00+08:00');
  assert.equal(r.patch.task.note, '代办对象：不存在的人');
  calls = [];
  r = await IA.setDate({ card, args: {}, session: { id: 's1', title: '硬件周会' }, db: null, execImpl: fakeExec(calls) });
  assert.ok(!calls.some(x => x[0] === 'contact'), '没 owner 不去搜人'); a = calls.find(x => x[1] === '+create'); assert.equal(a[a.indexOf('--assignee') + 1], IA.SELF_OPEN_ID); assert.equal(r.patch.task.owner, '本人');
  // lark-cli 报错：抛出、definite（门禁允许重试）
  await assert.rejects(IA.setDate({ card, args: {}, session: {}, db: null, execImpl: fakeExec([], { fail: true }) }), e => e.definite === true && !e.uncertain);
  if (!db) t.diagnostic('这台 node 没有 sqlite，承诺卡那一段没验');
});

// ---------- 真服务：POST /insight-action ----------
function stubCli(dir) {
  const bin = path.join(dir, 'fake-lark-cli'), logFile = path.join(dir, 'cli-calls.log'), mode = path.join(dir, 'cli-mode');
  fs.writeFileSync(bin, `#!/bin/bash
printf '%s' "$*" | tr '\\n' ' ' >> ${JSON.stringify(logFile)}; printf '\\n' >> ${JSON.stringify(logFile)}
if [ -f ${JSON.stringify(mode)} ] && [ "$(cat ${JSON.stringify(mode)})" = "fail" ] && [ "$2" = "+create" ]; then echo '{"ok":false,"error":{"message":"飞书拒绝"}}'; exit 0; fi
if [ -f ${JSON.stringify(mode)} ] && [ "$(cat ${JSON.stringify(mode)})" = "hang" ] && [ "$2" = "+create" ]; then sleep 5; echo '{"ok":true,"data":{"task":{"guid":"g-late","url":"https://example.test/task/g-late"}}}'; exit 0; fi
case "$1 $2" in
  "task +create") echo '{"ok":true,"data":{"task":{"guid":"g-e2e","url":"https://example.test/task/g-e2e"}}}' ;;
  "drive +inspect") echo '{"ok":true,"data":{"url":"https://example.test/docx/'"$4"'","title":"决策板"}}' ;;
  "contact +search-user") echo '{"ok":true,"data":{"users":[]}}' ;;
  *) echo '{"ok":true,"data":{}}' ;;
esac
`);
  fs.chmodSync(bin, 0o755);
  return { bin, mode: m => { if (m) fs.writeFileSync(mode, m); else fs.rmSync(mode, { force: true }); }, calls: () => { try { return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean); } catch (e) { return []; } } };
}
async function startServer({ dir, port, cli, kb }) {
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ RELAY_TOKEN: TOKEN, ARCHIVE_TARGET: 'local', MEMORY_PROJECTION_DIR: path.join(dir, 'mem'), DECISION_BOARD_DIR: kb, INSIGHT_ACTION_GRACE_MS: 0, INSIGHT_ACTION_CLI_TIMEOUT_MS: 600, PHONE_TOKENS: ['p'.repeat(40)] }));
  const child = spawn(process.execPath, [path.join(root, 'app/server.js')], { env: { ...process.env, THT_DATA_DIR: dir, THT_PORT: String(port), THT_NO_OPEN: '1', THT_TEST: '1', THT_LARK_CLI: cli.bin }, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (e) {} await pause(100); }
  const ws = new WS('ws://127.0.0.1:' + port + '/?token=' + TOKEN);
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const msgs = []; ws.on('message', d => { try { msgs.push(JSON.parse(d.toString())); } catch (e) {} });
  await new Promise(res => { ws.once('message', () => res()); ws.send(JSON.stringify({ type: 'start', sessionId: 'ia-e2e', title: '硬件周会', rate: 16000, source: 'mac' })); });
  const addCard = card => new Promise(res => { const h = d => { const m = JSON.parse(d.toString()); if (m.type === '__test_insight_ok') { ws.off('message', h); res(m.id); } }; ws.on('message', h); ws.send(JSON.stringify({ type: '__test_insight', card })); });
  // 请求从 127.0.0.1 发出但带外部 Origin → 不算本机，只认口令（和 /thread 的测试口径一致）
  const post = async (body, q = 'token=' + TOKEN) => { const r = await fetch(base + '/asr-relay/insight-action?' + q, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://phone.example', 'sec-fetch-site': 'cross-site' }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => null) }; };
  return { child, ws, base, msgs, addCard, post };
}

test('POST /insight-action：鉴权、类型匹配、open_source 写回 + 冲突条广播、幂等、view 角色 403', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemate-ia-srv-')), port = await freePort(), cli = stubCli(dir), { dir: kb } = fixtures();
  const S = await startServer({ dir, port, cli, kb });
  try {
    const cid = await S.addCard({ type: 'conflict', claim: '会上说流失率 4.1%；决策板 D3 记的是 6.3%', evidence: '流失率是 4.1%', source: '决策板 D3', refs: ['D3'], why: '省一次翻决策板', action: { do: 'open_source', args: {} } });
    // 观众 / 副口令 / 没确认 / 类型不配
    let r = await S.post({ id: 'ia-e2e', cardId: cid, do: 'open_source', confirmed: true }, 'token=' + TOKEN + '&role=view'); assert.equal(r.status, 403);
    r = await S.post({ id: 'ia-e2e', cardId: cid, do: 'open_source', confirmed: true }, 'token=' + 'p'.repeat(40)); assert.equal(r.status, 403, '手机副口令只能看');
    r = await S.post({ id: 'ia-e2e', cardId: cid, do: 'open_source' }); assert.equal(r.status, 400); assert.match(r.j.error, /确认/);
    r = await S.post({ id: 'ia-e2e', cardId: cid, do: 'set_date', confirmed: true }); assert.equal(r.status, 400); assert.match(r.j.error, /这类卡没有这个动作/);
    r = await S.post({ id: 'ia-e2e', cardId: 'nope', do: 'open_source', confirmed: true }); assert.equal(r.status, 404);
    assert.equal(cli.calls().length, 0, '到这里一个 lark-cli 都没调');
    // 真做
    r = await S.post({ id: 'ia-e2e', cardId: cid, do: 'open_source', confirmed: true });
    assert.equal(r.status, 200); assert.equal(r.j.state.status, 'done');
    assert.equal(r.j.card.correction, '记录：6.3%（决策板 D3，2026-09-17）'); assert.ok(r.j.card.quote.includes('6.3%')); assert.equal(r.j.card.doc.url, 'https://example.test/docx/A2hQdjgAUoIV1vxecJzlFw57gId');
    assert.equal(cli.calls().filter(x => x.startsWith('drive +inspect')).length, 1, '链接由 lark-cli 回读一次');
    await pause(150);
    const states = S.msgs.filter(m => m.type === 'insightAction' && m.cardId === cid).map(m => m.state.status);
    assert.deepEqual(states, ['queued', 'running', 'done'], 'ws 推了三段执行态');
    const fb = S.msgs.find(m => m.type === 'feedback' && (m.highlights || []).some(h => /^⚠️ 冲突：会上 流失率是 4.1%，记录 6.3%/.test(h.text)));
    assert.ok(fb, '冲突条进了 highlights 广播');
    // 同 cardId 同 do 再点：不重做
    r = await S.post({ id: 'ia-e2e', cardId: cid, do: 'open_source', confirmed: true });
    assert.equal(r.status, 200); assert.equal(r.j.alreadySent, true); assert.equal(cli.calls().filter(x => x.startsWith('drive +inspect')).length, 1);
    // 快照里带着产物和执行态（重连 / 旁听能接回来）
    const snap = await new Promise(res => { const ws2 = new WS('ws://127.0.0.1:' + port + '/?token=' + TOKEN + '&role=view'); ws2.once('message', d => { res(JSON.parse(d.toString())); ws2.close(); }); });
    const c = (snap.session.factchecks || []).find(x => x.id === cid); assert.equal(c.actionState.status, 'done'); assert.equal(c.correction, '记录：6.3%（决策板 D3，2026-09-17）');
    assert.ok(snap.session.highlights.some(h => /^⚠️ 冲突/.test(h.text)), '冲突条在会话里，会进会后总结');
  } finally { try { S.ws.close(); } catch (e) {} S.child.kill(); }
});

test('POST /insight-action set_date：无 owner 建给本人；lark-cli 失败 → failed 可重试，成功后不重建；cancel 撤回等待期', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemate-ia-srv2-')), port = await freePort(), cli = stubCli(dir), { dir: kb } = fixtures();
  const S = await startServer({ dir, port, cli, kb });
  try {
    const cid = await S.addCard({ type: 'recheck', claim: '这件事 09-12《硬件例会》已承诺过，记录里没看到落地', evidence: 'BOM 表我回头发', source: '硬件例会 2026-09-12', why: '省他翻记录', action: { do: 'set_date', args: {} } });
    cli.mode('fail');
    let r = await S.post({ id: 'ia-e2e', cardId: cid, do: 'set_date', args: {}, confirmed: true });
    assert.equal(r.status, 400); assert.equal(r.j.state.status, 'failed'); assert.match(r.j.error, /飞书拒绝/); assert.ok(!r.j.uncertain, '命令自己报错 = 确定没建成');
    assert.equal(cli.calls().filter(x => x.startsWith('task +create')).length, 1);
    cli.mode('');
    r = await S.post({ id: 'ia-e2e', cardId: cid, do: 'set_date', args: { due: '2026-10-08' }, confirmed: true });
    assert.equal(r.status, 200); assert.equal(r.j.state.status, 'done');
    assert.equal(r.j.card.task.url, 'https://example.test/task/g-e2e'); assert.equal(r.j.card.task.due, '2026-10-08'); assert.equal(r.j.card.task.owner, '本人');
    const creates = cli.calls().filter(x => x.startsWith('task +create')); assert.equal(creates.length, 2);
    assert.ok(creates[1].includes('--assignee ou_00c28e8ed0b15769a9a5f5e4ea36f7e8') && creates[1].includes('--due 2026-10-08T18:00:00+08:00') && creates[1].includes('--as user'), creates[1]);
    assert.ok(!cli.calls().some(x => x.startsWith('contact')), '没 owner 不搜人');
    r = await S.post({ id: 'ia-e2e', cardId: cid, do: 'set_date', args: {}, confirmed: true });
    assert.equal(r.j.alreadySent, true); assert.equal(cli.calls().filter(x => x.startsWith('task +create')).length, 2, '重复点不重建');
    // 撤回：另一张卡，等待期改长（settings 热读），点了马上 cancel
    const cid2 = await S.addCard({ type: 'recheck', claim: '屏幕短名单 09-15《硬件例会》已承诺过，记录里没看到落地', evidence: '短名单我下周给', source: '硬件例会 2026-09-15', why: '省他翻记录', action: { do: 'set_date', args: {} } });
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')); st.INSIGHT_ACTION_GRACE_MS = 3000; fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(st));
    const p = S.post({ id: 'ia-e2e', cardId: cid2, do: 'set_date', args: {}, confirmed: true });
    await pause(300);
    const c = await S.post({ id: 'ia-e2e', cardId: cid2, do: 'cancel' }); assert.equal(c.status, 200); assert.equal(c.j.state, 'cancelled');
    r = await p; assert.equal(r.status, 200); assert.equal(r.j.state.status, 'cancelled');
    assert.equal(cli.calls().filter(x => x.startsWith('task +create')).length, 2, '撤回的那次没建任务');
    const c2 = await S.post({ id: 'ia-e2e', cardId: cid2, do: 'cancel' }); assert.equal(c2.status, 409, '没有在等的动作，撤不了');
    // 结果不明（命令被超时杀掉，飞书那边可能已经建了）：留 pending 收据；再点必须带 retryConfirmed，否则 409（Codex 1edd4fc4 初审要求有测试）
    const st2 = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')); st2.INSIGHT_ACTION_GRACE_MS = 0; fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(st2));
    const cid3 = await S.addCard({ type: 'recheck', claim: 'BOM 成本模型 09-17《硬件例会》已承诺过，记录里没看到落地', evidence: '成本模型我下周更新', source: '硬件例会 2026-09-17', why: '省他翻记录', action: { do: 'set_date', args: {} } });
    cli.mode('hang');
    r = await S.post({ id: 'ia-e2e', cardId: cid3, do: 'set_date', args: {}, confirmed: true });
    assert.equal(r.status, 400); assert.equal(r.j.state.status, 'failed'); assert.equal(r.j.uncertain, true, '被超时杀掉 = 结果不明'); assert.equal(r.j.state.uncertain, true);
    cli.mode('');
    r = await S.post({ id: 'ia-e2e', cardId: cid3, do: 'set_date', args: {}, confirmed: true });
    assert.equal(r.status, 409, '结果不明时普通 confirmed 不放行'); assert.match(r.j.error, /上次发送结果还没确认/); assert.equal(r.j.uncertain, true);
    const before = cli.calls().filter(x => x.startsWith('task +create')).length;
    r = await S.post({ id: 'ia-e2e', cardId: cid3, do: 'set_date', args: {}, confirmed: true, retryConfirmed: true });
    assert.equal(r.status, 200); assert.equal(r.j.state.status, 'done'); assert.equal(r.j.card.task.url, 'https://example.test/task/g-e2e');
    assert.equal(cli.calls().filter(x => x.startsWith('task +create')).length, before + 1, '带 retryConfirmed 才重来一次');
  } finally { try { S.ws.close(); } catch (e) {} S.child.kill(); }
});
