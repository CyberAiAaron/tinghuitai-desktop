// M1：Codex 命令行按用途带模型和推理强度；M6：只有 tools==='web' 才放开联网工具。精确参数断言。
const test = require('node:test'); const assert = require('node:assert');
const { args } = require('../app/cli-llm');
const BASE = ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '--ephemeral', '-c', 'project_doc_max_bytes=0'];
test('codex live：-m + low', () => assert.deepStrictEqual(args('codex', { model: 'gpt-5-mini', purpose: 'live' }), [...BASE, '-m', 'gpt-5-mini', '-c', 'model_reasoning_effort="low"', '-']));
test('codex post：-m + medium', () => assert.deepStrictEqual(args('codex', { model: 'gpt-5', purpose: 'post' }), [...BASE, '-m', 'gpt-5', '-c', 'model_reasoning_effort="medium"', '-']));
test('codex think：-m + high', () => assert.deepStrictEqual(args('codex', { model: 'gpt-5', purpose: 'think' }), [...BASE, '-m', 'gpt-5', '-c', 'model_reasoning_effort="high"', '-']));
test('codex 没模型没用途：和旧参数一致', () => assert.deepStrictEqual(args('codex', {}), [...BASE, '-']));
test('claude 默认不给联网工具', () => { const a = args('claude', { model: 'opus' }); assert.ok(a.includes('Bash,Edit,Write,WebFetch,WebSearch')); assert.ok(!a.includes('Read,WebSearch,WebFetch')); });
test("claude tools='web' 只放开 WebSearch/WebFetch", () => {
  const a = args('claude', { model: 'opus', tools: 'web' });
  assert.strictEqual(a[a.indexOf('--allowedTools') + 1], 'Read,WebSearch,WebFetch');
  assert.strictEqual(a[a.indexOf('--disallowedTools') + 1], 'Bash,Edit,Write');
});
test('llm.js 把 kind 当 purpose 传给命令行适配器', () => { const s = require('fs').readFileSync(require('path').join(__dirname, '../app/llm.js'), 'utf8'); assert.strictEqual((s.match(/tools, purpose: kind \}\)/g) || []).length, 2); });
