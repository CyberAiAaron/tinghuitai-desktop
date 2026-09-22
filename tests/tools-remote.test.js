'use strict';
// 外部来源的工具：飞书（命令行）、Slack、Notion（HTTP）。真调用一次都不发——
// 飞书用桩命令行，Slack / Notion 用假 fetch，返回形状照真实接口写。
// 这里盯住的是：
//   ① 飞书两条读类工具解析的是真实字段（result_meta.token / title_highlighted 里的 <h> 要剥掉）
//   ② 飞书两条写类工具没有界面确认就连命令行都不拼
//   ③ Slack 搜索必须有 search:read，权限从 auth.test 的响应头判断，口令不打印
//   ④ Notion 走官方 API 并带 Notion-Version 头
// 这个文件一次真实网络请求都不许发：THT_TEST 会关掉 Slack 那个「后台先探一次权限」的旁路，
// 否则它会在 available() 里异步再探一遍，断言看到的请求条数就不稳定了。
process.env.THT_TEST = '1';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const reg = require('../app/tools');
const larkCli = require('../app/tools/lark-cli');

const tmp = tag => fs.mkdtempSync(path.join(os.tmpdir(), 'tht-' + tag + '-'));

// 桩 lark-cli：真实返回形状（2026-09-22 用 --as user 只读实测过的字段名）
function stubCli(dir, reply) {
  const logFile = path.join(dir, 'calls.jsonl'), bin = path.join(dir, 'lark-stub.js');
  fs.writeFileSync(bin, '#!/usr/bin/env node\n'
    + 'const a=process.argv.slice(2);\n'
    + 'require("fs").appendFileSync(' + JSON.stringify(logFile) + ', JSON.stringify(a)+"\\n");\n'
    + 'process.stdout.write(JSON.stringify((' + reply + ')(a)));\n');
  fs.chmodSync(bin, 0o755);
  return { bin, calls: () => { try { return fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch (e) { return []; } } };
}
function withCli(bin, fn) {
  const before = process.env.THT_LARK_CLI;
  process.env.THT_LARK_CLI = bin;
  return Promise.resolve().then(fn).finally(() => { if (before === undefined) delete process.env.THT_LARK_CLI; else process.env.THT_LARK_CLI = before; });
}

const SEARCH_REPLY = `a => ({ ok: true, data: { has_more: false, page_token: '', total: 2, results: [
  { entity_type: 'docx', title_highlighted: '产品需求<h>总纲</h>', summary_highlighted: '26191 的<h>总纲</h>，D1 未定',
    result_meta: { token: 'COqzdiAr6oGyX3xZb6alPLxQghg', url: 'https://x.feishu.cn/docx/COqzdiAr6oGyX3xZb6alPLxQghg',
      doc_types: ['docx'], owner_name: 'Aaron Wang', edit_user_name: 'Aaron Wang',
      create_time_iso: '2026-09-02T01:00:00+08:00', update_time_iso: '2026-09-20T09:00:00+08:00' } },
  { entity_type: 'wiki', title_highlighted: '决策板 D1-D8', summary_highlighted: 'D1 卡 D2 / D6 / D7',
    result_meta: { token: 'A2hQdjgAUoIV1vxecJzlFw57gId', url: 'https://x.feishu.cn/wiki/A2hQdjgAUoIV1vxecJzlFw57gId',
      owner_name: 'Aaron Wang', update_time_iso: '2026-09-19T09:00:00+08:00' } } ] } })`;

test('搜飞书文档：按真实字段解析，标题里的高亮标记剥掉，token 和链接都带回来', async () => {
  const dir = tmp('lark-search'), cli = stubCli(dir, SEARCH_REPLY);
  await withCli(cli.bin, async () => {
    const r = await reg.call('lark.docs.search', { query: '总纲', limit: 5 }, { dataDir: dir });
    assert.equal(r.ok, true);
    assert.equal(r.items.length, 2);
    const a = r.items[0];
    assert.equal(a.title, '产品需求总纲', '<h></h> 剥干净');
    assert.equal(a.text, '26191 的总纲，D1 未定');
    assert.equal(a.token, 'COqzdiAr6oGyX3xZb6alPLxQghg');
    assert.equal(a.ref, 'lark:COqzdiAr6oGyX3xZb6alPLxQghg');
    assert.equal(a.source, 'lark:docs');
    assert.equal(a.at, '2026-09-20T09:00:00+08:00');
    assert.equal(a.docType, 'docx');
    const argv = cli.calls()[0];
    assert.deepEqual(argv.slice(0, 2), ['docs', '+search']);
    assert.ok(argv.includes('--as') && argv.includes('user'), '只用我自己的身份读');
    assert.equal(argv[argv.indexOf('--page-size') + 1], '5');
  });
});

test('取飞书文档正文：默认只取目录，keyword 要配关键词；非飞书链接直接挡下', async () => {
  const dir = tmp('lark-fetch');
  const cli = stubCli(dir, `a => ({ ok: true, data: { document: { content: '# 总纲\\n\\n## D1\\nPin 与手机绑定未定', document_id: 'COqzdiAr6oGyX3xZb6alPLxQghg', revision_id: 412 } } })`);
  await withCli(cli.bin, async () => {
    const r = await reg.call('lark.docs.fetch', { doc: 'COqzdiAr6oGyX3xZb6alPLxQghg' }, { dataDir: dir });
    assert.equal(r.ok, true);
    assert.match(r.data.text, /Pin 与手机绑定未定/);
    assert.equal(r.data.ref, 'lark:COqzdiAr6oGyX3xZb6alPLxQghg');
    assert.equal(r.data.revision, 412);
    const argv = cli.calls()[0];
    assert.ok(argv.includes('--doc-format') && argv[argv.indexOf('--doc-format') + 1] === 'markdown');
    assert.equal(argv[argv.indexOf('--scope') + 1], 'outline', '默认只取目录，不整份拉回来');

    const kw = await reg.call('lark.docs.fetch', { doc: 'COqzdiAr6oGyX3xZb6alPLxQghg', scope: 'keyword', keyword: 'D1|绑定' }, { dataDir: dir });
    assert.equal(kw.ok, true);
    const argv2 = cli.calls()[1];
    assert.equal(argv2[argv2.indexOf('--keyword') + 1], 'D1|绑定');

    assert.match((await reg.call('lark.docs.fetch', { doc: 'COqzdiAr6oGyX3xZb6alPLxQghg', scope: 'keyword' }, { dataDir: dir })).error, /要同时给 keyword/);
    assert.match((await reg.call('lark.docs.fetch', { doc: 'https://evil.example/docx/abc' }, { dataDir: dir })).error, /不是飞书文档链接/);
    assert.equal(cli.calls().length, 2, '被挡下的两次一条命令都没跑');
  });
});

test('飞书读类失败要如实说，不返回半份结果', async () => {
  const dir = tmp('lark-fail'), cli = stubCli(dir, `a => ({ ok: false, error: { message: '没有这份文档的权限' } })`);
  await withCli(cli.bin, async () => {
    const r = await reg.call('lark.docs.search', { query: 'x' }, { dataDir: dir });
    assert.equal(r.ok, false);
    assert.match(r.error, /没有这份文档的权限/);
  });
});

test('飞书写类：不带界面确认连命令行都不拼；带上确认才真建，argv 和原来 actions.js 那份一致', async () => {
  const dir = tmp('lark-write'), cli = stubCli(dir,
    `a => a[0]==='contact' ? ({ ok:true, data:{ users:[{ open_id:'ou_shawn', localized_name:'Shawn Liu', matched_query:'Shawn Liu' }] } })
      : a[0]==='calendar' ? ({ ok:true, data:{ event:{ event_id:'ev_9', app_link:'https://example.invalid/cal/ev_9' } } })
      : ({ ok:true, data:{ task:{ guid:'tk_9', url:'https://example.invalid/task/tk_9' } } })`);
  await withCli(cli.bin, async () => {
    for (const [name, args] of [
      ['lark.calendar.create', { title: 'ID 形态确认会', start: '2026-09-25T10:00:00+08:00', end: '2026-09-25T11:00:00+08:00', attendees: ['Shawn Liu'] }],
      ['lark.task.create', { description: '把 D1 结论写进决策板', assignee: 'Shawn Liu', due: '2026-09-30' }],
    ]) {
      const r = await reg.call(name, args, { dataDir: dir, caller: 'model:stub' });
      assert.equal(r.ok, false);
      assert.match(r.error, /界面上确认/);
    }
    assert.equal(cli.calls().length, 0, '一条 lark-cli 都没跑');

    const cal = await reg.call('lark.calendar.create',
      { title: 'ID 形态确认会', start: '2026-09-25T10:00:00+08:00', end: '2026-09-25T11:00:00+08:00', agenda: ['ID 现状'], attendees: ['Shawn Liu'] },
      { dataDir: dir, caller: 'ui', confirmedByUser: true });
    assert.equal(cal.ok, true);
    assert.equal(cal.data.url, 'https://example.invalid/cal/ev_9');
    assert.deepEqual(cal.data.missing, []);
    const calArgv = cli.calls().find(a => a[0] === 'calendar');
    assert.deepEqual(calArgv.slice(0, 2), ['calendar', '+create']);
    assert.equal(calArgv[calArgv.indexOf('--summary') + 1], 'ID 形态确认会');
    assert.equal(calArgv[calArgv.indexOf('--attendee-ids') + 1], 'ou_shawn');
    assert.match(calArgv[calArgv.indexOf('--description') + 1], /议程/);

    const task = await reg.call('lark.task.create', { description: '把 D1 结论写进决策板\n第二行', assignee: 'Shawn Liu', due: '2026-09-30', links: ['https://x.feishu.cn/docx/a'] },
      { dataDir: dir, caller: 'ui', confirmedByUser: true });
    assert.equal(task.ok, true);
    assert.equal(task.data.url, 'https://example.invalid/task/tk_9');
    const tArgv = cli.calls().find(a => a[0] === 'task');
    assert.equal(tArgv[tArgv.indexOf('--summary') + 1], '把 D1 结论写进决策板', '标题取第一行');
    assert.equal(tArgv[tArgv.indexOf('--due') + 1], '2026-09-30');
    assert.equal(tArgv[tArgv.indexOf('--assignee') + 1], 'ou_shawn');
    assert.match(tArgv[tArgv.indexOf('--description') + 1], /相关链接/);
  });
});

test('飞书写类：解析不到人就不硬派，任务照建并在结果里说清没派到人', async () => {
  const dir = tmp('lark-miss'), cli = stubCli(dir,
    `a => a[0]==='contact' ? ({ ok:true, data:{ users:[] } }) : ({ ok:true, data:{ task:{ guid:'tk_1', url:'https://example.invalid/task/tk_1' } } })`);
  await withCli(cli.bin, async () => {
    const r = await reg.call('lark.task.create', { description: '找一下白板 OCR 供应商', assignee: '不存在的人' },
      { dataDir: dir, caller: 'ui', confirmedByUser: true });
    assert.equal(r.ok, true);
    assert.match(r.data.note, /没解析到 不存在的人/);
    const argv = cli.calls().find(a => a[0] === 'task');
    assert.equal(argv.includes('--assignee'), false, '没解析到就不带 --assignee，不会派错人');
    assert.match(argv[argv.indexOf('--description') + 1], /先挂在我名下/);
  });
});

test('本机没装 lark-cli 时：四条飞书工具都在清单里，reason 写清缺什么', async () => {
  const before = process.env.THT_LARK_CLI;
  process.env.THT_LARK_CLI = '/nonexistent/lark-cli-not-here';
  try {
    const rows = reg.list({}, {}).filter(x => x.source === 'lark');
    assert.equal(rows.length, 4);
    for (const r of rows) { assert.equal(r.available, false); assert.match(r.reason, /lark-cli/); }
    assert.equal(larkCli.larkAvailable().ok, false);
  } finally { if (before === undefined) delete process.env.THT_LARK_CLI; else process.env.THT_LARK_CLI = before; }
});

// ===== Slack =====
const slackFetch = (scopes, seen = []) => async (url, opt) => {
  seen.push({ url, auth: opt.headers.Authorization, body: String(opt.body || '') });
  if (url.endsWith('auth.test')) return { headers: { get: k => (k === 'x-oauth-scopes' ? scopes : '') }, json: async () => ({ ok: true, team: 'Nothing' }) };
  return { headers: { get: () => '' }, json: async () => ({ ok: true, messages: { total: 1, matches: [
    { text: '这周的 AIOS UT 结论在这里', username: 'luna', channel: { id: 'C1', name: 'ai-native-aios' },
      permalink: 'https://x.slack.com/archives/C1/p1', ts: '1758499200.000100' },
  ] } }) };
};

test('Slack：授权带 search:read 才搜得了，结果带频道和消息链接，口令不进任何返回值', async () => {
  const seen = [], env = { SLACK_USER_TOKEN: 'xoxp-test-000000-abcdef' };
  const r = await reg.call('slack.search', { query: 'AIOS UT' }, { env, fetchImpl: slackFetch('search:read,channels:history', seen) });
  assert.equal(r.ok, true);
  assert.equal(r.items[0].channel, '#ai-native-aios');
  assert.equal(r.items[0].ref, 'slack:C1:1758499200.000100');
  assert.equal(r.items[0].url, 'https://x.slack.com/archives/C1/p1');
  assert.equal(r.items[0].source, 'slack:search');
  assert.ok(r.items[0].at.endsWith('Z'));
  assert.ok(seen[0].url.endsWith('auth.test'), '先探一次权限');
  assert.doesNotMatch(JSON.stringify(r), /xoxp-/, '口令一个字都没跟着结果出来');
});

test('Slack：机器人口令那种没有 search:read 的，说清要重新授权，不发搜索请求', async () => {
  const seen = [], env = { SLACK_USER_TOKEN: 'xoxb-bot-111111-zzzzzz' };
  const r = await reg.call('slack.search', { query: 'x' }, { env, fetchImpl: slackFetch('chat:write,channels:read', seen) });
  assert.equal(r.ok, false);
  assert.match(r.error, /search:read/);
  assert.equal(seen.length, 1, '只探了权限，没发搜索');
  // 探过之后，清单里这一条就变成「未接」并写明原因
  const row = reg.list(env, {}).find(x => x.name === 'slack.search');
  assert.equal(row.available, false);
  assert.match(row.reason, /search:read/);
});

test('Slack：没配授权就在清单里写清缺什么', () => {
  const row = reg.list({}, {}).find(x => x.name === 'slack.search');
  assert.equal(row.available, false);
  assert.match(row.reason, /xoxp/);
});

// ===== Notion =====
const notionFetch = (seen = []) => async (url, opt) => {
  seen.push({ url, method: opt.method, version: opt.headers['Notion-Version'], auth: opt.headers.Authorization, body: opt.body });
  if (url.includes('/search')) return { json: async () => ({ object: 'list', results: [
    { object: 'page', id: '11112222-3333-4444-5555-666677778888', url: 'https://www.notion.so/Chansey-1111',
      last_edited_time: '2026-09-19T10:00:00.000Z',
      properties: { Name: { type: 'title', title: [{ plain_text: 'Chansey 需求全景' }] } } },
  ] }) };
  return { json: async () => ({ object: 'list', results: [
    { type: 'heading_2', heading_2: { rich_text: [{ plain_text: '会议场景' }] }, last_edited_time: '2026-09-19T10:00:00.000Z' },
    { type: 'paragraph', paragraph: { rich_text: [{ plain_text: '线上线下信息割裂是第一痛点。' }] } },
    { type: 'divider', divider: {} },
  ] }) };
};

test('Notion：走官方 API，带 Notion-Version 头；搜索给 id 和链接，取内容给纯文字', async () => {
  const seen = [], env = { NOTION_TOKEN: 'ntn_test_secret' };
  const s = await reg.call('notion.search', { query: '需求全景' }, { env, fetchImpl: notionFetch(seen) });
  assert.equal(s.ok, true);
  assert.equal(s.items[0].title, 'Chansey 需求全景');
  assert.equal(s.items[0].ref, 'notion:11112222-3333-4444-5555-666677778888');
  assert.equal(s.items[0].url, 'https://www.notion.so/Chansey-1111');
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].version, '2022-06-28');
  assert.match(seen[0].url, /api\.notion\.com\/v1\/search$/);

  const f = await reg.call('notion.fetch', { id: '11112222-3333-4444-5555-666677778888' }, { env, fetchImpl: notionFetch(seen) });
  assert.equal(f.ok, true);
  assert.equal(f.data.text, '会议场景\n线上线下信息割裂是第一痛点。');
  assert.equal(f.data.blocks, 3);
  assert.equal(seen[1].method, 'GET');
  assert.match(seen[1].url, /\/blocks\/.*\/children\?page_size=50$/);

  assert.match((await reg.call('notion.fetch', { id: '不是-id-的东西' }, { env, fetchImpl: notionFetch(seen) })).error, /不像 Notion 的页面 id/);
});

test('Notion：接口报错如实回传；没配 NOTION_TOKEN 就在清单里写清缺什么', async () => {
  const env = { NOTION_TOKEN: 'ntn_test_secret' };
  const bad = async () => ({ json: async () => ({ object: 'error', code: 'unauthorized', message: 'API token is invalid.' }) });
  const r = await reg.call('notion.search', { query: 'x' }, { env, fetchImpl: bad });
  assert.equal(r.ok, false);
  assert.match(r.error, /API token is invalid/);

  for (const n of ['notion.search', 'notion.fetch']) {
    const row = reg.list({}, {}).find(x => x.name === n);
    assert.equal(row.available, false);
    assert.match(row.reason, /NOTION_TOKEN/);
  }
});
