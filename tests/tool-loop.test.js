'use strict';
// 模型用工具的那条纯文字协议。这一层的价值全在「换一家模型不用改任何工具代码」，
// 所以这里最重要的一条是：命令行类模型（claude）和接口类模型（OpenAI 兼容）收到的输入逐字相同。
// 另外盯住：
//   ② 写类工具名模型写出来也执行不了，当无效调用丢弃并留痕
//   ③ 模型把 JSON 包在 ```json 围栏里、前后带一句话，照样解析得出来
//   ④ 轮次用完就明说「别再要工具了」，不死循环
//   ⑤ 降级换一家重问时，已经跑过的调用不重跑
//   ⑥ 每条用到的资料都进 sources，带 ref，供卡片上的「依据」用
const fs = require('fs'), os = require('os'), path = require('path');

// cli-llm 在加载时就把候选路径算死了（$HOME/.local/bin/claude），所以 HOME 和桩必须先于 require 就位。
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-loop-home-'));
const CAPTURE = path.join(HOME, 'cli-capture.jsonl');
process.env.HOME = HOME;
(function stubClaude() {
  const bin = path.join(HOME, '.local/bin/claude');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, '#!/usr/bin/env node\n' + `
const fs = require('fs');
const a = process.argv.slice(2);
const system = a[a.indexOf('--system-prompt') + 1] || '';
let input = ''; process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  fs.appendFileSync(${JSON.stringify(CAPTURE)}, JSON.stringify({ system, user: input }) + '\\n');
  const turn = fs.readFileSync(${JSON.stringify(CAPTURE)}, 'utf8').trim().split('\\n').length;
  const text = turn === 1
    ? '我先查一下会议记录。\\n\\u0060\\u0060\\u0060json\\n{"tool_calls":[{"name":"meetings.search","args":{"query":"输入方式"}}]}\\n\\u0060\\u0060\\u0060'
    : '查完了：输入方式那条在 sess-loop-1。';
  process.stdout.write(JSON.stringify({ result: text, usage: {} }));
});
`);
  fs.chmodSync(bin, 0o755);
})();

const { test } = require('node:test'), assert = require('node:assert/strict');
const llm = require('../app/llm');
const loop = require('../app/tool-loop');
const reg = require('../app/tools');

const tmp = tag => fs.mkdtempSync(path.join(os.tmpdir(), 'tht-' + tag + '-'));
const write = (f, j) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof j === 'string' ? j : JSON.stringify(j)); };

function dataDir() {
  const dir = tmp('loop');
  write(path.join(dir, 'state/meeting-pipeline/x.job.enhanced.json'), {
    id: 'sess-loop-1', topicTitle: '输入方式与硬件形态', start: '2026-09-18T03:00:00.000Z',
    brief: { overview: { conclusions: ['必须引入全新的输入方式，只做普通手机加 AI 不成立'], todos: [], topics: [] } },
    transcript: [{ t: 1, text: '输入方式的改造是这次的核心' }],
  });
  return dir;
}
const stub = (fn, opts) => { const orig = llm.ask; llm.ask = fn; return Promise.resolve().then(opts).finally(() => { llm.ask = orig; }); };

test('同一份调用在命令行模型和接口模型上逐字相同：工具清单、协议说明、工具结果块一个字节都不差', async () => {
  const dir = dataDir();
  const opts = { kind: 'post', system: '你在做会前预研究。', user: '要预研究的事项：输入方式改造', tools: ['meetings.search', 'meetings.get'], dataDir: dir, maxRounds: 2 };

  // ① 命令行那家：真的把 app/cli-llm.js 跑起来，桩 claude 把收到的 system / user 原样存下来
  const cliOut = await loop.askWithTools({ LLM_PROVIDER: 'claude' }, opts);
  assert.equal(cliOut.ok, true);
  assert.match(cliOut.text, /sess-loop-1/);
  const cliTurns = fs.readFileSync(CAPTURE, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(cliTurns.length, 2, '第一轮要工具，第二轮作答');

  // ② 接口那家：同一份 opts，换成 OpenAI 兼容适配器
  const apiTurns = [];
  const fetchImpl = async (url, o) => {
    const body = JSON.parse(o.body);
    apiTurns.push({ system: body.messages[0].content, user: body.messages[1].content });
    const text = apiTurns.length === 1
      ? '我先查一下会议记录。\n```json\n{"tool_calls":[{"name":"meetings.search","args":{"query":"输入方式"}}]}\n```'
      : '查完了：输入方式那条在 sess-loop-1。';
    return { json: async () => ({ model: 'm', choices: [{ message: { content: text } }], usage: {} }) };
  };
  const apiOut = await loop.askWithTools(
    { K: 'k', LLM_CHAIN: [{ type: 'openai', name: '接口家', baseUrl: 'https://api.example/v1', keyFrom: 'K' }] },
    { ...opts, fetchImpl });
  assert.equal(apiOut.ok, true);

  assert.equal(apiTurns.length, cliTurns.length);
  for (let i = 0; i < apiTurns.length; i++) {
    assert.equal(apiTurns[i].system, cliTurns[i].system, '第 ' + (i + 1) + ' 轮的 system 逐字相同');
    assert.equal(apiTurns[i].user, cliTurns[i].user, '第 ' + (i + 1) + ' 轮的 user 逐字相同');
  }
  // 清单和协议真的在里面，而且没有任何一家的原生 function calling 字段
  assert.match(cliTurns[0].system, /【可用工具】/);
  assert.match(cliTurns[0].system, /meetings\.search/);
  assert.match(cliTurns[0].system, /tool_calls/);
  assert.match(cliTurns[1].user, /【工具结果 · 第 1 批】/);
  assert.doesNotMatch(cliTurns[1].user, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\b.*工具结果/, '结果块里不掺当下时间戳，否则两家就不可能一样');
  // 两边都把用到的资料记成了依据
  assert.deepEqual(apiOut.sources.map(s => s.ref), cliOut.sources.map(s => s.ref));
  assert.ok(cliOut.sources.every(s => s.ref && 'source' in s && 'at' in s));
});

test('写类工具名：模型写出来也执行不了，当无效调用丢弃并留痕', async () => {
  const dir = dataDir();
  let asked = 0;
  const fake = async (env, o) => {
    asked++;
    return { text: asked === 1
      ? '{"tool_calls":[{"name":"lark.task.create","args":{"description":"偷偷派个任务"}},{"name":"meetings.search","args":{"query":"输入方式"}}]}'
      : '好的。', provider: 'stub', degraded: false };
  };
  const r = await stub(fake, () => loop.askWithTools({}, { system: 's', user: 'u', tools: ['meetings.search', 'lark.task.create'], dataDir: dir, maxRounds: 2 }));
  assert.equal(r.ok, true);
  const bad = r.toolCalls.find(c => c.name === 'lark.task.create');
  assert.equal(bad.rejected, true);
  assert.equal(bad.ok, false);
  assert.ok(r.toolCalls.some(c => c.name === 'meetings.search' && c.ok), '同一批里合法的那条照跑');
  const audit = fs.readFileSync(reg.auditFile(dir), 'utf8');
  assert.match(audit, /lark\.task\.create/);
  assert.match(audit, /已丢弃/);
});

test('清单里只出现读类工具：写类连名字都不给模型看', async () => {
  const dir = dataDir();
  let sys = '';
  await stub(async (env, o) => { sys = o.system; return { text: '直接作答', provider: 'stub' }; },
    () => loop.askWithTools({}, { system: 's', user: 'u', tools: ['meetings.search', 'lark.task.create', 'lark.calendar.create'], dataDir: dir }));
  assert.match(sys, /meetings\.search/);
  assert.doesNotMatch(sys, /lark\.task\.create/);
  assert.doesNotMatch(sys, /lark\.calendar\.create/);
});

test('解析要抗脏：围栏、前后带话、后面还跟一段解释，都能取出 tool_calls；取不出来就当最终答案', () => {
  const fenced = '我先查一下。\n```json\n{"tool_calls":[{"name":"a.b","args":{"q":"x"}}]}\n```\n查完再说。';
  assert.deepEqual(loop.parseToolCalls(fenced), [{ name: 'a.b', args: { q: 'x' } }]);
  assert.deepEqual(loop.parseToolCalls('{"tool_calls":[{"name":"a.b","args":{"q":"带 } 的字符串"}}]}')[0].args.q, '带 } 的字符串');
  assert.equal(loop.parseToolCalls('这是最终答案，没有工具调用。'), null);
  assert.equal(loop.parseToolCalls('{"tool_calls": 不是数组}'), null);
  assert.equal(loop.parseToolCalls(''), null);
});

test('轮次用完就明说「别再要工具了」，不死循环；最后一批结果照样给它', async () => {
  const dir = dataDir();
  const asks = [];
  const greedy = async (env, o) => {
    asks.push(o.user);
    return { text: '{"tool_calls":[{"name":"meetings.search","args":{"query":"输入方式 ' + asks.length + '"}}]}', provider: 'stub' };
  };
  const r = await stub(greedy, () => loop.askWithTools({}, { system: 's', user: 'u', tools: ['meetings.search'], dataDir: dir, maxRounds: 2 }));
  assert.equal(asks.length, 3, '两轮要工具 + 一次收尾，就停');
  assert.match(asks[2], /【到此为止】/);
  assert.match(asks[2], /不要再输出 tool_calls/);
  assert.match(asks[2], /【工具结果 · 第 2 批】/, '最后一批查到的东西也给它了');
  assert.equal(r.ok, true, '模型收尾那次还在要工具，也按最终答案收下，不无限转');
});

test('降级换一家重问：已经跑过的调用不重跑', async () => {
  const dir = dataDir();
  let n = 0;
  const flaky = async (env, o) => {
    n++;
    if (n === 1) return { text: '{"tool_calls":[{"name":"meetings.search","args":{"query":"输入方式"}}]}', provider: '甲' };
    if (n === 2) return { text: '{"tool_calls":[{"name":"meetings.search","args":{"query":"输入方式"}}]}', provider: '乙', degraded: true };
    return { text: '答完了', provider: '乙', degraded: true };
  };
  const r = await stub(flaky, () => loop.askWithTools({}, { system: 's', user: 'u', tools: ['meetings.search'], dataDir: dir, maxRounds: 3 }));
  assert.equal(r.ok, true);
  assert.equal(r.degraded, true);
  const ran = fs.readFileSync(reg.auditFile(dir), 'utf8').trim().split('\n').map(JSON.parse).filter(x => x.name === 'meetings.search');
  assert.equal(ran.length, 1, '同一个调用只真的跑了一次');
  assert.equal(r.toolCalls.length, 2, '但两轮都如实记着模型要过');
});

test('引擎先替模型查的那几条（preFetch）按同一个格式进输入，也进依据', async () => {
  const dir = dataDir();
  let first = '';
  const r = await stub(async (env, o) => { first = first || o.user; return { text: '答完了', provider: 'stub' }; },
    () => loop.askWithTools({}, { system: 's', user: '要预研究的事项：输入方式', tools: ['meetings.search'], dataDir: dir,
      preFetch: [{ name: 'meetings.search', args: { query: '输入方式' } }] }));
  assert.match(first, /【工具结果 · 第 1 批】/);
  assert.ok(first.indexOf('【工具结果') < first.indexOf('要预研究的事项：'), '资料在前、题目在后——题目后面跟的是要解析的 JSON，不能被隔开');
  assert.ok(r.sources.length > 0);
  assert.ok(r.sources[0].ref.startsWith('meeting:'));
});

test('模型不回话：如实返回失败，不编一个答案出来', async () => {
  const dir = dataDir();
  const r = await stub(async () => ({ text: null, errorCode: 'stub_fail' }),
    () => loop.askWithTools({}, { system: 's', user: 'u', tools: ['meetings.search'], dataDir: dir }));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'stub_fail');
  assert.equal(r.text, null);
});
