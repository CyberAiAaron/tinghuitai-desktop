'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const web = require('../app/tools/web'), insight = require('../app/insight-search');
function tmp(name) { return fs.mkdtempSync(path.join(os.tmpdir(), 'tht-' + name + '-')); }

test('去敏查询：项目代号、人名和中文长句被拒，纯技术词保留并去重', () => {
  const project = tmp('search-project');
  fs.mkdirSync(path.join(project, '.memory'), { recursive: true }); fs.mkdirSync(path.join(project, 'kb_backup'), { recursive: true });
  fs.writeFileSync(path.join(project, '.memory', 'ledger_people_org.md'), '## 人员\n| 姓名 | 角色 |\n| Aaron Wang | PM |\n| 肖明 | 工程 |\n');
  fs.writeFileSync(path.join(project, 'kb_backup', '决策板D1-D8_2026-09-24.md'), '| Owner | Shawn Liu |\n');
  const got = insight.pickQueries(['retrieval augmented generation best practices', 'Aaron Wang wearable assistant', '肖明 语音助手',
    'Chansey context engine', '26191 memory', 'Nothing AI', '这是一条包含很多中文并且超过十二个汉字的完整查询句子',
    'retrieval augmented generation best practices', 'WebRTC echo cancellation'], { projectDir: project });
  assert.deepEqual(got, ['retrieval augmented generation best practices', 'WebRTC echo cancellation']);
});
test('联网搜索失败返回空数组，不向调用方抛错', async () => {
  assert.deepEqual(await web.search('WebRTC echo cancellation', 5, { fetchImpl: async () => { throw Error('offline'); }, braveApiKey: '' }), []);
});
test('DuckDuckGo HTML 结果被收敛成 title/url/snippet', async () => {
  const html = '<div class="result results_links"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fguide">Guide &amp; notes</a><a class="result__snippet">Useful <b>reference</b>.</a></div>';
  const got = await web.search('technical term', 5, { braveApiKey: '', fetchImpl: async () => ({ ok: true, text: async () => html }) });
  assert.deepEqual(got, [{ title: 'Guide & notes', url: 'https://example.com/guide', snippet: 'Useful reference .' }]);
});
test('每个安全查询写一行审计，snippet 截到 300 字；失败也留空命中行', async () => {
  const dataDir = tmp('search-audit'), calls = [];
  const result = await insight.collectIndustryReferences({
    insightsMeta: { industryQueries: ['WebRTC echo cancellation', 'vector database indexing'] }, dataDir, meetingId: 'sess-safe-1',
    options: { projectDir: path.join(dataDir, 'missing-project') }, now: () => new Date('2026-09-24T08:10:00.000Z'),
    searchImpl: async query => { calls.push(query); if (query.startsWith('vector')) throw Error('network'); return [{ title: 'Guide', url: 'https://example.com/a', snippet: 'x'.repeat(350) }]; },
  });
  assert.equal(result[0].results[0].snippet.length, 300); assert.deepEqual(result[1].results, []);
  assert.deepEqual(calls, ['WebRTC echo cancellation', 'vector database indexing']);
  const rows = fs.readFileSync(insight.auditFile(dataDir), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows, [
    { at: '2026-09-24T08:10:00.000Z', meetingId: 'sess-safe-1', query: 'WebRTC echo cancellation', urls: ['https://example.com/a'] },
    { at: '2026-09-24T08:10:00.000Z', meetingId: 'sess-safe-1', query: 'vector database indexing', urls: [] },
  ]);
  assert.equal(fs.statSync(insight.auditFile(dataDir)).mode & 0o777, 0o600);
});

test('固定黑名单也挡歌尔侧代号 Moneta / 歌尔 / Goertek', () => {
  assert.deepEqual(insight.pickQueries(['Moneta pin', '歌尔 麦克风', 'Goertek acoustic module', 'MEMS microphone array'], { projectDir: tmp('search-none') }), ['MEMS microphone array']);
});
test('命令行入口：stdin 收 queries，被黑名单挡掉的词不出网、不写审计；回 ok / references / audit', () => {
  const { spawnSync } = require('child_process');
  const dataDir = tmp('search-cli');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'app', 'insight-search.js')], { input: JSON.stringify({ queries: ['Chansey camera', '26191 pin'], dataDir, meetingId: 'm1' }), encoding: 'utf8', env: { ...process.env, PROJECT_CONTEXT_DIR: path.join(dataDir, 'no-project') } });
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.ok, true); assert.deepEqual(out.references, []); assert.deepEqual(out.queries, []); assert.equal(out.audit, insight.auditFile(dataDir));
  assert.equal(fs.existsSync(insight.auditFile(dataDir)), false, '没发出去的词不该有审计行');
});
