'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { autopick } = require('../app/llm-autopick');
function fakeSettings(init) { let c = { ...init }; return { dataDir: '/tmp', load: () => ({ ...c }), save: x => { c = { ...x }; }, get: () => c }; }
test('没配模型：Claude 未登录、Codex 已登录 → 选 codex', async () => {
  const s = fakeSettings({});
  const r = await autopick({ settings: s, cli: { detect: () => ({ claude: 1, codex: 1 }), probe: async k => ({ ok: k === 'codex' }) } });
  assert.equal(r.picked, 'codex'); assert.equal(s.get().LLM_PROVIDER, 'codex');
});
test('Claude 可用时优先 Claude', async () => {
  const s = fakeSettings({});
  await autopick({ settings: s, cli: { detect: () => ({ claude: 1, codex: 1 }), probe: async () => ({ ok: true }) } });
  assert.equal(s.get().LLM_PROVIDER, 'claude');
});
test('已配过（命令行 / DeepSeek / 链）一律不碰、不 probe', async () => {
  for (const init of [{ LLM_PROVIDER: 'codex' }, { DEEPSEEK_API_KEY: 'x' }, { LLM_CHAIN: [{ type: 'cli', kind: 'claude' }] }]) {
    let probed = 0; const s = fakeSettings(init);
    const r = await autopick({ settings: s, cli: { detect: () => ({ claude: 1 }), probe: async () => { probed++; return { ok: true }; } } });
    assert.equal(r.skipped, 'configured'); assert.equal(probed, 0);
  }
});
test('都不通：什么也不写', async () => {
  const s = fakeSettings({});
  const r = await autopick({ settings: s, cli: { detect: () => ({ codex: 1 }), probe: async () => ({ ok: false }) } });
  assert.equal(r.picked, ''); assert.equal(s.get().LLM_PROVIDER, undefined);
});
