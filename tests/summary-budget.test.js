// M2：会后总结放得下就一趟全文，放不下才分块；预算 = 模型上下文 − 系统提示 − 记忆资料 − 输出预留。
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'); const { spawnSync } = require('child_process');
const APP = path.join(__dirname, '..', 'app');
const py = (code, env = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
  const r = spawnSync('python3', ['-c', `import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location('mp',${JSON.stringify(path.join(APP, 'meeting-pipeline.py'))});mp=importlib.util.module_from_spec(spec);spec.loader.exec_module(mp)\n${code}`],
    { encoding: 'utf8', env: { ...process.env, THT_DATA_DIR: dir, THT_CFG_JSON: JSON.stringify(env) } });
  if (r.status) throw Error(r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
};
const RUN = `
calls=[]
def fake(system,user,**k):
    calls.append(len(user)); return {'text':'纪要'+str(len(calls)),'attempts':[]}
mp.ask_model=fake
rows=[{'at':i,'speaker':1,'text':'这是第%d句会议内容，讨论硬件架构和成本。' % i} for i in range(N)]
out=mp.summarize({'id':'s','transcript':rows,'notes':''},context_purpose=None)
print(json.dumps({'mode':mp.SUMMARY_NOTE['mode'],'calls':len(calls),'maxUser':max(calls)}))`;
test('预算：Claude 档 200k token，扣掉系统提示 / 记忆 / 输出预留', () => {
  const r = py(`print(json.dumps({'c':mp.model_context_tokens('claude-fable-5-1'),'d':mp.model_context_tokens('unknown-x'),'b':mp.summary_budget_chars('x'*1000,'',model='claude-opus-5-5')}))`);
  assert.equal(r.c, 200000); assert.equal(r.d, 32000);
  assert.equal(r.b, Math.floor((200000 - 5000) * 1.5) - 1000 - 9000);
});
test('长会（约 5 万字）在 200k 模型下单趟全文，不分块', () => {
  const r = py(RUN.replace('range(N)', 'range(2000)'), { LLM_MODEL_POST: 'claude-fable-5-1' });
  assert.equal(r.mode, 'single'); assert.equal(r.calls, 1); assert.ok(r.maxUser > 40000);
});
test('同一场在 32k 模型下放不下 → 分块', () => {
  const r = py(RUN.replace('range(N)', 'range(2000)'), { LLM_MODEL_POST: 'small-model' });
  assert.equal(r.mode, 'chunked'); assert.ok(r.calls > 1);
});
test('LLM_CONTEXT_TOKENS 覆盖模型名', () => {
  const r = py(`print(json.dumps({'n':mp.model_context_tokens()}))`, { LLM_MODEL_POST: 'claude-opus-5-5', LLM_CONTEXT_TOKENS: 50000 });
  assert.equal(r.n, 50000);
});
