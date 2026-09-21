'use strict';
// 架构约束：本机资料只有一个入口。
//
// 这条约束不是风格问题。模型知道的一切只来自引擎递给它的那份输入，所以「哪个用途能看哪些资料、
// 给多少字」必须只有一个地方说了算（app/context-pack.js 文件头那张表）。只要有第二处代码自己去
// 读 PROJECT_CONTEXT_FILES 这类设置项、自己 open 一份文件塞进 prompt，那张表就被架空了：
// 表上写着「分享包一个字本机资料都不带」，实际却带了，而且没人看得出来。
// 所以这里用 grep 把「谁被允许认这几个设置项」钉死，多一个文件就让测试红。
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');

// 资料来源类设置项：配的是「去读哪些本机文件」。
const KEYS = ['PROJECT_CONTEXT_FILES', 'PROJECT_FOCUS_FILES', 'FACT_SOURCE_FILES', 'TEAM_MEMBERS_FILE'];

// 允许认这几项的地方，各有各的理由：
//   app/context-pack.js   唯一的资料入口，那张表就写在它文件头
//   app/config.js         设置项的默认值与校验（它管「这个键长什么样」，不管「读出来干什么」）
//   app/setup-routes.js、web/settings.*   设置界面：让人填路径的那一屏
//   scripts/              运维脚本（装机、部署、体检），不进 prompt
//   tests/                测试自己要摆资料
const ALLOW = [/^app\/context-pack\.js$/, /^app\/config\.js$/, /^app\/setup-routes\.js$/,
  /^web\/settings\.[a-z]+$/, /^scripts\//, /^tests\//];

// 仓库里「人写的文件」：跟踪中的 + 没被 .gitignore 掉的新文件。构建产物和 node_modules 天然排除。
function repoFiles() {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-c', '-o', '--exclude-standard'], { encoding: 'utf8' });
  return out.split('\n').map(s => s.trim()).filter(Boolean)
    .filter(f => /\.(js|py|mjs|cjs|sh|html)$/.test(f) && !f.startsWith('tests/fixtures/'));
}

test('资料来源那四个设置项只许在白名单里被认出来，别处一律走 app/context-pack.js', () => {
  const bad = [];
  for (const f of repoFiles()) {
    if (ALLOW.some(re => re.test(f))) continue;
    let s; try { s = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { continue; }
    const hit = KEYS.filter(k => s.includes(k));
    if (hit.length) bad.push(f + '（' + hit.join('、') + '）');
  }
  assert.deepEqual(bad, [], '这些文件绕开了资料入口，自己去认设置项：\n  ' + bad.join('\n  '));
});

test('会后那条 Python 路自己不读资料文件：拼背景的函数已经撤掉，prompt 里只剩占位符', () => {
  for (const f of ['meeting-pipeline.py', 'share-bundle.py']) {
    const s = fs.readFileSync(path.join(root, 'app', f), 'utf8');
    for (const gone of ['def read_context', 'def context_dir', 'def load_context'])
      assert.ok(!s.includes(gone), f + ' 里还留着 ' + gone + '，资料又有第二处读法了');
    assert.ok(!/PROJECT_|FACT_SOURCE|TEAM_MEMBERS/.test(s), f + ' 还在认资料来源设置项');
  }
  const mp = fs.readFileSync(path.join(root, 'app', 'meeting-pipeline.py'), 'utf8');
  assert.match(mp, /CTX_SLOT = '\\x00CONTEXT\\x00'/, '占位符定义没了，桥就没地方填资料');
  assert.match(mp, /context=\{'purpose'/, '总结那一轮没把用途告诉桥');
});

test('用量账每行都能回答「这次看了哪些资料、哪一版」：stamp 只落 key 和版本，不落正文', () => {
  const pack = require('../app/context-pack');
  const stamped = pack.stamp({ hash: 'abc123', parts: [{ key: 'core-context', version: '2026-09-22T01:00:00.000Z#deadbeef', chars: 40 }] });
  assert.equal(stamped.contextHash, 'abc123');
  assert.deepEqual(stamped.contextParts, [{ key: 'core-context', version: '2026-09-22T01:00:00.000Z#deadbeef' }]);
  assert.deepEqual(pack.stamp(null), { contextHash: '', contextParts: [] }, '没带资料的调用也要有这两列，空着不等于漏记');
  assert.deepEqual(pack.stamp({ hash: 'x', parts: [{ key: 'facts/facts.md', missing: true }] }).contextParts,
    [{ key: 'facts/facts.md', version: 'missing' }], '缺的那份也要留痕，不能当没配过');
});
