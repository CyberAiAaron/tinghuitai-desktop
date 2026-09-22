'use strict';
// 第三家命令行：只改设置、不改代码，整条会后整理就走它（Aaron 2026-09-22：
// 「我现在优先调用 Claude 和 codex 不代表以后我不调用别的」）。
// 这里的假命令行是一个 shell 脚本，代码里没有它的任何痕迹——配置里给出 bin / args / stdin 就够了。
// 顺带验净室：它只该拿到 PATH / HOME / LANG，settings 里的密钥、别的环境变量一个都传不过去。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..'), APP = path.join(root, 'app');
const llm = require('../app/llm');

const ENHANCED = {
  id: 'm-custom', start: '2026-09-22T01:00:00.000Z', end: '2026-09-22T01:20:00.000Z', summary: '已有的一版纪要',
  transcript: [{ id: 's1', at: 60, t: '1:00', text: '这次换第三家命令行试试' },
               { id: 's2', at: 300, t: '5:00', text: '只改配置，代码一个字都不动' }],
};
const FAKE_JSON = JSON.stringify({
  meta: { scope: '这场在谈换第三家命令行' },
  overview: { topics: [{ n: 1, title: '第三家命令行', from: '1:00', to: '5:00' }], conclusions: ['配置说了算'], todos: [] },
  topics: [{ n: 1, conclusion: '配置说了算', decision: '已一致', points: [{ text: '代码里不写死', at: '5:00' }], open: [] }],
  review: {}, questions: [],
});

// 假命令行：从 stdin 收 prompt，把收到的东西和自己看得见的环境变量抄进 <数据目录>/seen/，stdout 吐一份 JSON。
function fakeCli(dir, { wrapJson = false } = {}) {
  const bin = path.join(dir, 'my-llm.sh'), seen = path.join(dir, 'seen');
  fs.mkdirSync(seen, { recursive: true });
  const body = wrapJson ? `printf '{"data":{"answer":%s}}' "$(cat "$OUT.json")"` : `cat "$OUT.json"`;
  fs.writeFileSync(bin, `#!/bin/sh
N=$(ls "${seen}" | grep -c '^in-')
cat > "${seen}/in-$N.txt"
env | sort > "${seen}/env-$N.txt"
echo "$@" > "${seen}/args-$N.txt"
OUT="${seen}/out"
${body}
`);
  fs.chmodSync(bin, 0o755);
  fs.writeFileSync(path.join(seen, 'out.json'), FAKE_JSON);
  return { bin, seen, files: p => fs.readdirSync(seen).filter(f => f.startsWith(p)).sort() };
}

function stage(chain) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-custom-'));
  const home = path.join(dir, 'home'); fs.mkdirSync(home, { recursive: true });
  const pipe = path.join(dir, 'state', 'meeting-pipeline'); fs.mkdirSync(pipe, { recursive: true });
  const ep = path.join(pipe, 'bbbb.job.enhanced.json');
  fs.writeFileSync(ep, JSON.stringify(ENHANCED));
  const write = c => fs.writeFileSync(path.join(dir, 'settings.json'),
    JSON.stringify({ RELAY_TOKEN: 't'.repeat(32), ARCHIVE_TARGET: 'local', LLM_CHAIN: c, DEEPSEEK_API_KEY: 'sk-不该被它看见' }));
  write(chain);
  const run = () => new Promise((res, rej) => {
    const c = spawn('python3', [path.join(APP, 'meeting-pipeline.py'), '--brief', ep],
      { env: { ...process.env, HOME: home, THT_DATA_DIR: dir, THT_PIPELINE_DIR: pipe, THT_NODE: process.execPath, THT_SECRET_CANARY: '不该被它看见' } });
    let err = ''; c.stderr.on('data', d => err += d); c.stdout.on('data', () => {});
    const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch (e) {} rej(new Error('管线超时')); }, 120000);
    c.on('close', code => { clearTimeout(t); res({ status: code, stderr: err }); });
  });
  return { dir, home, pipe, ep, run, write,
    enhanced: () => JSON.parse(fs.readFileSync(ep, 'utf8')),
    state: () => JSON.parse(fs.readFileSync(path.join(pipe, 'bbbb.brief.json'), 'utf8')),
    usage: () => fs.readFileSync(path.join(dir, 'state', 'usage.jsonl'), 'utf8').trim().split('\n').map(JSON.parse),
    clean: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} } };
}

test('第三家命令行：只改设置就让整条会后整理走它，代码里没有它的名字', async () => {
  const h = stage([]);
  const cli = fakeCli(h.dir);
  h.write([{ type: 'cli', kind: 'custom', name: '我自己的命令行', bin: cli.bin, args: ['run', '--model', '{model}'], stdin: 'prompt', models: { post: 'my-post' } }]);
  try {
    const r = await h.run();
    assert.equal(r.status, 0, '管线没跑通：' + (r.stderr || '').slice(0, 600));
    assert.ok(cli.files('in-').length >= 1, '假命令行一次都没被调到');
    assert.equal(h.enhanced().brief.overview.topics[0].title, '第三家命令行');
    assert.equal(h.state().state, 'done');

    // 档位模型经 {model} 递给它
    assert.match(fs.readFileSync(path.join(cli.seen, 'args-0.txt'), 'utf8'), /run --model my-post/);
    // prompt 从 stdin 进去，里面有本场逐字稿
    assert.match(fs.readFileSync(path.join(cli.seen, 'in-0.txt'), 'utf8'), /只改配置，代码一个字都不动/);

    // 净室：它只看得见 PATH / HOME / LANG，settings 里的密钥和别的环境变量都传不过去
    const env = fs.readFileSync(path.join(cli.seen, 'env-0.txt'), 'utf8');
    const keys = env.split('\n').map(l => l.split('=')[0]).filter(Boolean);
    assert.deepEqual(keys.filter(k => !['PATH', 'HOME', 'LANG', 'PWD', 'SHLVL', '_'].includes(k)), [],
      '第三家命令行看见了不该看见的环境变量：' + keys.join(' '));
    assert.doesNotMatch(env, /不该被它看见/);

    // 用量照样落进同一本账：接口没回 usage 就按字符估，标 est
    const rows = h.usage().filter(x => x.sessionId === 'm-custom');
    assert.ok(rows.length >= 1 && rows[0].est === true && rows[0].provider === 'cli', '用量没落账：' + JSON.stringify(rows[0] || null));
    assert.equal(rows[0].requestedModel, 'my-post');
  } finally { h.clean(); }
});

test('第三家命令行的两种接法：prompt 走参数、正文藏在 JSON 里', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-custom2-'));
  const cli = fakeCli(dir, { wrapJson: true });
  try {
    // stdin:'none' → prompt 从 promptArg 递进去；outputJson → 从回的 JSON 里按路径取正文
    const chain = [{ type: 'cli', kind: 'custom', name: '走参数的那家', bin: cli.bin, args: ['ask'], stdin: 'none', promptArg: '--text={prompt}', outputJson: 'data.answer' }];
    const r = await llm.ask({ LLM_CHAIN: chain }, { kind: 'post', system: '你是助手', user: '这是本场材料', dataDir: dir });
    assert.equal(r.text, FAKE_JSON, '没按 outputJson 的路径取到正文');
    assert.equal(r.provider, '走参数的那家');
    assert.equal(r.degraded, false);
    const args = fs.readFileSync(path.join(cli.seen, 'args-0.txt'), 'utf8');
    assert.match(args, /--text=你是助手/, 'system 没拼进 prompt');
    assert.match(args, /这是本场材料/);
    assert.equal(fs.readFileSync(path.join(cli.seen, 'in-0.txt'), 'utf8'), '', 'stdin:none 时不该再从 stdin 递一遍');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('配置不全的第三家命令行直接不入链：没有 bin 就当没配这家', () => {
  assert.deepEqual(llm.chainOf({ LLM_CHAIN: [{ type: 'cli', kind: 'custom', name: '缺可执行文件' }] }), []);
  assert.deepEqual(llm.chainOf({ LLM_CHAIN: [{ type: 'cli', kind: '还没支持的牌子', bin: '/bin/echo' }] }), []);
});
