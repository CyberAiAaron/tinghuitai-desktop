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
  let got; const ask = async (env, o) => { got = o; return { text: JSON.stringify({ results: [{ claim: 'A', verdict: '已核实', sources: [{ url: 'https://a.cn', date: '2026-01-02' }] }] }), ms: 1234, model: 'claude-opus-5-5' }; };
  const r = await v.run({}, ['A'], { ask });
  assert.equal(got.kind, 'verify'); assert.equal(got.tools, 'web'); assert.equal(got.thinking, 8000);
  assert.match(got.system, /来源 url/); assert.match(got.system, /核不了/);
  assert.equal(r.results[0].verdict, '已核实'); assert.equal(r.ms, 1234);
});
test('默认档：think=Opus 5.5，post=Fable 5.1，post 失败退 Opus 5.5', () => {
  const d = require('../app/config').defaults || null;
  const src = fs.readFileSync(path.join(__dirname, '../app/config.js'), 'utf8');
  assert.match(src, /LLM_MODEL_POST:'claude-fable-5-1',LLM_MODEL_POST_FALLBACK:'claude-opus-5-5'/);
  assert.match(src, /LLM_MODEL_THINK:'claude-opus-5-5'/);
  const [p] = llm.chainOf({ LLM_PROVIDER: 'claude', LLM_MODEL_POST: 'claude-fable-5-1', LLM_MODEL_THINK: 'claude-opus-5-5', LLM_MODEL_POST_FALLBACK: 'claude-opus-5-5' });
  assert.equal(llm.pickModel(p, 'post'), 'claude-fable-5-1'); assert.equal(llm.pickModel(p, 'think'), 'claude-opus-5-5'); assert.equal(llm.pickModel(p, 'verify'), 'claude-opus-5-5');
  void d;
});
test('post 档首选失败（额度）→ 同一家退 postFallback，账本记 ms', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-')); const bin = path.join(dir, 'fake-claude');
  // 假 claude：--model claude-fable-5-1 就失败，其他模型回 JSON
  fs.writeFileSync(bin, '#!/bin/sh\nfor a in "$@"; do [ "$a" = claude-fable-5-1 ] && { echo quota >&2; exit 1; }; done\ncat >/dev/null\necho \'{"type":"result","result":"OK","is_error":false,"usage":{"input_tokens":3,"output_tokens":1},"modelUsage":{"claude-opus-5-5":{"outputTokens":1}}}\'\n'); fs.chmodSync(bin, 0o755);
  const env = { LLM_CHAIN: [{ type: 'cli', kind: 'custom', name: 'fake', bin, args: ['--model', '{model}'], models: { post: 'claude-fable-5-1', postFallback: 'claude-opus-5-5' } }] };
  const r = await llm.ask(env, { kind: 'post', user: 'hi', dataDir: dir });
  assert.ok(r.text, 'fallback 应该拿到正文'); assert.equal(r.requestedModel, 'claude-opus-5-5'); assert.ok(Number.isFinite(r.ms));
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
