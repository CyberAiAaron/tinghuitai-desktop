'use strict';
// 回看页大改（REQ-004 + Aaron 09-22 拍板四条）：
//   ① 历史列表直达回看页  ② 总结改飞书纪要式（编号 / 议题分组 / 结论加粗 / 待办表）
//   ③ 待办用一句话改（规则优先，模型兜底，不外发）  ④ 界面只显示真名或「未认人」，不出现 S0 / S1
// 样例是合成的（tests/fixtures/review-redo/make.js），真实会议不进仓库。
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const root = path.join(__dirname, '..');
const fx = require('./fixtures/review-redo/make');
const say = require('../app/todo-say');
const share = require('../app/share');
const A = require('../app/actions');
const pause = ms => new Promise(r => setTimeout(r, ms));
const tmp = tag => fs.mkdtempSync(path.join(os.tmpdir(), 'tht-' + tag + '-'));
const AT = new Date('2026-09-22T10:00:00+08:00');   // 周二
const clone = x => JSON.parse(JSON.stringify(x));

// ===================== ③ 一句话改待办：规则解析 =====================
test('规则解析：派给 / 加一条 / 不要了 / 做完了 / 改成 / 相对日期 都能认，多句用分号分开', () => {
  assert.deepEqual(say.parseRules('第 2 条派给 Cary，周五前', AT), [{ op: 'assign', n: 2, owner: 'Cary', due: '2026-09-25' }]);
  assert.deepEqual(say.parseRules('加一条：整理手板结果，10 月 8 日前', AT), [{ op: 'add', text: '整理手板结果', owner: '', due: '2026-10-08' }]);
  assert.deepEqual(say.parseRules('第 3 条不要了', AT), [{ op: 'remove', n: 3 }]);
  assert.deepEqual(say.parseRules('#1 做完了', AT), [{ op: 'done', n: 1 }]);
  const edit = say.parseRules('第 1 条改成 准备 CDCP 材料初稿', AT);
  assert.equal(edit.length, 1); assert.equal(edit[0].op, 'edit'); assert.equal(edit[0].n, 1); assert.match(edit[0].text, /CDCP 材料初稿/);
  const multi = say.parseRules('第 2 条派给 Cary；第 3 条不要了', AT);
  assert.deepEqual(multi.map(o => o.op), ['assign', 'remove']);
  assert.equal(say.parseDue('明天', AT), '2026-09-23');
  assert.equal(say.parseDue('下周一', AT), '2026-09-28');
  assert.equal(say.parseDue('2026-10-01', AT), '2026-10-01');
});

test('规则解析：听不懂的话回 null（交给模型），不硬猜', () => {
  assert.equal(say.parseRules('这个会开得挺好的', AT), null);
  assert.equal(say.parseRules('', AT), null);
  // 一半听懂一半没懂 → 整句给模型，不做半截
  assert.equal(say.parseRules('第 2 条派给 Cary；还有那个事你看着办', AT), null);
});

test('validOps：模型回的操作要过形状校验，编号越界 / 未知 op / 空 add 都拒', () => {
  assert.equal(say.validOps({ ops: [{ op: 'fly', n: 1 }] }, 4), null);
  assert.equal(say.validOps({ ops: [{ op: 'remove', n: 9 }] }, 4), null);
  assert.equal(say.validOps({ ops: [{ op: 'add', text: '' }] }, 4), null);
  assert.deepEqual(say.validOps({ ops: [{ op: 'remove', n: 4 }] }, 4), [{ op: 'remove', n: 4 }]);
});

// ===================== ③ 落到卡片上 =====================
test('apply：派给别人 → delegate + 草稿 + focus；加一条 → 新卡编号是 c-<12hex>；不要了 / 做完了只改状态不删卡', () => {
  const data = clone(fx.actions);
  const r = say.apply(data, [{ op: 'assign', n: 2, owner: 'Cary Luo', due: '2026-09-25' }], { at: AT.toISOString() });
  const c2 = data.cards[1];
  assert.equal(c2.kind, 'delegate'); assert.equal(c2.owner, 'Cary Luo'); assert.equal(c2.draft.assignee, 'Cary Luo'); assert.equal(c2.draft.due, '2026-09-25');
  assert.equal(r.focus, c2.id); assert.match(r.applied[0], /派给 Cary Luo/);

  const r2 = say.apply(data, [{ op: 'add', text: '整理手板结果', owner: '', due: '2026-10-08' }], { at: AT.toISOString() });
  const added = data.cards[data.cards.length - 1];
  assert.match(added.id, /^c-[0-9a-f]{12}$/); assert.equal(added.kind, 'self'); assert.equal(added.due, '2026-10-08'); assert.equal(added.source, 'say');
  assert.equal(r2.focus, '');
  // 同一句话再加一遍：id 不撞，形状不变
  say.apply(data, [{ op: 'add', text: '整理手板结果', owner: '', due: '' }], { at: AT.toISOString() });
  const ids = data.cards.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length); ids.forEach(id => assert.match(id, /^c-[0-9a-f]{12}$/));

  say.apply(data, [{ op: 'remove', n: 1 }, { op: 'done', n: 1 }], { at: AT.toISOString() });   // 第二个 n:1 落到原第 2 条（第 1 条已收起）
  assert.equal(data.cards[0].state, 'dismissed'); assert.equal(data.cards[0].doneAt, undefined);
  assert.equal(data.cards[1].state, 'dismissed'); assert.equal(data.cards[1].doneAt, AT.toISOString());
  assert.equal(data.cards.length, 6, '收起不等于删掉');
});

test('apply：已派发的卡拒改；编号越界拒改；两种错都是 400', () => {
  const data = clone(fx.actions); data.cards[0].state = 'sent';
  assert.throws(() => say.apply(data, [{ op: 'assign', n: 1, owner: 'Cary' }]), e => e.code === 400 && /派发/.test(e.message));
  assert.throws(() => say.apply(data, [{ op: 'remove', n: 8 }]), e => e.code === 400 && /没有第 8 条/.test(e.message));
});

test('handle：没有卡片文件但总结已出 → 从空表开始；连总结都没有 → 404；一个字都没说 → 400', async () => {
  const dir = tmp('say');
  const out = await say.handle({ dir, sessionId: 'x1', text: '加一条：约 Val 取用研', enhanced: fx.enhanced, dataDir: dir, at: AT });
  assert.equal(out.by, 'rules'); assert.equal(out.actions.cards.length, 1); assert.equal(out.actions.cards[0].text, '约 Val 取用研');
  assert.ok(fs.existsSync(A.fileOf(dir, 'x1')), '要落盘');
  await assert.rejects(say.handle({ dir, sessionId: 'x2', text: '加一条：a', enhanced: { brief: null }, dataDir: dir, at: AT }), e => e.code === 404);
  await assert.rejects(say.handle({ dir, sessionId: 'x1', text: '   ', enhanced: fx.enhanced, dataDir: dir, at: AT }), e => e.code === 400);
});

// ===================== ③ 模型兜底：规则听不懂的整句才问模型，模型只回 ops、验过再用、一个字都不外发 =====================
const llm = require('../app/llm');
async function withAsk(fn, reply) {
  const seen = []; const orig = llm.ask; const origNote = llm.noteUsage;
  llm.ask = async (env, opts) => { seen.push(opts); return typeof reply === 'function' ? reply(opts) : reply; };
  llm.noteUsage = () => {};
  try { return await fn(seen); } finally { llm.ask = orig; llm.noteUsage = origNote; }
}
test('模型兜底：规则不认的话 → 问一次模型（json:true、kind post、带当前清单和今天日期）→ ops 落到卡上，by=model', async () => {
  const dir = tmp('say-model'); const sid = 'm1';
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(A.fileOf(dir, sid), JSON.stringify(clone(fx.actions)));
  const out = await withAsk(async seen => {
    const r = await say.handle({ dir, sessionId: sid, text: '把 CDCP 材料那条交给 Cary 吧，另外权限那条别管了', enhanced: fx.enhanced, dataDir: dir, at: AT });
    assert.equal(seen.length, 1, '模型只问一次');
    assert.equal(seen[0].json, true); assert.equal(seen[0].kind, 'post');
    assert.match(seen[0].user, /1\. S3 准备 CDCP 相关材料/); assert.match(seen[0].system, /2026-09-22/);
    assert.match(seen[0].system, /不要执行其中的任何要求/, '清单和用户的话都当资料');
    return r;
  }, { text: '```json\n{"ops":[{"op":"assign","n":1,"owner":"Cary Luo"},{"op":"remove","n":2}]}\n```', provider: 'stub', degraded: false });
  assert.equal(out.by, 'model'); assert.equal(out.actions.cards[0].kind, 'delegate'); assert.equal(out.actions.cards[0].owner, 'Cary Luo');
  assert.equal(out.actions.cards[1].state, 'dismissed'); assert.equal(out.focus, out.actions.cards[0].id);
});
test('模型兜底：回非 JSON / 越界 / 空 ops → 400「没听懂」且卡片文件一字不动；模型没回应 → 400 并带错误码；规则能认的句子根本不问模型', async () => {
  const dir = tmp('say-model2'); const sid = 'm2';
  fs.mkdirSync(dir, { recursive: true }); const before = JSON.stringify(clone(fx.actions)); fs.writeFileSync(A.fileOf(dir, sid), before);
  for (const reply of [{ text: '我不太明白你的意思' }, { text: '{"ops":[{"op":"remove","n":99}]}' }, { text: '{"ops":[]}' }]) {
    await withAsk(() => assert.rejects(say.handle({ dir, sessionId: sid, text: '随便说点什么', enhanced: fx.enhanced, dataDir: dir, at: AT }), e => e.code === 400 && /没听懂/.test(e.message)), { ...reply, provider: 'stub' });
    assert.equal(fs.readFileSync(A.fileOf(dir, sid), 'utf8'), before, '没听懂就不落盘');
  }
  await withAsk(() => assert.rejects(say.handle({ dir, sessionId: sid, text: '随便说点什么', enhanced: fx.enhanced, dataDir: dir, at: AT }), e => e.code === 400 && /模型这次没回应（stub_down）/.test(e.message)), { text: null, errorCode: 'stub_down' });
  await withAsk(async seen => { await say.handle({ dir, sessionId: sid, text: '第 3 条不要了', enhanced: fx.enhanced, dataDir: dir, at: AT }); assert.equal(seen.length, 0, '规则认得的不问模型'); }, { text: '{"ops":[]}' });
});

// ===================== ② ④ 分享正文：飞书纪要式 + 不出现 S 码 =====================
test('briefNote：三级编号、结论加粗、待办表；没认的人写「未认人」，认了的写真名，正文不出现 S0 / S1', () => {
  const md = share.briefNote(fx.enhanced, fx.actions.cards);
  assert.match(md, /^## 1\. 一屏速览/m); assert.match(md, /^## 2\. 议题/m); assert.match(md, /^### 2\.1 /m); assert.match(md, /^## 3\. 待办/m);
  assert.match(md, /\*\*结论：/); assert.match(md, /\| # \| 事项 \| 负责人 \| 期限 \|/);
  assert.ok(md.includes('Cary Luo'), '认了名的要写真名');
  assert.ok(md.includes('未认人'), '没认名的写「未认人」');
  assert.ok(!/\bS[0-9]\b/.test(md), '正文不许出现 S0 / S1 这种声音编号：' + (md.match(/.*\bS[0-9]\b.*/) || [''])[0]);
  const { speakerMap, nameIn } = share.__test;
  const m = speakerMap(fx.session);
  assert.equal(m.get ? m.get('1') : m['1'], 'Cary Luo');
  assert.equal(nameIn('S3 准备材料，S1 review', m), '未认人 准备材料，Cary Luo review');
});

test('buildMarkdown 逐字稿段：认了名的写真名，没认的写「未认人」，同一人连续发言只标一次，整段不出现 S 码', () => {
  const md = share.buildMarkdown(fx.session, '');
  const tr = md.slice(md.indexOf('## 逐字稿'));
  assert.ok(!/\bS[0-9]\b/.test(tr), '逐字稿段出现了 S 码：' + (tr.match(/.*\bS[0-9]\b.*/) || [''])[0]);
  assert.ok(tr.includes('**Cary Luo**') && tr.includes('**未认人**'));
  // 样例 10 句：0,1,2,1,3,0,1,2,0,3 → 显示名 未认人,Cary,未认人,Cary,未认人×2,Cary,未认人×3 → 相邻相同只标一次 = 7 个标签
  assert.equal((tr.match(/^\*\*[^*]+\*\*$/gm) || []).length, 7, '换人才标一次；几个没认的人连着说算同一个「未认人」标签');
  assert.equal(share.__test.who({ names: { S2: 'Val' } }, '2'), 'Val', 'names 里存 S2 这种老写法也认');
  assert.equal(share.__test.who({}, ''), '', '没有说话人字段就不标');
});

test('briefNote：REQ-004 上限只压模型产出——核心结论最多 3 条、overview 待办最多 5 条；处理台卡片是他自己维护的，一条不截', () => {
  const many = clone(fx.enhanced);
  many.brief.overview.conclusions = ['a', 'b', 'c', 'd', 'e'];
  many.brief.overview.todos = Array.from({ length: 8 }, (_, i) => ({ what: 'T' + (i + 1), owner: '', due: '' }));
  const md = share.briefNote(many, null);
  assert.equal((md.match(/^- \*\*[a-e]\*\*$/gm) || []).length, 3);
  assert.equal((md.match(/^\| \d+ \| T\d+ /gm) || []).length, 5);
  const cards = Array.from({ length: 7 }, (_, i) => ({ id: 'c-' + String(i).repeat(12), kind: 'self', text: 'C' + (i + 1), owner: '', due: '', state: 'open' }));
  assert.equal((share.briefNote(many, cards).match(/^\| \d+ \| C\d+ /gm) || []).length, 7);
});

// ===================== 走真服务进程 =====================
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
function stubCli(dir) {
  const bin = path.join(dir, 'lark-stub.js'), logFile = path.join(dir, 'lark-calls.log');
  fs.writeFileSync(bin, '#!/usr/bin/env node\nrequire("fs").appendFileSync(' + JSON.stringify(logFile) + ', JSON.stringify(process.argv.slice(2))+"\\n");process.stdout.write("{}");\n');
  fs.chmodSync(bin, 0o755);
  return { bin, calls: () => { try { return fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean); } catch (e) { return []; } } };
}
async function up(dir, home) {
  const cli = stubCli(dir);
  const port = await freePort(), base = 'http://127.0.0.1:' + port + '/asr-relay';
  const child = spawn(process.execPath, [path.join(root, 'app/server.js')],
    { env: { ...process.env, HOME: home, THT_DATA_DIR: dir, THT_PORT: String(port), THT_NO_OPEN: '1', THT_TEST: '1', THT_LARK_CLI: cli.bin }, stdio: 'ignore' });
  let ok = false;
  for (let i = 0; i < 150; i++) { try { if ((await fetch('http://127.0.0.1:' + port + '/health')).ok) { ok = true; break; } } catch (e) {} await pause(100); }
  assert.ok(ok, '服务 15 秒内没起来');
  return { child, base, port, cli };
}

test('服务端：/meeting-result 给出 brief；POST /todo-say 改卡并回 applied / focus；/share-export 正文是飞书纪要式且没有 S 码；全程不碰 lark-cli', async () => {
  const dir = tmp('redo-srv'), home = path.join(dir, 'home'); fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ RELAY_TOKEN: 't'.repeat(32), ARCHIVE_TARGET: 'local' }));
  const { id } = fx.install(dir);
  const { child, base, cli } = await up(dir, home);
  const get = async p => { const r = await fetch(base + p); return { status: r.status, j: await r.json() }; };
  const post = async (p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json() }; };
  try {
    const mr = await get('/meeting-result?id=' + id);
    assert.equal(mr.status, 200); assert.equal(mr.j.brief.overview.topics.length, 2);
    assert.deepEqual(mr.j.brief.questions, [], '合成样例就是一场没有疑问的会');

    let r = await post('/todo-say', { id, text: '第 2 条派给 Cary Luo，周五前' });
    assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.ok, true); assert.equal(r.j.by, 'rules');
    assert.match(r.j.applied[0], /派给 Cary Luo/); assert.equal(r.j.focus, 'c-' + 'b'.repeat(12));
    assert.equal(r.j.actions.cards[1].kind, 'delegate');

    r = await post('/todo-say', { id, text: '加一条：整理手板结果，10 月 8 日前' });
    assert.equal(r.status, 200); assert.equal(r.j.actions.cards.length, 5);
    const again = await get('/meeting-actions?id=' + id);
    assert.equal(again.j.actions.cards.length, 5, '改动要落盘，再读还在');

    r = await post('/todo-say', { id, text: '第 9 条不要了' });
    assert.equal(r.status, 400); assert.match(r.j.error, /没有第 9 条/);
    r = await post('/todo-say', { id, text: '' });
    assert.equal(r.status, 400);
    r = await post('/todo-say', { id: 'nobody-here', text: '加一条：x' });
    assert.equal(r.status, 404);
    const bad = await fetch(base + '/todo-say?id=' + id);
    assert.equal(bad.status, 405);

    const ex = await get('/share-export?id=' + id);
    assert.equal(ex.status, 200); assert.equal(ex.j.ok, true);
    const md = ex.j.markdown;
    assert.match(md, /## 1\. 一屏速览/); assert.match(md, /\*\*结论：/); assert.match(md, /\| # \| 事项 \| 负责人 \| 期限 \|/);
    assert.ok(md.includes('整理手板结果'), '分享正文要用最新卡片');
    // 整份导出（纪要正文 + 逐字稿段）都不出现 S 码：纪要走 briefNote 的名字表，逐字稿走 who()（没认的写「未认人」）
    assert.ok(!/\bS[0-9]\b/.test(md), '分享导出出现了 S 码：' + (md.match(/.*\bS[0-9]\b.*/) || [''])[0]);
    assert.ok(md.includes('## 逐字稿') && md.includes('**未认人**') && md.includes('**Cary Luo**'), '逐字稿段要有真名和「未认人」');
    assert.equal(cli.calls().length, 0, '这几条路一次都不该碰 lark-cli');
  } finally { child.kill('SIGTERM'); }
});

// ===================== 页面契约 =====================
test('页面契约：旧三栏 / 过一遍 / 纪要 / 日历条都不在了；三级编号、待办表、一句话对话框都在；archive.js 不再拼 S 码', () => {
  const js = fs.readFileSync(path.join(root, 'web/archive.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'web/archive.html'), 'utf8');
  const noComment = s => s.replace(/^[ \t]*\/\/.*$/gm, '');
  for (const gone of ['id="rv"', 'id="review-go"', 'id="highlights"', 'id="todos"', 'id="factchecks"', 'cal-chip']) assert.ok(!html.includes(gone), 'archive.html 里不该再有 ' + gone);
  for (const gone of ['renderCondenseBar', 'mountReviewButton', 'startReview(', 'mountNote(', 'mountCalendarChip', 'showRaw']) assert.ok(!noComment(js).includes(gone), 'archive.js 里不该再有 ' + gone);
  for (const need of ['id="bf-say"', 'id="bf-cards"', 'class="fs-n"', 'fs-n sub', 'td-table', "t('concl')", 'UNNAMED']) assert.ok(js.includes(need), 'archive.js 要有 ' + need);
  assert.ok(!/['"]S['"]\s*\+/.test(noComment(js)), 'archive.js 不许再拼「S」+ 编号当说话人名字');
  assert.ok(js.includes('未认人') && js.includes('Unnamed'), '「未认人」要有中英文');
  assert.ok(/AbortController/.test(js) && /sayCancel/.test(js), '一句话改待办要能取消（取消 = 撤回这次请求）');
  assert.ok(/\.bf-say|#bf-say/.test(html) && /td-table/.test(html), 'archive.html 要有对话框和待办表的样式');
  assert.ok(/@media\s*\(max-width:\s*900px\)/.test(html), '平板宽度：两栏在 900px 以下叠成一栏');
  // REQ-004 验收 3：没有疑问的会，「需要你定」整块不出现——questions 过滤后为空就 hidden，且不渲染空列表
  assert.match(js, /ask\.hidden=!qs\.length/, '疑问块要按过滤后的题数决定显示');
});

test('spkMap：names 用 1 或 S1 两种键都认，认了名的不会被「未认人」盖掉；没认的才是未认人', () => {
  const js = fs.readFileSync(path.join(root, 'web/archive.js'), 'utf8');
  const src = js.slice(js.indexOf('function spkMap(s){'), js.indexOf('\n', js.indexOf('function spkMap(s){')));
  const spkMap = new Function('UNNAMED', src + '; return spkMap;')(() => '未认人');
  const tr = [{ speaker: '0' }, { speaker: '1' }, { speaker: '2' }];
  assert.deepEqual(spkMap({ transcript: tr, names: { 1: 'Cary Luo' } }), { 0: '未认人', 1: 'Cary Luo', 2: '未认人' });
  assert.deepEqual(spkMap({ transcript: tr, names: { S1: 'Cary Luo' } }), { 0: '未认人', 1: 'Cary Luo', 2: '未认人' });
  assert.deepEqual(spkMap({ transcript: tr, names: { S1: 'Cary Luo', 1: '' } }), { 0: '未认人', 1: 'Cary Luo', 2: '未认人' }, '空名字不盖真名');
  assert.deepEqual(spkMap({ transcript: tr, names: { S9: 'Val' } }), { 0: '未认人', 1: '未认人', 2: '未认人', S9: 'Val' }, '不在转写里的键原样留');
});

test('页面契约：历史列表和会后卡点开都直达回看页，不再先装回三栏主界面', () => {
  const list = fs.readFileSync(path.join(root, 'web/src/13-meeting-list.js'), 'utf8');
  const cards = fs.readFileSync(path.join(root, 'web/src/09-post-cards.js'), 'utf8');
  assert.match(list, /if \(act === 'open'\) return openArchivePanel\(id\)/);
  assert.ok(!/if \(act === 'open'\)[^\n]*reviewSession/.test(list), '「打开」不许再走 reviewSession');
  assert.match(cards, /openArchivePanel\(id\)/);
  const built = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
  assert.ok(built.includes("if (act === 'open') return openArchivePanel(id)"), 'index.html 要是 build-web 之后的产物');
});
