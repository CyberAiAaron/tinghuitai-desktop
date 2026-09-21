'use strict';
// 架构约束：外部服务的调用细节只许住在工具层里。
// 为什么要用 grep 守：这一层的全部价值是「工具只定义一份」。哪天有人图快在 actions.js 里
// 又直接拼一条 lark-cli，门禁、审计、超时、截断就全绕过去了，而且功能测试照样是绿的。
//
// 例外是明着列出来的，每条写清为什么还没搬——不写成「随便哪里都能调」。
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');

const root = path.join(__dirname, '..');
const scan = dir => {
  const out = [];
  for (const n of fs.readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const f = path.join(dir, n), st = fs.statSync(f);
    if (st.isDirectory()) out.push(...scan(f));
    else if (/\.(js|py|mjs|cjs)$/.test(n)) out.push(f);
  }
  return out;
};
const rel = f => path.relative(root, f);
const hits = re => scan(path.join(root, 'app')).filter(f => re.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();

test('lark-cli 的命令行只在工具层里拼；actions.js 不再直接碰', () => {
  // 还没搬进工具层的几处，各有各的理由，改动它们不属于这次的范围：
  const KNOWN = [
    'app/meeting-pipeline.py',   // 归档管线（python），这次不动
    'app/server.js',             // 录音当天的日程匹配，一段独立的只读逻辑
    'app/share.js',              // 「分享出去」是另一条外发路径，有它自己的门禁
    'app/work-hub.js',           // 工作台读原文，下一轮再并进 lark.docs.fetch
  ];
  const found = hits(/lark-cli|THT_LARK_CLI/);
  const outside = found.filter(f => !f.startsWith('app/tools/'));
  assert.deepEqual(outside, KNOWN, '工具层外面出现了新的 lark-cli 调用点：' + outside.join(' '));
  assert.equal(outside.includes('app/actions.js'), false, 'actions.js 必须只走登记表');
  // 真正拼 argv 的只有一处
  assert.deepEqual(hits(/binPath\(\)/), ['app/tools/lark-cli.js']);
});

test('Slack / Notion 的接口地址也只在工具层里', () => {
  assert.deepEqual(hits(/slack\.com\/api/), ['app/slack-share.js', 'app/tools/slack.js']);
  assert.deepEqual(hits(/api\.notion\.com/), ['app/tools/notion.js']);
});

test('写类工具的执行只有界面那一条路：全仓只有 actions.js 会把 confirmedByUser 设上', () => {
  // 只看「赋值」这种写法（带冒号），注释里提到名字不算
  assert.deepEqual(hits(/confirmedByUser\s*:/), ['app/actions.js']);
  const actions = fs.readFileSync(path.join(root, 'app/actions.js'), 'utf8');
  const lines = actions.split('\n').filter(l => /confirmedByUser\s*:/.test(l));
  assert.equal(lines.length, 1, 'actions.js 里只该有一处设 confirmedByUser');
  assert.match(lines[0], /confirmedByUser:\s*true/);
  assert.match(lines[0], /caller:\s*'ui'/, '带着 caller:ui，审计里看得出是谁点的');
  // 门禁本体在登记表里，而且是严格等于 true
  assert.match(fs.readFileSync(path.join(root, 'app/tools/index.js'), 'utf8'), /ctx\.confirmedByUser !== true/);
});

test('模型循环拿不到写类工具：tool-loop 只按 level==="read" 过清单', () => {
  const src = fs.readFileSync(path.join(root, 'app/tool-loop.js'), 'utf8');
  assert.match(src, /level === 'read'/);
  assert.doesNotMatch(src, /level === 'write'/);
  const bridge = fs.readFileSync(path.join(root, 'app/mcp-bridge.js'), 'utf8');
  assert.equal((bridge.match(/level === 'read'/g) || []).length, 2, '列工具和调工具两处都过滤');
});

test('每条工具都写全了给模型看的那几项，不留空描述', () => {
  for (const t of require('../app/tools').list({}, {})) {
    assert.ok(t.title && t.title !== t.name, t.name + ' 要有中文标题');
    assert.ok(t.description && t.description.length >= 10, t.name + ' 要有说清用途的描述');
    assert.ok(t.input && t.input.type === 'object', t.name + ' 的参数 schema 要是 object');
    assert.ok(['local', 'lark', 'slack', 'notion'].includes(t.source), t.name + ' 的来源要在已知几类里');
  }
});
