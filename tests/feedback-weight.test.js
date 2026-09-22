'use strict';
// 主动智能批 4（需求单 F5）：反馈按 type 计数，useless 多的那一类少给——规则一条：useless ≥2 且 > useful+adopt → 降权（提示词明说 + 归一化后同类只留 1 条）。
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('path');
const W = require(path.join(__dirname, '..', 'app/feedback-weight.js'));

const fb = (type, rating) => ({ type, rating, claim: 'x' });

test('demotedTypes：正例 conflict 两条 useless → 降权；反例 useless 1 条 / useless 被 useful+adopt 抵消 / 没 type 的老记录不算', () => {
  assert.deepEqual(W.demotedTypes([fb('conflict', 'useless'), fb('conflict', 'useless'), fb('answer', 'useful')]), ['conflict']);
  assert.deepEqual(W.demotedTypes([fb('conflict', 'useless')]), [], '只有 1 条不降');
  assert.deepEqual(W.demotedTypes([fb('conflict', 'useless'), fb('conflict', 'useless'), fb('conflict', 'useful'), fb('conflict', 'adopt')]), [], 'useless 2 = useful+adopt 2，不降');
  assert.deepEqual(W.demotedTypes([{ rating: 'useless', claim: 'a' }, { rating: 'useless', claim: 'b' }, { kind: 'insight', rating: 'useless' }]), [], '没 type 不猜');
  assert.deepEqual(W.demotedTypes([fb('recheck', 'useless'), fb('recheck', 'useless'), fb('recheck', 'useless'), fb('conflict', 'useless'), fb('conflict', 'useless')]), ['recheck', 'conflict'], '多类按 useless 多到少');
});

test('promptBlock：降权的类写进提示词（带条数、最多 1 条）；没有降权返回空串', () => {
  assert.equal(W.promptBlock([fb('answer', 'useful')]), '');
  const s = W.promptBlock([fb('conflict', 'useless'), fb('conflict', 'useless'), fb('conflict', 'useless')]);
  assert.match(s, /【少给】/); assert.match(s, /对不上（conflict） 这场他已标 3 条没用，本轮这一类最多 1 条/); assert.ok(!/recheck|answer/.test(s));
});

test('capDemoted：被降权的类每轮只留第一条，其它类原样；缺 type 按 answer', () => {
  const feedback = [fb('conflict', 'useless'), fb('conflict', 'useless')];
  const list = [{ id: 1, type: 'conflict' }, { id: 2, type: 'answer' }, { id: 3, type: 'conflict' }, { id: 4 }, { id: 5, type: 'recheck' }];
  assert.deepEqual(W.capDemoted(list, feedback).map(x => x.id), [1, 2, 4, 5]);
  assert.deepEqual(W.capDemoted(list, []).map(x => x.id), [1, 2, 3, 4, 5], '没降权一条不动');
  const ansDemoted = [fb('answer', 'useless'), fb('answer', 'useless')];
  assert.deepEqual(W.capDemoted(list, ansDemoted).map(x => x.id), [1, 2, 3, 5], '缺 type 的按 answer 一起被限');
});
