'use strict';
// 换一家厂商，发出去的输入一字不差。
//
// 为什么要单独验这个：本机资料原来散在四处各拼各的，会中那条路（Node）和会后那条路（Python）
// 各有一套读法。现在两条路都从 app/context-pack.js 那张表取资料，那就必须能证明——
// 同一个用途，无论走本机命令行还是走 OpenAI 兼容接口，模型收到的 system 和 user 逐字相同。
// 不相同就说明资料是在某一家的适配器里拼的，表又被架空了。
//
// 两条路各验一次：
//   Node 起的     app/actions.js 的 projectFocus（带项目重点文件原文）
//   Python 起的   meeting-pipeline.py 的 summarize（带核心记忆 + 会议记忆，经 app/llm-cli.js 这座桥）
// 命令行那条路系统提示词走 --system-prompt、材料走 stdin，所以比的是拼接前的两段，不是拼完的一整坨。
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..'), APP = path.join(root, 'app');

const CORE = '【核心记忆】Chansey = 26191；Moneta 是歌尔侧代号。\n';
const FOCUS = '【项目重点】D1 Pin 与手机绑定没定，卡住 D2 / D6 / D7。\n';
const SESSION = { id: 'swap-1', title: '换家模型', start: '2026-09-22T01:00:00.000Z', end: '2026-09-22T01:20:00.000Z',
  uiLang: 'zh', notes: '一行笔记', memoryBlock: '\n【以往会议沉淀】\n- [决定] 资料包只留一个入口',
  transcript: [{ id: 'v1', at: 60, t: '1:00', text: '换一家模型，发出去的输入必须一模一样' }] };
const FOCUS_JSON = '{"items":["把 D1 定下来"]}';

function stage(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-swap-' + tag + '-'));
  const home = path.join(dir, 'home'); fs.mkdirSync(path.join(home, '.local/bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'state', 'meeting-pipeline'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'context.md'), CORE);
  fs.writeFileSync(path.join(dir, 'focus.md'), FOCUS);
  return { dir, home, clean: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} } };
}
const settingsFor = (h, chain) => ({ RELAY_TOKEN: 't'.repeat(32), ARCHIVE_TARGET: 'local', LLM_CHAIN: chain,
  PROJECT_FOCUS_FILES: [path.join(h.dir, 'focus.md')] });

// 假的本机命令行：把收到的 --system-prompt 和 stdin 原样落盘，再回一句能被解析的答案。
function fakeCli(h, answer) {
  const cap = path.join(h.dir, 'cli-seen.json'), js = path.join(h.dir, 'rec.js');
  fs.writeFileSync(js, `const fs=require('fs');let s='';process.stdin.setEncoding('utf8');
process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const a=process.argv.slice(2),i=a.indexOf('--system-prompt');
fs.writeFileSync(${JSON.stringify(cap)},JSON.stringify({system:i<0?'':a[i+1],user:s}));
process.stdout.write(JSON.stringify({result:${JSON.stringify(answer)}}));});`);
  const bin = path.join(h.home, '.local/bin/claude');
  fs.writeFileSync(bin, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(js)} "$@"\n`);
  fs.chmodSync(bin, 0o755);
  return () => JSON.parse(fs.readFileSync(cap, 'utf8'));
}

// 假的 OpenAI 兼容接口：记下 messages 原文。
function fakeApi(answer) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d);
    req.on('end', () => {
      try { const m = JSON.parse(b).messages; seen.push({ system: m[0].content, user: m[1].content }); } catch (e) { seen.push({ bad: b }); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'fake', choices: [{ message: { content: answer } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }));
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ seen, port: srv.address().port,
    stop: () => { srv.closeAllConnections(); srv.close(); } })));
}

// 假接口跑在本进程里，子进程一律异步起——spawnSync 会把事件循环堵死，接口永远答不上来。
function run(cmd, args, env, label) {
  return new Promise((res, rej) => {
    const c = spawn(cmd, args, { env });
    let err = ''; c.stderr.on('data', d => err += d); c.stdout.on('data', () => {});
    const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch (e) {} rej(new Error(label + ' 超时')); }, 120000);
    c.on('close', code => { clearTimeout(t); code === 0 ? res() : rej(new Error(label + ' 没跑通：' + err.slice(0, 800))); });
  });
}
const NODE_CODE = `require(${JSON.stringify(path.join(APP, 'actions.js'))})
  .projectFocus({ dataDir: process.env.THT_DATA_DIR,
    env: JSON.parse(require('fs').readFileSync(require('path').join(process.env.THT_DATA_DIR, 'settings.json'), 'utf8')),
    at: new Date('2026-09-22T02:00:00.000Z') })
  .then(r => { if (!r.items.length) { console.error('没生成出来：' + JSON.stringify(r)); process.exit(1); } },
        e => { console.error(e); process.exit(1); });`;
const pyCode = `import importlib.util,json
spec=importlib.util.spec_from_file_location('mp',${JSON.stringify(path.join(APP, 'meeting-pipeline.py'))})
mp=importlib.util.module_from_spec(spec);spec.loader.exec_module(mp)
mp.summarize(json.loads(${JSON.stringify(JSON.stringify(SESSION))}))`;

async function bothWays(tag, answer, go) {
  const cli = stage(tag + '-cli'), api = stage(tag + '-api'), srv = await fakeApi(answer);
  const seenCli = fakeCli(cli, answer);
  fs.writeFileSync(path.join(cli.dir, 'settings.json'), JSON.stringify(settingsFor(cli, [{ type: 'cli', kind: 'claude', name: '本机命令行' }])));
  fs.writeFileSync(path.join(api.dir, 'settings.json'), JSON.stringify(settingsFor(api,
    [{ type: 'openai', name: '假接口', baseUrl: 'http://127.0.0.1:' + srv.port + '/v1', key: 'k', models: { post: 'fake', live: 'fake' } }])));
  try {
    await go(cli); await go(api);
    assert.equal(srv.seen.length, 1, '假接口收到的请求数不对：' + srv.seen.length);
    return { cli: seenCli(), api: srv.seen[0] };
  } finally { srv.stop(); cli.clean(); api.clean(); }
}

test('换家厂商 · Node 这条路（处理台「项目现在最重要的三件事」）：命令行和接口收到的 system / user 逐字相同', async () => {
  const r = await bothWays('node', FOCUS_JSON, h => run(process.execPath, ['-e', NODE_CODE],
    { ...process.env, HOME: h.home, THT_DATA_DIR: h.dir }, 'node 驱动'));
  assert.equal(r.cli.system, r.api.system);
  assert.equal(r.cli.user, r.api.user);
  assert.ok(r.api.user.includes('D1 Pin 与手机绑定'), '项目重点文件的原文没进 prompt：' + r.api.user.slice(0, 120));
});

test('换家厂商 · Python 这条路（会后总结，资料由 app/llm-cli.js 填进占位符）：两家收到的 system / user 逐字相同', async () => {
  const r = await bothWays('py', '一段总结正文', h => run('python3', ['-c', pyCode],
    { ...process.env, HOME: h.home, THT_DATA_DIR: h.dir, THT_PIPELINE_DIR: path.join(h.dir, 'state', 'meeting-pipeline'), THT_NODE: process.execPath }, 'python 驱动'));
  assert.equal(r.cli.system, r.api.system);
  assert.equal(r.cli.user, r.api.user);
  assert.ok(r.api.system.includes('Chansey = 26191'), '核心记忆没被填进占位符：' + r.api.system.slice(-200));
  assert.ok(r.api.system.includes('以往会议沉淀'), '会议记忆没被填进占位符');
  assert.ok(!/\u0000/.test(r.api.system + r.api.user), 'prompt 里还留着没被替换掉的占位符');
});
