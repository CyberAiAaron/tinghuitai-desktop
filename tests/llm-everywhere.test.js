'use strict';
// 换模型 = 改配置（Aaron 2026-09-22：「听会台用哪家模型，改一下配置就行，代码里不写死」）。
// 全仓每一次模型调用都走 app/llm.js；会后那条 Python 管线自己不认厂商，只起 app/llm-cli.js 进到同一层。
// 这里验三件事：
//   ① 业务代码里没有厂商名、没有 chat/completions、没有读 DEEPSEEK_API_KEY
//   ② settings 里只配一个本地假接口、连 LLM_PROVIDER 都不配，Python 管线照样跑出结果 —— 证明「只改配置就换了家」
//   ③ 链 = [必然失败的假命令行, 本地假接口] → 结果照出，而且降级被记下、state 里读得到
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..'), APP = path.join(root, 'app');

// 允许出现厂商名的地方：适配层自己、设置页与安装引导。其余业务代码一个牌子都不许认。
const BRAND_OK = new Set(['llm.js', 'llm-cli.js', 'cli-llm.js', 'config.js', 'setup-routes.js']);
// 09-22 之前 app/share.js 是唯一一处例外：分享到 Slack 要起一个无头命令行去用账号里的连接器。
// 审查 X3 把它改成走本机 Slack token 之后，例外没有了——下面那条断言现在是真·全仓。

const appFiles = () => fs.readdirSync(APP).filter(f => /\.(js|py)$/.test(f));
// 注释和界面文案里留厂商名是允许的，只看会执行的那几行
const code = f => fs.readFileSync(path.join(APP, f), 'utf8').split('\n')
  .filter(l => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('#'); }).join('\n');

test('业务代码不认厂商：白名单外没有 deepseek / chat completions / DEEPSEEK_API_KEY', () => {
  const bad = [];
  for (const f of appFiles()) {
    if (BRAND_OK.has(f)) continue;
    const s = code(f);
    if (/deepseek/i.test(s) || /chat\/completions/.test(s) || /DEEPSEEK_API_KEY/.test(s)) bad.push(f);
  }
  assert.deepEqual(bad, [], '这些文件还在自己认厂商或自己拼接口地址：' + bad.join('、'));
});

test('Python 管线里没有厂商分支：不再有 claude / codex 的字面量', () => {
  for (const f of appFiles().filter(x => x.endsWith('.py'))) {
    const s = code(f);
    assert.doesNotMatch(s, /['"]claude['"]/, f + ' 还在按厂商名分支');
    assert.doesNotMatch(s, /['"]codex['"]/, f + ' 还在按厂商名分支');
  }
});

test('适配层之外一个命令行牌子都不剩（多一处就得先说明）', () => {
  // 只认「当成牌子用」的写法：引号里正好是 claude / codex，或带版本号的模型名。CLAUDE.md 这种文件名不算。
  const hits = appFiles().filter(f => !BRAND_OK.has(f) && /['"](claude|codex)['"]|claude-[a-z0-9]+-[\d-]+/.test(code(f)));
  assert.deepEqual(hits.sort(), []);
});

test('Python 只有一个模型入口：ask_model 起 llm-cli.js，自己不 spawn 任何命令行、不打 HTTP', () => {
  const s = fs.readFileSync(path.join(APP, 'meeting-pipeline.py'), 'utf8');
  assert.match(s, /def ask_model\(/);
  assert.match(s, /llm-cli\.js/);
  assert.doesNotMatch(s, /urllib\.request\.Request\([^)]*completions/);
  // 只该有这一个地方起子进程跑模型；起飞书 CLI 的那个不算
  assert.equal((s.match(/def cli_ask|CLI_NAMES|find_cli\(/g) || []).length, 0);
});

// —— 下面两条真的把 Python 管线跑起来，只是模型换成本机的假接口 ——

const ENHANCED = {
  id: 'm-chain', start: '2026-09-22T01:00:00.000Z', end: '2026-09-22T01:20:00.000Z', summary: '已有的一版纪要',
  transcript: [{ id: 's1', at: 60, t: '1:00', text: '先把这次要换的模型确定下来' },
               { id: 's2', at: 300, t: '5:00', text: '配置里改一行就该生效，代码不要写死' }],
};
// 假接口对两次调用（结构化总结、点评）回同一份，够 make_brief / make_review 解析
const FAKE_JSON = JSON.stringify({
  meta: { scope: '这场在谈模型怎么换' },
  overview: { topics: [{ n: 1, title: '换模型只改配置', from: '1:00', to: '5:00' }], conclusions: ['配置说了算'], todos: [] },
  topics: [{ n: 1, conclusion: '配置说了算', decision: '已一致', points: [{ text: '代码里不写死', at: '5:00' }], open: [] }],
  review: {}, questions: [],
});

function fakeApi() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d);
    req.on('end', () => {
      try { seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b) }); } catch (e) { seen.push({ url: req.url, bad: b }); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'fake-post', choices: [{ message: { content: FAKE_JSON } }], usage: { prompt_tokens: 11, completion_tokens: 7 } }));
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, seen, port: srv.address().port })));
}

// 摆好一个临时数据目录，把 ENHANCED 当成「已归档完」的结果，然后跑 `meeting-pipeline.py --brief`
function stage(chain) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-llm-'));
  const home = path.join(dir, 'home'); fs.mkdirSync(path.join(home, '.local/bin'), { recursive: true });
  const pipe = path.join(dir, 'state', 'meeting-pipeline'); fs.mkdirSync(pipe, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    RELAY_TOKEN: 't'.repeat(32), ARCHIVE_TARGET: 'local', LLM_CHAIN: chain,   // 注意：没有 LLM_PROVIDER，也没有任何厂商 Key
  }));
  const ep = path.join(pipe, 'aaaa.job.enhanced.json');
  fs.writeFileSync(ep, JSON.stringify(ENHANCED));
  // 必须是异步 spawn：假接口就跑在本测试进程里，spawnSync 会把事件循环堵死，接口永远答不上来
  const run = () => new Promise((res, rej) => {
    const c = spawn('python3', [path.join(APP, 'meeting-pipeline.py'), '--brief', ep],
      { env: { ...process.env, HOME: home, THT_DATA_DIR: dir, THT_PIPELINE_DIR: pipe, THT_NODE: process.execPath } });
    let err = ''; c.stderr.on('data', d => err += d); c.stdout.on('data', () => {});
    const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch (e) {} rej(new Error('管线超时')); }, 120000);
    c.on('close', code => { clearTimeout(t); res({ status: code, stderr: err }); });
  });
  const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
  return { dir, home, pipe, ep, run,
    enhanced: () => readJson(ep),
    state: () => readJson(path.join(pipe, 'aaaa.brief.json')),
    usage: () => fs.readFileSync(path.join(dir, 'state', 'usage.jsonl'), 'utf8').trim().split('\n').map(JSON.parse),
    clean: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} } };
}

test('只改配置就换了一家：settings 里只有一个 OpenAI 兼容接口、没配 LLM_PROVIDER，会后管线照样跑出结构化总结', async () => {
  const api = await fakeApi();
  const h = stage([{ type: 'openai', name: '本地假接口', baseUrl: 'http://127.0.0.1:' + api.port + '/v1', key: 'fake-key', models: { post: 'fake-post' } }]);
  try {
    const r = await h.run();
    assert.equal(r.status, 0, '管线没跑通：' + (r.stderr || '').slice(0, 600));
    assert.ok(api.seen.length >= 1, '假接口一次请求都没收到，说明还有别的路被走了');
    assert.equal(api.seen[0].url, '/v1/chat/completions');
    assert.equal(api.seen[0].auth, 'Bearer fake-key');
    assert.equal(api.seen[0].body.model, 'fake-post');
    assert.equal(api.seen[0].body.temperature, 0.1, '会后这条路的温度还是 0.1');

    const b = h.enhanced().brief;
    assert.equal(b.overview.topics[0].title, '换模型只改配置');
    assert.equal(h.state().state, 'done');
    assert.equal(b.modelNote, undefined, '首选就成了，不该说降级');

    const rows = h.usage();
    assert.ok(rows.some(x => x.sessionId === 'm-chain' && x.purpose === 'brief' && x.in === 11 && x.out === 7 && x.est === false),
      '用量没落进同一本账：' + JSON.stringify(rows));
  } finally { h.clean(); api.srv.closeAllConnections(); api.srv.close(); }
});

test('链上第一家挂了：结果照出，而且降级写进了 state 和归档结果，页面读得到', async () => {
  const api = await fakeApi();
  const h = stage([{ type: 'cli', kind: 'claude', name: '本机命令行' },
                   { type: 'openai', name: '本地假接口', baseUrl: 'http://127.0.0.1:' + api.port + '/v1', key: 'fake-key', models: { post: 'fake-post' } }]);
  const bin = path.join(h.home, '.local/bin/claude');
  fs.writeFileSync(bin, '#!/bin/sh\ncat >/dev/null\necho boom >&2\nexit 1\n'); fs.chmodSync(bin, 0o755);
  try {
    const r = await h.run();
    assert.equal(r.status, 0, '管线没跑通：' + (r.stderr || '').slice(0, 600));
    assert.ok(api.seen.length >= 1, '第一家挂了应该降到第二家');

    const e = h.enhanced();
    assert.equal(e.brief.overview.topics[0].title, '换模型只改配置', '降级了也要把结果拿出来');
    assert.match(e.modelNote, /备用模型 本地假接口/);
    assert.match(e.modelNote, /claude:cli_exit_1/, '降级原因要带得出来');
    assert.match(e.brief.modelNote, /备用模型/);
    assert.match(h.state().warning, /备用模型/, '回看页轮询的 state 里也要有');

    // 回看页顶上那行 meta 会把它渲染出来
    const js = fs.readFileSync(path.join(root, 'web/archive.js'), 'utf8');
    assert.match(js, /s\.modelNote\|\|\(s\.brief&&s\.brief\.modelNote\)/);
  } finally { h.clean(); api.srv.closeAllConnections(); api.srv.close(); }
});
