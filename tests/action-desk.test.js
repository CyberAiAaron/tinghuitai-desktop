'use strict';
// 会后处理台（REQ-009）。这里盯住五件在评审里最容易被放过的事：
//   ① 模型不回话时分类还能用（关键词兜底，并且如实标出来是规则判的）
//   ② 预研究每场最多 3 条，不会一场会跑十几次模型
//   ③ 参会人互斥组是确定性的保险，不靠模型读懂名单
//   ④ 重新生成不把「已打叉 / 已发出」的状态冲掉
//   ⑤ 外发门禁：除了 do:'send'，没有任何一条路径会碰 lark-cli
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const actions = require('../app/actions');
const llm = require('../app/llm');
const root = path.join(__dirname, '..');
const pause = ms => new Promise(r => setTimeout(r, ms));
const tmp = tag => fs.mkdtempSync(path.join(os.tmpdir(), 'tht-' + tag + '-'));

// ---- 一场会的整理结果（结构和真实 .job.enhanced.json 一致，内容取 09-18 那场的形状）----
const ENHANCED = {
  id: 'sess-desk-1', title: 'AIHW weekly', topicTitle: 'Agent 手机产品定位与输入方式硬件路线', names: {},
  brief: {
    overview: {
      topics: [{ n: 1, title: '输入改造与软硬结合', from: 0, to: 600 }, { n: 2, title: '产品定位与需求总纲', from: 600, to: 1200 }],
      conclusions: ['产品大定位为专门连接 Agent 的手机', '算法尽量放在片上，MCU 优先'],
      todos: [
        { what: '参加所有相关会议并负责组织', owner: '新宇', ownerSource: 'meeting', due: '', topic: 1 },
        { what: '确认 ID 设计与硬件形态，作为后续工作的前提', owner: 'Aaron Wang', ownerSource: 'suggested', due: '', topic: 1 },
        { what: '让 agent 把业界公开研究汇总一下', owner: '', ownerSource: '', due: '', topic: 2 },
        { what: '研究音频处理方案（麦克风端或协处理器）', owner: 'Abel Mei', ownerSource: 'suggested', due: '', topic: 2 },
        { what: '把现有材料打包发给对接方', owner: '', ownerSource: '', due: '', topic: 2 },
      ],
    },
    review: {
      advice: ['调研一下业界的降噪方案', '再调研一遍竞品的输入方式', '研究一下无摄像头方案的判据', '汇总一下原厂能做什么'],
      errors: [], facts: [], alignment: [], checked: [], contextLoaded: true,
    },
  },
};

// ---- 假模型：按系统提示词认出这是哪一步，回固定 JSON；同时记下每次调用带没带 noFallback ----
function fakeAsk(seen, { failOn = null } = {}) {
  return async (env, opts) => {
    seen.push({ system: opts.system, user: opts.user, noFallback: !!opts.noFallback });
    const s = opts.system || '';
    if (failOn && failOn.test(s)) return { text: null, errorCode: 'stub_fail', degraded: false, attempts: [] };
    const answer = j => ({ text: JSON.stringify(j), provider: 'stub', degraded: false, attempts: [] });
    if (/事项分类/.test(s)) {
      const items = JSON.parse(opts.user).map(c => ({ i: c.i, kind: actions.classifyByRules({ text: c.text, owner: c.owner }), reason: '模型判的' }));
      return answer({ items });
    }
    if (/拟日历草稿/.test(s)) {
      const idx = JSON.parse(opts.user.slice(opts.user.indexOf('要拟草稿的事项：') + 8));
      // 故意把互斥的两组人同时给出来：确定性保险必须把后一组去掉
      return answer({ drafts: idx.map(x => ({ i: x.i, title: '组织 ID 与硬件形态确认会', agenda: ['ID 设计现状', '硬件形态选型'], attendees: ['John Du', 'Shawn Hu', 'Kevin', 'Melania', 'S6'], note: '定下形态' })) });
    }
    if (/预研究一页/.test(s)) {
      const idx = JSON.parse(opts.user.slice(opts.user.indexOf('要预研究的事项：') + 8));
      return answer({ items: idx.map(x => ({ i: x.i, scope: '覆盖 A/B', sources: ['公开论文'], expected: '给出一张对照表' })) });
    }
    if (/整条项目线上处在什么位置/.test(s)) return answer({ position: '这场把输入方式收敛到两条路，卡在 ID 形态没定' });
    if (/有没有硬冲突/.test(s)) return answer({ risks: [] });
    if (/读这些项目文件/.test(s)) return answer({ items: ['把 D1 定下来', '把 D3 定下来', '把概念 A/B 判据定下来'] });
    return answer({});
  };
}
function withFakeAsk(seen, opts, fn) {
  const orig = llm.ask; llm.ask = fakeAsk(seen, opts);
  return Promise.resolve().then(fn).finally(() => { llm.ask = orig; });
}
const baseEnv = () => ({
  TEAM_MEMBERS_FILE: '', ATTENDEE_EXCLUSIVE_GROUPS: [['John Du', 'Shawn Hu', 'Calvin'], ['Kevin', 'Melania', 'Joseph']],
});

test('分类：模型没回话时按关键词规则兜底，并且如实标成 rules', async () => {
  // 先把规则本身钉死——需求里写的判定顺序就是这一张表
  assert.equal(actions.classifyByRules({ text: '参加所有相关会议并负责组织', owner: '新宇' }), 'meeting');
  assert.equal(actions.classifyByRules({ text: '拉认为 camera 没用的同事与凯文一起讨论', owner: 'S6' }), 'meeting');
  assert.equal(actions.classifyByRules({ text: '让 agent 把业界公开研究汇总一下', owner: '' }), 'research');
  assert.equal(actions.classifyByRules({ text: '增加与手机方案相关人员的交流', owner: 'Abel Mei' }), 'delegate');
  assert.equal(actions.classifyByRules({ text: '请 Kevin 出一版判据', owner: '' }), 'delegate');
  assert.equal(actions.classifyByRules({ text: '把现有材料打包发给对接方', owner: '' }), 'self');
  assert.equal(actions.classifyByRules({ text: '确认 ID 设计，作为后续前提', owner: 'Aaron Wang' }), 'self');   // 我自己的事不算派出去
  assert.equal(actions.classifyByRules({ text: '拉个会对一下', owner: 'S6' }), 'meeting');                      // S6 是编号不是人

  const dir = tmp('actions-rules'), seen = [];
  const out = await withFakeAsk(seen, { failOn: /事项分类/ }, () =>
    actions.generate({ dir, sessionId: ENHANCED.id, enhanced: ENHANCED, env: baseEnv(), dataDir: dir }));
  assert.equal(out.classifiedBy, 'rules');
  assert.match(out.warnings.join(' '), /关键词规则/);
  assert.equal(out.cards.find(c => c.text.includes('负责组织')).kind, 'meeting');
  assert.equal(out.cards.find(c => c.text.includes('业界公开研究')).kind, 'research');
});

test('卡片来自待办 + 建议两处；建议正文进 advice，「建议怎么做」不再单独成区', async () => {
  const dir = tmp('actions-src'), seen = [];
  const out = await withFakeAsk(seen, {}, () => actions.generate({ dir, sessionId: ENHANCED.id, enhanced: ENHANCED, env: baseEnv(), dataDir: dir }));
  assert.equal(out.classifiedBy, 'model');
  assert.equal(out.cards.length, 9);                                   // 5 条待办 + 4 条建议
  assert.equal(out.cards.filter(c => c.adviceIndex !== undefined).length, 4);
  for (const c of out.cards.filter(c => c.adviceIndex !== undefined)) assert.equal(c.advice, c.text);
  assert.ok(out.thinking.position.includes('卡在'));
});

test('预研究每场最多 3 条，多出来的标明没跑，不偷偷跑第 4 次模型', async () => {
  const dir = tmp('actions-research'), seen = [];
  const out = await withFakeAsk(seen, {}, () => actions.generate({ dir, sessionId: ENHANCED.id, enhanced: ENHANCED, env: baseEnv(), dataDir: dir }));
  const research = out.cards.filter(c => c.kind === 'research');
  assert.ok(research.length > actions.MAX_RESEARCH, '这份数据本来就有超过 3 条研究类，才测得出上限');
  assert.equal(research.filter(c => c.draft).length, actions.MAX_RESEARCH);
  for (const c of research.slice(actions.MAX_RESEARCH)) assert.match(c.researchSkipped, /只自动跑 3 条/);
  // 预研究只调一次模型，一次把 3 条一起写出来
  assert.equal(seen.filter(x => /预研究一页/.test(x.system)).length, 1);
});

test('参会人：互斥组保险是确定性的，同时出现两组只留排在前面的那组；说话人编号不当人名', async () => {
  const groups = [['John Du', 'Shawn Hu', 'Calvin'], ['Kevin', 'Melania', 'Joseph']];
  assert.deepEqual(actions.enforceExclusive(['Kevin', 'John Du', 'Marcus Fei'], groups), ['John Du', 'Marcus Fei']);
  assert.deepEqual(actions.enforceExclusive(['Kevin', 'Melania'], groups), ['Kevin', 'Melania']);   // 只有一组时不动
  assert.deepEqual(actions.enforceExclusive(['Kevin', 'John Du'], []), ['Kevin', 'John Du']);       // 没配就不管
  // 设置里写「Calvin」，模型写出来是「Calvin Gao」，按前缀也要算同一组，否则保险等于没配
  assert.deepEqual(actions.enforceExclusive(['Calvin Gao', 'Kevin'], groups), ['Calvin Gao']);
  assert.deepEqual(actions.enforceExclusive(['Calvin', 'Joseph Lu'], [['Calvin Gao'], ['Joseph Lu']]), ['Calvin']);

  const dir = tmp('actions-att'), seen = [];
  const out = await withFakeAsk(seen, {}, () => actions.generate({ dir, sessionId: ENHANCED.id, enhanced: ENHANCED, env: baseEnv(), dataDir: dir }));
  const m = out.cards.find(c => c.kind === 'meeting');
  assert.deepEqual(m.draft.attendees, ['John Du', 'Shawn Hu']);   // 伦敦那组被去掉，S6 也没进来
  assert.equal(m.draft.slots.length, 2);
});

test('重新生成：已打叉 / 已发出 / 已认领的状态按文本对回来，不丢', async () => {
  const dir = tmp('actions-merge'), seen = [];
  const env = baseEnv();
  let out = await withFakeAsk(seen, {}, () => actions.generate({ dir, sessionId: ENHANCED.id, enhanced: ENHANCED, env, dataDir: dir }));
  const dropped = out.cards.find(c => c.kind === 'self').id, sent = out.cards.find(c => c.kind === 'meeting').id;
  assert.notEqual(dropped, sent);
  await actions.apply({ dir, sessionId: ENHANCED.id, cardId: dropped, action: 'dismiss', env });
  const cur = actions.read(dir, ENHANCED.id);
  cur.cards.find(c => c.id === sent).state = 'sent';
  cur.cards.find(c => c.id === sent).sentRef = { type: 'calendar', url: 'https://example.invalid/e/1' };
  fs.writeFileSync(actions.fileOf(dir, ENHANCED.id), JSON.stringify(cur));

  // 同一场重跑（文本没变，模型给的顺序也可能变，所以对齐靠归一化文本不靠下标）
  out = await withFakeAsk(seen, {}, () => actions.generate({ dir, sessionId: ENHANCED.id, enhanced: ENHANCED, env, dataDir: dir }));
  assert.equal(out.cards.find(c => c.id === dropped).state, 'dismissed');
  const after = out.cards.find(c => c.id === sent);
  assert.equal(after.state, 'sent');
  assert.equal(after.sentRef.url, 'https://example.invalid/e/1');
  // 撤销回来 = 回到 open，页面上卡片重新出现
  await actions.apply({ dir, sessionId: ENHANCED.id, cardId: dropped, action: 'restore', env });
  assert.equal(actions.read(dir, ENHANCED.id).cards.find(c => c.id === dropped).state, 'open');
});

test('风险提示：没配事实源整块不跑；配了但没有硬冲突时 risks 为空', async () => {
  const dir = tmp('actions-risk'), seen = [];
  await withFakeAsk(seen, {}, () => actions.generate({ dir, sessionId: ENHANCED.id, enhanced: ENHANCED, env: baseEnv(), dataDir: dir }));
  assert.equal(seen.filter(x => /有没有硬冲突/.test(x.system)).length, 0, '没配 FACT_SOURCE_FILES 就一次模型都不该调');
  assert.deepEqual(actions.read(dir, ENHANCED.id).risks, []);

  const dir2 = tmp('actions-risk2'), seen2 = [], factFile = path.join(dir2, 'facts.md');
  fs.writeFileSync(factFile, '# 决策板\nD1 未定。\n');
  const out = await withFakeAsk(seen2, {}, () => actions.generate({ dir: dir2, sessionId: ENHANCED.id, enhanced: ENHANCED, env: { ...baseEnv(), FACT_SOURCE_FILES: [factFile] }, dataDir: dir2 }));
  assert.equal(seen2.filter(x => /有没有硬冲突/.test(x.system)).length, 1);
  assert.deepEqual(out.risks, []);
});

test('项目最重要的三件事：同一天两次读到的逐字一致，模型只算一次；没配就整块不显示', async () => {
  const dir = tmp('actions-focus'), seen = [], focusFile = path.join(dir, 'state.md');
  fs.writeFileSync(focusFile, '项目状态：D1 和 D3 都没定。\n');
  const env = { ...baseEnv(), PROJECT_FOCUS_FILES: [focusFile] };
  const a = await withFakeAsk(seen, {}, () => actions.projectFocus({ dataDir: dir, env }));
  const b = await withFakeAsk(seen, {}, () => actions.projectFocus({ dataDir: dir, env }));
  assert.equal(a.configured, true);
  assert.equal(a.items.length, 3);
  assert.equal(JSON.stringify(a.items), JSON.stringify(b.items), '同一天必须逐字一致');
  assert.equal(seen.filter(x => /读这些项目文件/.test(x.system)).length, 1, '一天只算一次');

  const empty = await withFakeAsk(seen, {}, () => actions.projectFocus({ dataDir: tmp('actions-focus2'), env: baseEnv() }));
  assert.equal(empty.configured, false);
  assert.deepEqual(empty.items, []);
});

test('隐私：团队名单 / 项目文件 / 事实源进 prompt 的调用一律 noFallback，不许降到云端接口', async () => {
  const dir = tmp('actions-privacy'), seen = [];
  const roster = path.join(dir, 'team.md'), focus = path.join(dir, 'focus.md'), facts = path.join(dir, 'facts.md');
  fs.writeFileSync(roster, '| John Du | ID |\n'); fs.writeFileSync(focus, '项目状态\n'); fs.writeFileSync(facts, '事实源\n');
  const env = { ...baseEnv(), TEAM_MEMBERS_FILE: roster, PROJECT_FOCUS_FILES: [focus], FACT_SOURCE_FILES: [facts] };
  await withFakeAsk(seen, {}, async () => {
    await actions.generate({ dir, sessionId: ENHANCED.id, enhanced: ENHANCED, env, dataDir: dir });
    await actions.projectFocus({ dataDir: dir, env });
  });
  const sensitive = seen.filter(x => x.user.includes('团队名单文件原文') || x.user.includes('事实源：') || x.user.includes('项目状态'));
  assert.ok(sensitive.length >= 3, '这三类调用都要出现');
  for (const c of sensitive) assert.equal(c.noFallback, true, '带本机文件内容的调用不许降级：' + c.system.slice(0, 24));
  // 反面：只带会议内容的分类调用可以走降级链，否则模型一挂整页空白
  assert.equal(seen.find(x => /事项分类/.test(x.system)).noFallback, false);
});

test('llm.ask 的 noFallback 只试链上第一家，第二家一次都不碰', async () => {
  const hits = [];
  const fetchImpl = async (url) => { hits.push(url); return { json: async () => (/b\.example/.test(url) ? { choices: [{ message: { content: 'ok' } }] } : { error: { message: 'down' } }) }; };
  const env = { A: 'a', B: 'b', LLM_CHAIN: [{ type: 'openai', name: '甲', baseUrl: 'https://a.example/v1', keyFrom: 'A' }, { type: 'openai', name: '乙', baseUrl: 'https://b.example/v1', keyFrom: 'B' }] };
  const no = await llm.ask(env, { system: 's', user: 'u', noFallback: true, fetchImpl });
  assert.equal(no.text, null);
  assert.equal(no.attempts.length, 1);
  assert.equal(hits.filter(u => /b\.example/.test(u)).length, 0, '第二家一次都不该被调用');
  const yes = await llm.ask(env, { system: 's', user: 'u', fetchImpl });
  assert.equal(yes.text, 'ok'); assert.equal(yes.degraded, true);
});

// ===================== 走真服务进程：路由 + 外发门禁 =====================
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

// 桩 lark-cli：把每次调用的参数追加到一个文件，返回一份假的成功 JSON。真命令一次都不跑。
function stubCli(dir) {
  const logFile = path.join(dir, 'lark-calls.log'), bin = path.join(dir, 'lark-stub.js');
  fs.writeFileSync(bin, '#!/usr/bin/env node\n'
    + 'require("fs").appendFileSync(' + JSON.stringify(logFile) + ', JSON.stringify(process.argv.slice(2))+"\\n");\n'
    + 'const a=process.argv.slice(2);\n'
    + 'if(a[0]==="contact") process.stdout.write(JSON.stringify({data:{users:[{open_id:"ou_stub1",name:"John Du"},{open_id:"ou_stub2",name:"Shawn Hu"}]}}));\n'
    + 'else if(a[0]==="calendar") process.stdout.write(JSON.stringify({data:{event:{event_id:"ev_1",app_link:"https://example.invalid/cal/ev_1"}}}));\n'
    + 'else process.stdout.write(JSON.stringify({data:{task:{guid:"tk_1",url:"https://example.invalid/task/tk_1"}}}));\n');
  fs.chmodSync(bin, 0o755);
  return { bin, logFile, calls: () => { try { return fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean); } catch (e) { return []; } } };
}
// 假的 claude 命令行：真服务进程走的是 cli 适配器，这里按系统提示词认出是哪一步。
function stubClaude(home) {
  const bin = path.join(home, '.local/bin/claude');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, '#!/usr/bin/env node\n' + `
const sys = process.argv.join(' ');
let input = ''; process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  const out = j => process.stdout.write(JSON.stringify({ result: JSON.stringify(j), usage: {} }));
  if (/事项分类/.test(sys)) {
    const cards = JSON.parse(input);
    return out({ items: cards.map(c => ({ i: c.i, kind: /组织|拉/.test(c.text) ? 'meeting' : /研究|汇总/.test(c.text) ? 'research' : c.owner && !/Aaron/.test(c.owner) ? 'delegate' : 'self', reason: '模型判的' })) });
  }
  if (/拟日历草稿/.test(sys)) {
    const idx = JSON.parse(input.slice(input.indexOf('要拟草稿的事项：') + 8));
    return out({ drafts: idx.map(x => ({ i: x.i, title: '组织 ID 与硬件形态确认会', agenda: ['ID 现状'], attendees: ['John Du', 'Shawn Hu', 'Kevin'], note: '定形态' })) });
  }
  if (/预研究一页/.test(sys)) {
    const idx = JSON.parse(input.slice(input.indexOf('要预研究的事项：') + 8));
    return out({ items: idx.map(x => ({ i: x.i, scope: '覆盖 A/B', sources: ['公开论文'], expected: '一张对照表' })) });
  }
  if (/整条项目线上处在什么位置/.test(sys)) return out({ position: '卡在 ID 形态没定' });
  if (/有没有硬冲突/.test(sys)) return out({ risks: [] });
  if (/读这些项目文件/.test(sys)) return out({ items: ['定 D1', '定 D3', '定 A/B 判据'] });
  out({});
});
`);
  fs.chmodSync(bin, 0o755);
}

test('路由与外发门禁：只有 do:"send" 会碰 lark-cli，其余动作和后台生成一次都不碰', async () => {
  const dir = tmp('desk-srv'), home = path.join(dir, 'home'), pipe = path.join(dir, 'state/meeting-pipeline');
  fs.mkdirSync(pipe, { recursive: true });
  const cli = stubCli(dir); stubClaude(home);
  const focusFile = path.join(dir, 'focus.md'); fs.writeFileSync(focusFile, '项目状态：D1 未定\n');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    RELAY_TOKEN: 't'.repeat(32), ARCHIVE_TARGET: 'local', LLM_PROVIDER: 'claude',
    PROJECT_FOCUS_FILES: [focusFile], ATTENDEE_EXCLUSIVE_GROUPS: [['John Du', 'Shawn Hu'], ['Kevin', 'Melania']],
  }));
  // 直接摆一份「已整理完」的归档结果，免得把整条 python 管线拖进来
  const sid = ENHANCED.id, key = actions.keyOf(sid);
  fs.writeFileSync(path.join(pipe, key + '.job.json'), JSON.stringify({ key, sessionId: sid, title: '测试会', status: 'done', summaryGenerated: true, phase: '完成', created: new Date().toISOString(), attempts: 0, input: path.join(pipe, key + '.input.json') }));
  fs.writeFileSync(path.join(pipe, key + '.input.json'), JSON.stringify({ id: sid, transcript: [{ at: 1, text: 'x' }] }));
  fs.writeFileSync(path.join(pipe, key + '.job.enhanced.json'), JSON.stringify(ENHANCED));

  const port = await freePort(), base = 'http://127.0.0.1:' + port + '/asr-relay';
  const child = spawn(process.execPath, [path.join(root, 'app/server.js')],
    { env: { ...process.env, HOME: home, THT_DATA_DIR: dir, THT_PORT: String(port), THT_NO_OPEN: '1', THT_TEST: '1', THT_LARK_CLI: cli.bin }, stdio: 'ignore' });
  const get = async p => (await fetch(base + p)).json();
  const post = async (p, body) => (await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch('http://127.0.0.1:' + port + '/health')).ok) break; } catch (e) {} await pause(100); }
    // 第一次问：还没有就后台跑一遍，页面轮询
    let j = await get('/meeting-actions?id=' + sid);
    assert.equal(j.status === 'running' || j.status === 'done', true);
    for (let i = 0; i < 200 && j.status !== 'done'; i++) { await pause(200); j = await get('/meeting-actions?id=' + sid); }
    assert.equal(j.status, 'done', '生成没跑完');
    const A = j.actions;
    assert.ok(A.cards.length >= 5);
    assert.equal(A.classifiedBy, 'model');
    const meeting = A.cards.find(c => c.kind === 'meeting');
    assert.ok(meeting, '有一张「我要组织的会」');
    assert.deepEqual(meeting.draft.attendees, ['John Du', 'Shawn Hu'], '互斥组保险在真服务上也生效');
    assert.ok(A.cards.filter(c => c.kind === 'research' && c.draft).length <= actions.MAX_RESEARCH);
    assert.deepEqual(A.risks, [], '没配事实源就不出风险');
    assert.ok(A.thinking.position);

    // 第二句：同一天两次逐字一致
    const f1 = await get('/project-focus'), f2 = await get('/project-focus');
    assert.equal(f1.configured, true);
    assert.equal(JSON.stringify(f1.items), JSON.stringify(f2.items));

    // 打叉 → 撤销
    const dropId = A.cards.find(c => c.kind === 'self').id;
    assert.equal((await post('/meeting-action', { id: sid, cardId: dropId, do: 'dismiss' })).card.state, 'dismissed');
    assert.equal((await post('/meeting-action', { id: sid, cardId: dropId, do: 'restore' })).card.state, 'open');
    // 存草稿、认领
    await post('/meeting-action', { id: sid, cardId: meeting.id, do: 'save-draft', draft: { ...meeting.draft, title: '我改过的标题' } });
    const claimTarget = A.cards.find(c => c.kind === 'self' && c.id !== dropId) || A.cards.find(c => c.kind === 'self');
    const claimed = await post('/meeting-action', { id: sid, cardId: claimTarget.id, do: 'claim' });
    assert.equal(claimed.card.state, 'claimed');
    assert.ok(claimed.card.claimNote, '进没进「我的待办」要当场说清楚，不许静默');

    // 门禁：到这里为止，桩 lark-cli 的调用记录必须是空的
    assert.deepEqual(cli.calls(), [], '生成、读取、打叉、撤销、存草稿、认领，一次都不许外发');

    // 只有 send 会外发，而且只发页面传过来的那份草稿
    const sendBack = await post('/meeting-action', {
      id: sid, cardId: meeting.id, do: 'send',
      draft: { ...meeting.draft, title: '我改过的标题', pick: 1 },
    });
    assert.equal(sendBack.ok, true, sendBack.error || '');
    assert.equal(sendBack.card.state, 'sent');
    assert.equal(sendBack.card.sentRef.type, 'calendar');
    assert.equal(sendBack.card.sentRef.url, 'https://example.invalid/cal/ev_1');
    const calls = cli.calls().map(x => JSON.parse(x));
    assert.ok(calls.some(a => a[0] === 'calendar' && a[1] === '+create'), '真的建了日历');
    const cal = calls.find(a => a[0] === 'calendar');
    assert.equal(cal[cal.indexOf('--summary') + 1], '我改过的标题', '发的是他改过的那份草稿');
    assert.equal(cal[cal.indexOf('--attendee-ids') + 1], 'ou_stub1,ou_stub2');
    assert.equal(cal[cal.indexOf('--start') + 1], meeting.draft.slots[1].start, 'pick=1 选的是第二个时间');

    // 派发：飞书任务同样只在 send 这一下才发
    const del = A.cards.find(c => c.kind === 'delegate');
    if (del) {
      const r = await post('/meeting-action', { id: sid, cardId: del.id, do: 'send', draft: del.draft });
      assert.equal(r.ok, true, r.error || '');
      assert.equal(r.card.sentRef.type, 'task');
      assert.ok(cli.calls().map(x => JSON.parse(x)).some(a => a[0] === 'task' && a[1] === '+create'));
    }
    // 不认识的动作一律拒绝，绝不落到外发上
    assert.match((await post('/meeting-action', { id: sid, cardId: meeting.id, do: 'evil' })).error, /未知的动作/);
    assert.equal((await post('/meeting-action', { id: sid, cardId: 'c-zzzzzzzzzzzz', do: 'dismiss' })).error, '卡片编号不对');
  } finally { child.kill('SIGTERM'); }
});

// ===================== 页面契约 =====================
test('页面契约：「建议怎么做」「可能讲错的」「合适的部分」都不在了，待办卡排在核心结论之后', () => {
  const js = fs.readFileSync(path.join(root, 'web/archive.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'web/archive.html'), 'utf8');
  // 只看会渲染出来的文字；整行注释里写「这一区搬去哪了」不算违约。
  const noComment = s => s.replace(/^[ \t]*\/\/.*$/gm, '');
  for (const gone of ['建议怎么做', '可能讲错的', '合适的部分']) {
    assert.ok(!noComment(js).includes(gone), 'archive.js 里不该再有「' + gone + '」');
    assert.ok(!noComment(html).includes(gone), 'archive.html 里不该再有「' + gone + '」');
  }
  // 顺序：核心结论 → 待办卡 → 一句话思考 → 风险提示 → 议题展开
  const order = ['核心结论', 'bf-cards', 'bf-think', 'bf-risks', '议题展开'].map(k => js.indexOf(k));
  assert.ok(order.every(i => i >= 0), '这五块都要在 archive.js 里渲染：' + JSON.stringify(order));
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], '第 ' + i + ' 块的顺序不对');
  // 中英文都要有
  assert.ok(js.includes("uiLang==='en'") || js.includes('T('), 'archive.js 要有中英文文案');
});
