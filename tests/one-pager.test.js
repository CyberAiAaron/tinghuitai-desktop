'use strict';
// 主动智能批 4（需求单 F4 表第三行 + F5）：第二个按钮 one_pager（post 档模型 1 次 → 一页纠错单 HTML 落 exports/one-pager/ → 会后台附件区）
// + /view-feedback 记 type + 每场结束 stats 四个数。模型走假 claude 命令（THT_CLAUDE_BIN），lark-cli 走假命令，绝不真外发。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const { spawn } = require('child_process'); const WS = require('ws');
const root = path.join(__dirname, '..'), pause = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const IA = require(path.join(root, 'app/insight-actions.js'));
const TOKEN = 'k'.repeat(40), SID = 'ia-b4';
const PAGE = { said: 'Cary 说流失率是 4.1%', recorded: '决策板 D3（2026-09-17）记的是 6.3%', source: '决策板 D3，2026-09-17 夜间导出', decision: '已附决策板文档链接，会后总结带冲突条' };

// ---------- 单元：onePager ----------
test('onePager：post 档 ask 调 1 次，四段写进 HTML（转义），文件落 exports/one-pager/<sid>__<card>.html，带文档 / 任务链接；模型回非 JSON → definite 错不写文件', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemate-op-'));
  const calls = [];
  const ask = async (sys, user) => { calls.push({ sys, user }); return '```json\n' + JSON.stringify({ ...PAGE, said: '<script>alert(1)</script> 说 4.1%' }) + '\n```'; };
  const card = { id: 'c1', type: 'conflict', claim: '会上说流失率 4.1%；决策板 D3 记的是 6.3%', evidence: '流失率是 4.1%', source: '决策板 D3', refs: ['D3'], correction: '记录：6.3%（决策板 D3，2026-09-17）', quote: 'D3 新品类定义｜流失率按 6.3% 算', doc: { title: '决策板', url: 'https://example.test/docx/A2hQ' }, task: { url: 'https://example.test/task/g1', due: '2026-09-29', owner: 'Cary Luo' } };
  const r = await IA.onePager({ card, session: { id: SID, title: '硬件周会' }, dataDir: dir, ask });
  assert.equal(calls.length, 1, '模型只调 1 次'); assert.match(calls[0].user, /会上原话：「流失率是 4.1%」/); assert.match(calls[0].user, /已核对：记录：6.3%/); assert.match(calls[0].sys, /只输出一个 JSON 对象/);
  assert.equal(r.patch.onePager.status, 'done'); assert.equal(r.patch.onePager.path, `one-pager?id=${SID}&card=c1`); assert.equal(r.attachment.kind, 'one_pager'); assert.equal(r.attachment.cardId, 'c1');
  const file = IA.onePagerFile(dir, SID, 'c1'); assert.equal(r.patch.onePager.file, file); assert.ok(file.startsWith(path.join(dir, 'exports', 'one-pager') + path.sep));
  const html = fs.readFileSync(file, 'utf8');
  for (const h of ['会上说什么', '记录是什么', '出处', '这次怎么定']) assert.ok(html.includes('<h2>' + h + '</h2>'), h);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; 说 4.1%') && !html.includes('<script>'), '模型输出转义');
  assert.ok(html.includes(PAGE.recorded) && html.includes(PAGE.decision));
  assert.ok(html.includes('href="https://example.test/docx/A2hQ"') && html.includes('href="https://example.test/task/g1"') && html.includes('截止 2026-09-29'), '文档 / 任务链接');
  assert.match(r.patch.onePager.title, /^数字纠错：/); assert.ok(!fs.existsSync(file + '.tmp'));
  // 反例：回的不是 JSON / 没回
  await assert.rejects(IA.onePager({ card: { ...card, id: 'c2' }, session: { id: SID }, dataDir: dir, ask: async () => '抱歉，我说不清' }), e => e.definite === true && /没按格式/.test(e.message));
  await assert.rejects(IA.onePager({ card: { ...card, id: 'c3' }, session: { id: SID }, dataDir: dir, ask: async () => null }), e => e.definite === true && /没有回应/.test(e.message));
  assert.ok(!fs.existsSync(IA.onePagerFile(dir, SID, 'c2')) && !fs.existsSync(IA.onePagerFile(dir, SID, 'c3')), '失败不落文件、不编内容');
  // 路径只认编号字符；奇怪字符替换掉
  assert.equal(path.dirname(IA.onePagerFile(dir, '../x', 'a/b')), path.join(dir, 'exports', 'one-pager'), '编号里的斜杠被替掉，文件只能落在 exports/one-pager/ 里');
  assert.deepEqual(IA.parseOnePager('{"said":"a"}'), { said: 'a', recorded: '', source: '', decision: '' }); assert.equal(IA.parseOnePager('{}'), null); assert.equal(IA.parseOnePager('[]'), null);
});

// ---------- 真服务 ----------
function fakeClaude(dir) {
  const f = path.join(dir, 'claude');
  fs.writeFileSync(f, `#!${process.execPath}
const fs=require('fs');let stdin='';process.stdin.on('data',d=>stdin+=d);
process.stdin.on('end',()=>{fs.appendFileSync(process.env.FAKE_LOG,JSON.stringify({argv:process.argv.slice(2),stdin})+'\\n');
process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,num_turns:1,result:process.env.FAKE_RESULT||'',total_cost_usd:0.01,usage:{input_tokens:900,output_tokens:120}}));});
`);
  fs.chmodSync(f, 0o755); return f;
}
function stubCli(dir) {
  const bin = path.join(dir, 'fake-lark-cli'), logFile = path.join(dir, 'cli-calls.log');
  fs.writeFileSync(bin, `#!/bin/bash
printf '%s\\n' "$*" >> ${JSON.stringify(logFile)}
case "$1 $2" in
  "drive +inspect") echo '{"ok":true,"data":{"url":"https://example.test/docx/'"$4"'","title":"决策板"}}' ;;
  *) echo '{"ok":true,"data":{}}' ;;
esac
`);
  fs.chmodSync(bin, 0o755);
  return { bin, calls: () => { try { return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean); } catch (e) { return []; } } };
}
function kbFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemate-op-kb-'));
  fs.writeFileSync(path.join(dir, '决策板D1-D8_2026-09-17.md'), 'v1.0 ｜ 2026-09-17\n\n# 二、CDCP D1–D8\n\n| # | 决策 | 问题 | 选项 | 当前倾向 | Owner | 门 | 期限 | 状态 |\n|---|---|---|---|---|---|---|---|---|\n| D3 | 新品类定义 | x | 三候选 | 流失率按 6.3% 算；09-10 拍 | Shawn | 单向 | 09-22 | [倾向→定] |\n');
  return dir;
}
async function startServer({ dir, port, cli, kb, claude }) {
  fs.mkdirSync(path.join(dir, 'pending'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ RELAY_TOKEN: TOKEN, ARCHIVE_TARGET: 'local', MEMORY_PROJECTION_DIR: path.join(dir, 'mem'), DECISION_BOARD_DIR: kb, INSIGHT_ACTION_GRACE_MS: 0, LLM_PROVIDER: 'claude' }));
  const child = spawn(process.execPath, [path.join(root, 'app/server.js')], { env: { ...process.env, THT_DATA_DIR: dir, THT_PORT: String(port), THT_NO_OPEN: '1', THT_TEST: '1', THT_LARK_CLI: cli.bin, THT_CLAUDE_BIN: claude, FAKE_LOG: path.join(dir, 'claude.log'), FAKE_RESULT: JSON.stringify(PAGE) }, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (e) {} await pause(100); }
  const ws = new WS('ws://127.0.0.1:' + port + '/?token=' + TOKEN);
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const msgs = []; ws.on('message', d => { try { msgs.push(JSON.parse(d.toString())); } catch (e) {} });
  await new Promise(res => { ws.once('message', () => res()); ws.send(JSON.stringify({ type: 'start', sessionId: SID, title: '硬件周会', rate: 16000, source: 'mac' })); });
  const addCard = card => new Promise(res => { const h = d => { const m = JSON.parse(d.toString()); if (m.type === '__test_insight_ok') { ws.off('message', h); res(m.id); } }; ws.on('message', h); ws.send(JSON.stringify({ type: '__test_insight', card })); });
  const post = async (route, body, q = 'token=' + TOKEN) => { const r = await fetch(base + '/asr-relay/' + route + '?' + q, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://phone.example', 'sec-fetch-site': 'cross-site' }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => null) }; };
  const claudeCalls = () => { try { return fs.readFileSync(path.join(dir, 'claude.log'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch (e) { return []; } };
  return { child, ws, base, msgs, addCard, post, claudeCalls };
}

test('POST /insight-action one_pager：只在上一动作 done 后可用；post 档模型调 1 次；HTML 能从 /one-pager 打开；幂等；/view-feedback 记 type；场次文件带 attachments + stats（与 usage.jsonl 对得上）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemate-op-srv-')), port = await freePort(), cli = stubCli(dir), kb = kbFixture(), claude = fakeClaude(dir);
  const S = await startServer({ dir, port, cli, kb, claude });
  try {
    const cid = await S.addCard({ type: 'conflict', claim: '会上说流失率 4.1%；决策板 D3 记的是 6.3%', evidence: '流失率是 4.1%', source: '决策板 D3', refs: ['D3'], why: '省一次翻决策板', action: { do: 'open_source', args: {} } });
    const aid = await S.addCard({ type: 'answer', claim: 'CDCP 已延期', source: '决策板', why: '省一次问' });
    // 上一动作没做：409；answer 卡：400；没确认：400
    let r = await S.post('insight-action', { id: SID, cardId: cid, do: 'one_pager', confirmed: true }); assert.equal(r.status, 409); assert.match(r.j.error, /先执行上一动作/);
    r = await S.post('insight-action', { id: SID, cardId: aid, do: 'one_pager', confirmed: true }); assert.equal(r.status, 400); assert.match(r.j.error, /这类卡没有这个动作/);
    assert.equal(S.claudeCalls().length, 0, '到这里模型一次没调');
    // 先做 open_source
    r = await S.post('insight-action', { id: SID, cardId: cid, do: 'open_source', confirmed: true }); assert.equal(r.status, 200); assert.equal(r.j.state.status, 'done'); assert.equal(r.j.card.onePager, null);
    r = await S.post('insight-action', { id: SID, cardId: cid, do: 'one_pager' }); assert.equal(r.status, 400); assert.match(r.j.error, /确认/);
    // 真做 one_pager
    r = await S.post('insight-action', { id: SID, cardId: cid, do: 'one_pager', confirmed: true });
    assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.state.status, 'done'); assert.equal(r.j.state.do, 'one_pager'); assert.equal(r.j.state.path, `one-pager?id=${SID}&card=${cid}`);
    assert.equal(r.j.card.onePager.path, r.j.state.path); assert.match(r.j.card.onePager.title, /^数字纠错：/);
    assert.equal(S.claudeCalls().length, 1, 'post 档模型调 1 次'); assert.match(S.claudeCalls()[0].stdin, /已核对：记录：6.3%/);
    const file = IA.onePagerFile(dir, SID, cid); assert.ok(fs.existsSync(file), 'HTML 落 exports/one-pager/');
    // 会后台按 path 打开：带口令 200 HTML；不带口令 401；编号不合法 400；没有的 404
    let g = await fetch(S.base + '/asr-relay/' + r.j.state.path + '&token=' + TOKEN); assert.equal(g.status, 200); assert.match(g.headers.get('content-type'), /text\/html/);
    const html = await g.text(); for (const h of ['会上说什么', '记录是什么', '出处', '这次怎么定']) assert.ok(html.includes('<h2>' + h + '</h2>'), h); assert.ok(html.includes(PAGE.said) && html.includes('href="https://example.test/docx/A2hQdjgAUoIV1vxecJzlFw57gId"'));
    g = await fetch(S.base + '/asr-relay/' + r.j.state.path, { headers: { origin: 'https://phone.example', 'sec-fetch-site': 'cross-site' } }); assert.equal(g.status, 401, '外来请求不带口令拿不到');
    g = await fetch(S.base + '/asr-relay/one-pager?id=../x&card=' + cid + '&token=' + TOKEN); assert.equal(g.status, 400);
    g = await fetch(S.base + '/asr-relay/one-pager?id=' + SID + '&card=nope&token=' + TOKEN); assert.equal(g.status, 404);
    // 幂等：再点不重生成
    r = await S.post('insight-action', { id: SID, cardId: cid, do: 'one_pager', confirmed: true }); assert.equal(r.status, 200); assert.equal(r.j.alreadySent, true); assert.equal(S.claudeCalls().length, 1);
    await pause(150);
    const pagerStates = S.msgs.filter(m => m.type === 'insightAction' && m.cardId === cid && m.state && m.state.do === 'one_pager').map(m => m.state.status);
    assert.deepEqual(pagerStates, ['queued', 'running', 'done'], 'ws 推了纠错单的三段执行态，且 do=one_pager 与第一个按钮分开');
    const snap = await new Promise(res => { const ws2 = new WS('ws://127.0.0.1:' + port + '/?token=' + TOKEN + '&role=view'); ws2.once('message', d => { res(JSON.parse(d.toString())); ws2.close(); }); });
    const c = (snap.session.factchecks || []).find(x => x.id === cid); assert.equal(c.actionState.status, 'done', '第一个按钮的执行态没被覆盖'); assert.equal(c.onePager.status, 'done');
    // /view-feedback：带 type 照记；不带 type 从卡上取；rating 校验照旧
    r = await S.post('view-feedback', { sessionId: SID, id: cid, claim: '会上说流失率 4.1%；决策板 D3 记的是 6.3%', rating: 'adopt', type: 'conflict' }); assert.equal(r.status, 200);
    r = await S.post('view-feedback', { sessionId: SID, id: aid, claim: 'CDCP 已延期', rating: 'useless' }); assert.equal(r.status, 200);
    r = await S.post('view-feedback', { sessionId: SID, id: 'zzz', claim: '老卡', rating: 'useless', type: 'bogus' }); assert.equal(r.status, 200);
    const fbRows = fs.readFileSync(path.join(dir, 'state', 'view-feedback.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.deepEqual(fbRows.map(x => x.type), ['conflict', 'answer', ''], '带 type 认、不带从卡取、都没有留空不猜');
    // 合成账本行（本场 jev ×2、live ×1；别的场次 ×1）→ 结束 → 场次文件 stats 四个数 + attachments
    const row = o => JSON.stringify({ ts: Date.now(), in: 100, out: 0, ...o }) + '\n';
    fs.appendFileSync(path.join(dir, 'state', 'usage.jsonl'), row({ sessionId: SID, provider: 'jev', tier: 'gate', hit: true }) + row({ sessionId: SID, provider: 'jev', tier: 'gate', error: 'timeout 3000ms' }) + row({ sessionId: SID, provider: 'claude', tier: 'live', purpose: 'triage' }) + row({ sessionId: 'other', provider: 'claude', tier: 'live' }));
    const usageAll = fs.readFileSync(path.join(dir, 'state', 'usage.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(usageAll.filter(x => x.sessionId === SID && x.purpose === 'one-pager' && x.tier === 'post').length, 1, '纠错单那次模型调用进了用量账（post 档，不算 Sonnet 会中调用）');
    S.ws.send(JSON.stringify({ type: 'end' }));
    const pend = path.join(dir, 'pending', 'sess-' + SID + '.json');
    for (let i = 0; i < 100 && !fs.existsSync(pend); i++) await pause(100);
    const sess = JSON.parse(fs.readFileSync(pend, 'utf8'));
    assert.deepEqual({ j: sess.stats.jevCalls, s: sess.stats.sonnetCalls, i: sess.stats.insights, a: sess.stats.adopted }, { j: 2, s: 1, i: 2, a: 1 }, 'Jev 2 / Sonnet 1 / 洞察 2 / 采纳 1（conflict 卡 adopt + 按钮 done 只算一次）');
    assert.equal(sess.attachments.length, 1); assert.equal(sess.attachments[0].kind, 'one_pager'); assert.equal(sess.attachments[0].path, `one-pager?id=${SID}&card=${cid}`); assert.equal(sess.attachments[0].cardId, cid);
    // 会后台读 /meeting-result 拿到同一份
    const mr = await (await fetch(S.base + '/asr-relay/meeting-result?id=' + SID + '&token=' + TOKEN)).json();
    assert.equal(mr.stats.jevCalls, 2); assert.equal((mr.attachments || []).length, 1);
  } finally { try { S.ws.close(); } catch (e) {} S.child.kill(); }
});
