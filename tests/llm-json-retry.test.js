'use strict';
// 09-22 换家真跑（DeepSeek 打头跑整条会后流水线）查出来的三件事：
//   M1 点评那一步模型吐的 JSON 不合法（缺逗号，1,496 token，离上限还远，不是截断）→ 整段解析失败、回看页「点评与指导」空白
//   M2 brief.json 的 warning 用 `点评报错 or 降级提示`，点评一出错就把「这场用的是备用模型」顶掉
//   M3 用量账只记了接口回的模型名（deepseek-flash），配置里要的那个（deepseek-chat）没留下
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..'), APP = path.join(root, 'app');
const llm = require('../app/llm');

// —— 适配层这一层（不起进程）——

test('要 JSON 就带 response_format；对方不收就去掉重发一次，且不算一次失败降级', async () => {
  const seen = [], env = { K: 'k', LLM_CHAIN: [{ type: 'openai', name: '甲', baseUrl: 'https://a.example/v1', keyFrom: 'K' }] };
  const ok = { model: 'served', choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } };
  // 第一次带 response_format 的请求回 400，去掉之后才给正文
  const picky = async (url, opt) => {
    const body = JSON.parse(opt.body); seen.push(body);
    return body.response_format
      ? { status: 400, json: async () => ({ error: { message: 'response_format is not supported' } }) }
      : { status: 200, json: async () => ok };
  };
  const r = await llm.ask(env, { kind: 'post', system: 's', user: 'u', json: true, fetchImpl: picky });
  assert.equal(r.text, '{"a":1}');
  assert.equal(r.degraded, false, '同一家去掉一个字段重发，不是降级');
  assert.deepEqual(r.attempts, [], '重发不该被记成一次失败');
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0].response_format, { type: 'json_object' });
  assert.equal(seen[1].response_format, undefined);

  // 收这个字段的那家只发一次
  const good = [], nice = async (url, opt) => { good.push(JSON.parse(opt.body)); return { status: 200, json: async () => ok }; };
  await llm.ask(env, { kind: 'post', system: 's', user: 'u', json: true, fetchImpl: nice });
  assert.equal(good.length, 1);
  assert.deepEqual(good[0].response_format, { type: 'json_object' });

  // 不要 JSON 的调用一个字段都不多带（会中那条路的请求体不许因此变样）
  const plain = [], p2 = async (url, opt) => { plain.push(JSON.parse(opt.body)); return { status: 200, json: async () => ok }; };
  await llm.ask(env, { kind: 'live', system: 's', user: 'u', fetchImpl: p2 });
  assert.equal(plain[0].response_format, undefined);
});

test('用量账两个模型名都记：配置里要的和接口回的', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-usage2-'));
  try {
    llm.noteUsage(dir, { text: '回答', usage: { in: 9, out: 2 }, usageProvider: 'api', model: 'deepseek-flash', requestedModel: 'deepseek-chat' },
      { tier: 'post', sessionId: 's1', purpose: 'review' });
    const row = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'usage.jsonl'), 'utf8').trim());
    assert.equal(row.model, 'deepseek-flash');
    assert.equal(row.requestedModel, 'deepseek-chat');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// —— 整条会后流水线（真起 Python + 桥，模型换成本机假接口）——

const ENHANCED = {
  id: 'm-json', start: '2026-09-22T01:00:00.000Z', end: '2026-09-22T01:20:00.000Z', summary: '已有的一版纪要',
  transcript: [{ id: 's1', at: 60, t: '1:00', text: '先把点评这一步的格式问题解决掉' },
               { id: 's2', at: 300, t: '5:00', text: '模型吐坏 JSON 的时候要能救回来' }],
};
const BRIEF_JSON = JSON.stringify({
  meta: { scope: '这场在谈坏 JSON 怎么救' },
  overview: { topics: [{ n: 1, title: '坏 JSON 要能救', from: '1:00', to: '5:00' }], conclusions: ['重问一次'], todos: [] },
  topics: [{ n: 1, conclusion: '重问一次', decision: '已一致', points: [{ text: '带着报错重问', at: '5:00' }], open: [] }],
});
// 少一个逗号——09-22 那天 DeepSeek 吐回来的就是这种
const BROKEN = '{"questions":[],"review":{"advice":["先把格式修好"]"errors":[]}}';
const GOOD_REVIEW = JSON.stringify({ questions: [], review: { advice: ['先把格式修好'], errors: [], facts: [], alignment: [], checked: [], owners: [] } });

// 点评那一步（system 里有「资深产品顾问」）按 reviewReplies 依次回；别的一律回结构化总结
function fakeApi(reviewReplies) {
  const seen = [], left = reviewReplies.slice();
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d);
    req.on('end', () => {
      let body = {}; try { body = JSON.parse(b); } catch (e) {}
      const isReview = /资深产品顾问/.test(String((body.messages || [])[0] && body.messages[0].content || ''));
      seen.push({ isReview, body });
      const content = isReview ? (left.length > 1 ? left.shift() : left[0]) : BRIEF_JSON;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'fake-served', choices: [{ message: { content } }], usage: { prompt_tokens: 11, completion_tokens: 7 } }));
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, seen, port: srv.address().port })));
}

function stage(chain) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-json-'));
  const home = path.join(dir, 'home'); fs.mkdirSync(path.join(home, '.local/bin'), { recursive: true });
  const pipe = path.join(dir, 'state', 'meeting-pipeline'); fs.mkdirSync(pipe, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ RELAY_TOKEN: 't'.repeat(32), ARCHIVE_TARGET: 'local', LLM_CHAIN: chain }));
  const ep = path.join(pipe, 'cccc.job.enhanced.json');
  fs.writeFileSync(ep, JSON.stringify(ENHANCED));
  const run = () => new Promise((res, rej) => {
    const c = spawn('python3', [path.join(APP, 'meeting-pipeline.py'), '--brief', ep],
      { env: { ...process.env, HOME: home, THT_DATA_DIR: dir, THT_PIPELINE_DIR: pipe, THT_NODE: process.execPath } });
    let err = ''; c.stderr.on('data', d => err += d); c.stdout.on('data', () => {});
    const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch (e) {} rej(new Error('管线超时')); }, 120000);
    c.on('close', code => { clearTimeout(t); res({ status: code, stderr: err }); });
  });
  return { dir, home, pipe, ep, run,
    enhanced: () => JSON.parse(fs.readFileSync(ep, 'utf8')),
    state: () => JSON.parse(fs.readFileSync(path.join(pipe, 'cccc.brief.json'), 'utf8')),
    usage: () => fs.readFileSync(path.join(dir, 'state', 'usage.jsonl'), 'utf8').trim().split('\n').map(JSON.parse),
    clean: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} } };
}

test('M1 点评吐了坏 JSON：带着报错重问一次就救回来，页面有点评', async () => {
  const api = await fakeApi([BROKEN, GOOD_REVIEW]);
  const h = stage([{ type: 'openai', name: '本地假接口', baseUrl: 'http://127.0.0.1:' + api.port + '/v1', key: 'fake-key', models: { post: 'fake-post' } }]);
  try {
    const r = await h.run();
    assert.equal(r.status, 0, '管线没跑通：' + (r.stderr || '').slice(0, 600));
    const b = h.enhanced().brief;
    assert.deepEqual(b.review.advice, ['先把格式修好'], '重问之后点评应该出来了');
    assert.equal(b.reviewWarning, undefined, '救回来了就不该留警告');

    const reviews = api.seen.filter(x => x.isReview);
    assert.equal(reviews.length, 2, '坏 JSON 只重问一次');
    assert.deepEqual(reviews[0].body.response_format, { type: 'json_object' }, '要 JSON 的调用要带 response_format');
    const retry = String(reviews[1].body.messages[1].content);
    assert.match(retry, /无法解析成 JSON/, '重问时要把报错带上');
    assert.match(retry, /先把格式修好/, '重问时要把上次的输出带上，让它照着改格式而不是重写结论');

    // 重问那一次单独记账，事后查得出「这场为了修格式多花了多少」
    assert.ok(h.usage().some(x => x.purpose === 'review-retry'), '重问没单独记账');
  } finally { h.clean(); api.srv.closeAllConnections(); api.srv.close(); }
});

test('M2 重问后还是坏的：报错说人话，而且「用了备用模型」不会被它顶掉', async () => {
  const api = await fakeApi([BROKEN]);
  const h = stage([{ type: 'cli', kind: 'claude', name: '本机命令行' },
                   { type: 'openai', name: '本地假接口', baseUrl: 'http://127.0.0.1:' + api.port + '/v1', key: 'fake-key', models: { post: 'fake-post' } }]);
  const bin = path.join(h.home, '.local/bin/claude');
  fs.writeFileSync(bin, '#!/bin/sh\ncat >/dev/null\necho boom >&2\nexit 1\n'); fs.chmodSync(bin, 0o755);
  try {
    const r = await h.run();
    assert.equal(r.status, 0, '管线没跑通：' + (r.stderr || '').slice(0, 600));
    const b = h.enhanced().brief;
    assert.equal(b.review, null, '点评没出来');
    assert.match(b.reviewWarning, /点评这一步模型返回的格式不对，已重试 1 次仍失败/);
    assert.doesNotMatch(b.reviewWarning, /Expecting|delimiter|line \d+ column/, '英文原始报错只进日志，不进页面');

    const w = h.state().warning;
    assert.match(w, /^这场用的是备用模型/, '降级提示要在前面，不能被点评报错顶掉');
    assert.match(w, /点评这一步/, '两条都要留着');
    // 速览是好的，点评没出来：整场不该因此作废
    assert.equal(b.overview.topics[0].title, '坏 JSON 要能救');
  } finally { h.clean(); api.srv.closeAllConnections(); api.srv.close(); }
});
