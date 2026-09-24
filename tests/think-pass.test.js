const test = require('node:test');
const assert = require('node:assert');
const t = require('../app/think-pass');

test('思考档：解析 fenced JSON、丢空话、按相似去重、类型兜底、最多两条', () => {
  const raw = '```json\n{"views":[{"kind":"best","claim":"像素先按端侧模型输入定","note":"云端无上限","evidence":"看模型能吃多大"},{"kind":"x","claim":"这点值得关注"},{"kind":"goal","claim":"像素先按端侧模型输入定。"},{"kind":"zzz","claim":"OCR 预览先判质量再选清晰度","note":"n"},{"kind":"remind","claim":"第三条不该出现"}]}\n```';
  const out = t.normalize(t.parse(raw), ['旧看法']);
  assert.deepStrictEqual(out.map(x => x.type), ['best', 'remind']);
  assert.strictEqual(out[0].kind, 'think');
  assert.strictEqual(out[0].label, '最佳方案');
  assert.strictEqual(out[1].claim, 'OCR 预览先判质量再选清晰度');
});

test('思考档：与已有看法相似的不再推；坏 JSON 回空', () => {
  assert.deepStrictEqual(t.normalize([{ kind: 'goal', claim: '摄像头像素由端侧模型输入决定' }], ['摄像头像素由端侧模型输入决定，云端无上限']), []);
  assert.deepStrictEqual(t.parse('不是 json'), []);
});

test('思考档：提示词带已有看法与转写，节奏常量是目标不是硬闸', () => {
  const u = t.userPrompt({ packText: 'P', existingClaims: ['A'], recent: 'R', enUI: false });
  assert.ok(u.includes('【已有看法】') && u.includes('- A') && u.includes('【最新转写】\nR'));
  assert.ok(t.THINK_INTERVAL_MS >= 20000 && t.MAX_ITEMS >= 2);
});

test('思考档：模型档 think 没配时退回 post，配了就用配的', () => {
  const llm = require('../app/llm');
  const pick = require('../app/llm').__pickModel || null;
  // 通过公开入口验证：legacyChain 推出的 models 里带 think
  const env = { LLM_PROVIDER: 'claude', LLM_MODEL_POST: 'opus', LLM_MODEL_THINK: 'claude-fable-5-1' };
  const p = llm.chainOf(env)[0];
  assert.strictEqual(p.models.think, 'claude-fable-5-1');
  assert.strictEqual(llm.pickModel(p, 'think'), 'claude-fable-5-1');
  assert.strictEqual(llm.pickModel({ models: { post: 'opus' } }, 'think'), 'opus');
});
