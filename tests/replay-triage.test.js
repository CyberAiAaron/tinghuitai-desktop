'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { replay } = require('../app/replay-triage');

const meeting = () => ({ id: 'm1', transcript: Array.from({ length: 80 }, (_, i) =>
  ({ id: 'seg-' + i, at: i * 5, text: '讨论事项 ' + i })), highlights: [], todos: [], factchecks: [] });

test('replay keeps the source unchanged, deduplicates chunks and grounds timestamps', async () => {
  const original = meeting();
  let calls = 0;
  const result = await replay(original, async () => {
    calls++;
    return JSON.stringify({ highlights: [{ text: '决定先做原型', at: calls === 1 ? 25 : 250 }], todos: [], factchecks: [] });
  });
  assert.equal(calls, 2);
  assert.equal(original.highlights.length, 0);
  assert.equal(result.session.highlights.length, 1);
  assert.equal(result.session.highlights[0].replay, true);
  assert.deepEqual(result.session.highlights[0].sourceRefs, [{ segId: 'seg-5' }]);
  assert.ok(result.session.replay.doneAt);
  assert.equal((await replay(result.session, async () => { throw Error('must not call'); })).skipped, true);
});

test('failed second chunk returns no partial result and cannot mutate the meeting', async () => {
  const original = meeting();
  let calls = 0;
  await assert.rejects(replay(original, async () => ++calls === 1
    ? JSON.stringify({ highlights: [{ text: '一个要点', at: 15 }] }) : ''), /模型未返回/);
  assert.equal(original.highlights.length, 0);
  assert.equal(original.replay, undefined);
});
