// M6：联网核查只对标了待核查 / 值得深想的条目；没来源 = 核不了；走 verify 档 + 联网工具 + 中等思考；耗时进用量账；post 档额度失败退 Opus 5.5。
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const v = require('../app/verify'); const llm = require('../app/llm');
test('shouldVerify：只认存疑 / 递答案 / conflict / 标了待核查', () => {
  assert.equal(v.shouldVerify({ kind: 'think', type: 'doubt', claim: 'x' }), true);
  assert.equal(v.shouldVerify({ kind: 'think', type: 'answer', claim: 'x' }), true);
  assert.equal(v.shouldVerify({ kind: 'think', type: 'goal', claim: '目的是省钱' }), false);
  assert.equal(v.shouldVerify({ kind: 'insight', type: 'answer', md: '普通洞察' }), false);
  assert.equal(v.shouldVerify({ kind: 'insight', type: 'conflict', md: '两个数对不上' }), true);
  assert.equal(v.shouldVerify({ kind: 'insight', type: 'answer', md: '**待核查** 高通 8 Elite 是 3nm' }), true);
  assert.equal(v.shouldVerify({ kind: 'think', type: 'doubt', claim: 'x', verify: {} }), false, '核过的不再核');
});
test('normalize：没来源一律核不了；有 url 保留 url+date；模型漏条补核不了', () => {
  const out = v.normalize([{ claim: 'A', verdict: '已核实', note: 'n', sources: [] }, { claim: 'B', verdict: '矛盾', sources: [{ url: 'https://x.com/a', date: '2026-09-01', title: 't' }, { url: 'ftp://bad' }] }], ['A', 'B', 'C']);
  assert.equal(out[0].verdict, '核不了');
  assert.deepEqual(out[1], { claim: 'B', verdict: '矛盾', note: '', sources: [{ url: 'https://x.com/a', date: '2026-09-01', title: 't' }] });
  assert.equal(out[2].verdict, '核不了');
});
test('run：kind=verify、tools=web、thinking 8000，只核传进来的条目', async () => {
  let got; const ask = async (env, o) => { got = o; return { text: JSON.stringify({ results: [{ claim: 'A', verdict: '已核实', sources: [{ url: 'https://a.cn', date: '2026-01-02' }] }] }), ms: 1234, model: 'opus' }; };
  const r = await v.run({}, ['A'], { ask });
  assert.equal(got.kind, 'verify'); assert.equal(got.tools, 'web'); assert.equal(got.thinking, 8000);
  assert.match(got.system, /来源 url/); assert.match(got.system, /核不了/);
  assert.equal(r.results[0].verdict, '已核实'); assert.equal(r.ms, 1234);
});
test('默认档：think=Opus 5.5，post=Fable 5.1，post 失败退 Opus 5.5', () => {
  const d = require('../app/config').defaults || null;
  const src = fs.readFileSync(path.join(__dirname, '../app/config.js'), 'utf8');
  assert.match(src, /LLM_MODEL_POST:'fable',LLM_MODEL_POST_FALLBACK:'opus'/);
  assert.match(src, /LLM_MODEL_THINK:'opus'/);
  const [p] = llm.chainOf({ LLM_PROVIDER: 'claude', LLM_MODEL_POST: 'fable', LLM_MODEL_THINK: 'opus', LLM_MODEL_POST_FALLBACK: 'opus' });
  assert.equal(llm.pickModel(p, 'post'), 'fable'); assert.equal(llm.pickModel(p, 'think'), 'opus'); assert.equal(llm.pickModel(p, 'verify'), 'opus');
  void d;
});
test('post 档首选失败（额度）→ 同一家退 postFallback，账本记 ms', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-')); const bin = path.join(dir, 'fake-claude');
  // 假 claude：--model fable 就失败，其他模型回 JSON
  fs.writeFileSync(bin, '#!/bin/sh\nfor a in "$@"; do [ "$a" = fable ] && { echo quota >&2; exit 1; }; done\ncat >/dev/null\necho \'{"type":"result","result":"OK","is_error":false,"usage":{"input_tokens":3,"output_tokens":1},"modelUsage":{"opus":{"outputTokens":1}}}\'\n'); fs.chmodSync(bin, 0o755);
  const env = { LLM_CHAIN: [{ type: 'cli', kind: 'custom', name: 'fake', bin, args: ['--model', '{model}'], models: { post: 'fable', postFallback: 'opus' } }] };
  const r = await llm.ask(env, { kind: 'post', user: 'hi', dataDir: dir });
  assert.ok(r.text, 'fallback 应该拿到正文'); assert.equal(r.requestedModel, 'opus'); assert.ok(Number.isFinite(r.ms));
  llm.noteUsage(dir, r, { user: 'hi', tier: 'post' });
  const row = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'usage.jsonl'), 'utf8').trim().split('\n').pop());
  assert.ok(Number.isFinite(row.ms));
});
test('会中接线：think / 分诊出卡后排进 queueVerify；会后管线调 verify.js', () => {
  const s = fs.readFileSync(path.join(__dirname, '../app/server.js'), 'utf8');
  assert.equal((s.match(/this\.queueVerify\(/g) || []).length, 2);
  const py = fs.readFileSync(path.join(__dirname, '../app/meeting-pipeline.py'), 'utf8');
  assert.match(py, /CODE_ROOT \/ 'verify\.js'/); assert.match(py, /web_verify_checked\(extra\['review'\]/);
});

test('normalize：来源缺日期不算来源，结论降为核不了', () => {
  const out = v.normalize([{ claim: 'A', verdict: '已核实', sources: [{ url: 'https://x.com/a', date: '' }] }], ['A']);
  assert.equal(out[0].verdict, '核不了'); assert.equal(out[0].sources.length, 0);
});

test('联网核查只走 claude 命令行：链上只有接口类 / codex 时不调用，返回 no_provider', async () => {
  const llm = require('../app/llm');
  const r = await llm.ask({ LLM_CHAIN: [{ type: 'openai', label: 'ds', baseUrl: 'http://127.0.0.1:9', model: 'x' }] }, { kind: 'verify', user: 'u', tools: 'web', fetchImpl: async () => { throw new Error('不该被调用'); } });
  assert.equal(r.text, null); assert.equal(r.errorCode, 'no_provider');
});
test('会后联网核查没跑通：checked 一律改成核不了，不留常识结论', () => {
  const r = require('child_process').spawnSync('python3', ['-c', `import sys,json,importlib.util as u;s=u.spec_from_file_location('mp','app/meeting-pipeline.py');mp=u.module_from_spec(s);s.loader.exec_module(mp);mp.web_verify=lambda *a,**k:None;rv={'checked':[{'claim':'A','result':'已核实','note':'常识'}]};mp.web_verify_checked(rv);print(json.dumps(rv['checked'][0],ensure_ascii=False))`], { cwd: require('path').join(__dirname, '..'), encoding: 'utf8', env: { ...process.env, THT_DATA_DIR: require('os').tmpdir() } });
  const j = JSON.parse(r.stdout.trim()); assert.equal(j.result, '核不了'); assert.deepEqual(j.sources, []);
});
test('项目背景：文件缺失时 userPrompt 与旧格式一致；有文件时放在待核查前、截断 4000 字', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vctx-'));
  assert.equal(v.loadContext(dir), '');
  assert.equal(v.loadContext(''), '');
  assert.equal(v.userPrompt(['a', 'b'], v.loadContext(dir)), '【待核查】\n1. a\n2. b');
  fs.writeFileSync(path.join(dir, 'verify-context.md'), '阔屏 = 华为 Pura X Max 外屏\n' + 'x'.repeat(5000));
  const ctx = v.loadContext(dir);
  assert.equal(ctx.length, 4000);
  assert.ok(v.userPrompt(['a'], ctx).startsWith('【项目背景】\n阔屏 = 华为 Pura X Max 外屏'));
  assert.ok(v.userPrompt(['a'], ctx).endsWith('【待核查】\n1. a'));
});
test('提示词：公开部分拆出来核、追原始出处、数字来源进 sources', () => {
  const s = v.systemPrompt();
  for (const k of ['先拆再核', '只有整条都是项目内部决定', '追原始出处', '未找到原始出处', '列进 sources']) assert.ok(s.includes(k), k);
});
