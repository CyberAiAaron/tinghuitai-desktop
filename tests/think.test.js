'use strict';
// THINK.md 先过（app/think.js + app/llm.js ask() + app/meeting-pipeline.py ask_model）：
//   ① load 的优先级：<THT_DATA_DIR>/THINK.md > app/THINK.md；改了文件（mtime 变）下一次就生效
//   ② ask() 把它拼在 system 最前面，所有 kind 都拼，且只拼一次（Python 那条路已经拼过就不再拼）
//   ③ `@人名：` 是会中唯一保留的那个约定（解析在 app/live-insight.js）
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..');
const think = require(path.join(root, 'app/think.js'));
const llm = require(path.join(root, 'app/llm.js'));
const L = require(path.join(root, 'app/live-insight.js'));

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tht-think-'));

test('① load：数据目录里的那份压过仓库自带的；没有就退回 app/THINK.md；改了内容下一次就读到新的', () => {
  think.reset();
  const repo = think.load('');
  assert.ok(repo.includes('你要做的事') && repo.includes('不当核对员'), '默认读 app/THINK.md');
  assert.equal(think.file(''), path.join(root, 'app/THINK.md'));
  const dir = tmp();
  try {
    assert.equal(think.load(dir), repo, '数据目录里没有 THINK.md 时退回仓库那份');
    fs.writeFileSync(path.join(dir, 'THINK.md'), '# 我自己的想法\n只说一句。');
    assert.equal(think.load(dir), '# 我自己的想法\n只说一句。', 'Aaron 自己那份优先');
    assert.equal(think.file(dir), path.join(dir, 'THINK.md'));
    // 会中途改一句：mtime 变了就重读，不用重启
    const f = path.join(dir, 'THINK.md');
    fs.writeFileSync(f, '# 改过了\n第二句。');
    fs.utimesSync(f, new Date(Date.now() + 2000), new Date(Date.now() + 2000));
    assert.equal(think.load(dir), '# 改过了\n第二句。');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); think.reset(); }
});

test('② prefix / ask()：拼在 system 最前面，只拼一次；THINK.md 读不到时原样发', async () => {
  think.reset();
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'THINK.md'), 'THINK-BODY');
    assert.equal(think.prefix('SYS', dir), 'THINK-BODY' + think.SEP + 'SYS');
    assert.equal(think.prefix(think.prefix('SYS', dir), dir), 'THINK-BODY' + think.SEP + 'SYS', '幂等：不翻倍');
    assert.equal(think.prefix('', dir), 'THINK-BODY', 'system 为空时只有 THINK');
    // ask()：每个 kind 都走同一条，假 fetch 抓下真正发出去的 system
    const seen = [];
    const fetchImpl = async (u, o) => { seen.push(JSON.parse(o.body)); return { status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }; };
    const env = { LLM_CHAIN: [{ type: 'openai', name: '假的', baseUrl: 'https://example.com/v1', key: 'k', models: { live: 'm', post: 'm', think: 'm' } }] };
    for (const kind of ['live', 'triage', 'post', 'think', 'insight-deep']) {
      const r = await llm.ask(env, { kind, system: 'KIND-' + kind, user: 'u', dataDir: dir, fetchImpl });
      assert.equal(r.text, 'ok');
    }
    assert.equal(seen.length, 5);
    for (const body of seen) {
      const sys = body.messages[0].content;
      assert.ok(sys.startsWith('THINK-BODY'), 'THINK 在最前面：' + sys.slice(0, 20));
      assert.equal(sys.split('THINK-BODY').length - 1, 1, '只拼一次');
    }
    // Python 那条路已经拼过：再过一次 ask() 不该翻倍
    seen.length = 0;
    await llm.ask(env, { kind: 'post', system: 'THINK-BODY' + think.SEP + '已经拼过了', user: 'u', dataDir: dir, fetchImpl });
    assert.equal(seen[0].messages[0].content.split('THINK-BODY').length - 1, 1);
    // 两份都读不到（空目录 + 仓库那份存在，所以这里只验空串分支）
    think.reset();
    assert.equal(think.prefix('SYS', '/nonexistent-dir-for-think-test'), think.load('') + think.SEP + 'SYS');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); think.reset(); }
});

test('③ `@人名：` 行 = 唯一保留的约定：正文里认出来就是一个可发的行动', () => {
  assert.equal(L.actionFrom('没有指派'), null);
  const a = L.actionFrom('先说结论。\n@Abel Mei：周五前给 ROI 回滚方案');
  assert.deepEqual(a, { do: 'handoff', who: 'Abel Mei', label: '交给人', text: '交给 Abel Mei：周五前给 ROI 回滚方案', args: { person: 'Abel Mei' } });
  assert.equal(L.actionFrom('- **@Hannah Yin：** 把高通路标日期定下来').who, 'Hannah Yin', '列表 / 粗体包着也认');
  assert.equal(L.actionFrom('@Luna Min: keep it in English', { enUI: true }).text, 'Hand to Luna Min: keep it in English');
  assert.equal(L.actionFrom('邮件写给 x@y.com：这不是指派'), null, '句中的 @ 不算（必须行首）');
  assert.equal(L.actionFrom('@某人：'), null, '只有人名没有内容不算');
});
