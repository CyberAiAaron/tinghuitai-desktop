'use strict';
// R11：本机转写的重连计数只增不减。两小时的会里网络零星抖 5 次，重试额度就被耗光，
// 剩下的时间一个字都不录，界面上只有一句「已停止重试」。
// 判据抄 deepgram-asr.js：真收到一句转写，才算这条连接是好的。
const { test } = require('node:test'), assert = require('node:assert/strict');
const { MacAsr } = require('../app/mac-asr.js');

// 不跑 start()：它会 open -a 拉起真的 .app。只驱动「收到一行结果」和「连接断了」这两件事。
function asr() {
  const results = [], logs = [];
  const a = new MacAsr('zh', j => results.push(j), m => logs.push(m));
  a.start = () => {};                      // 重连时不真的再拉一次
  a.close = () => {};
  const drop = () => { a.onExit(); if (a.retryTimer) { clearTimeout(a.retryTimer); a.retryTimer = null; } };
  return { a, results, logs, drop };
}
const fatal = results => results.filter(x => x.type === 'fatal');

test('收到真转写就把重连计数清零，长会不会被耗光重试额度', () => {
  const { a, results, drop } = asr();
  for (let i = 0; i < 4; i++) drop();
  assert.equal(a.restarts, 4);
  a.accept({ type: 'final', text: '这句是真收到的' });
  assert.equal(a.restarts, 0, '真收到转写后计数要归零');
  assert.deepEqual(fatal(results), [], '归零后不该有放弃重试的结论');
  for (let i = 0; i < 5; i++) drop();       // 清零之后还有完整的 5 次额度
  assert.deepEqual(fatal(results), []);
  drop();
  assert.equal(fatal(results).length, 1, '额度真用完时仍然要报出来，不是无限重连');
});

test('空 final 和 partial 不算「这条连接是好的」，不清零', () => {
  for (const j of [{ type: 'final', text: '   ' }, { type: 'final' }, { type: 'partial', text: '半句' }]) {
    const { a, drop } = asr();
    drop(); drop();
    a.accept(j);
    assert.equal(a.restarts, 2, JSON.stringify(j) + ' 不该清零');
  }
});

test('一次转写都没收到就反复断开，5 次后仍然放弃并报出来', () => {
  const { a, results, drop } = asr();
  for (let i = 0; i < 5; i++) drop();
  assert.deepEqual(fatal(results), []);
  drop();
  assert.equal(fatal(results).length, 1);
  assert.match(fatal(results)[0].text, /反复断开/);
  assert.equal(a.restarts, 6);
});

test('结果照常往上传，清零不吃掉这一条', () => {
  const { a, results } = asr();
  a.accept({ type: 'final', text: '要点一' });
  a.accept({ type: 'partial', text: '要点二' });
  assert.deepEqual(results.map(x => x.text), ['要点一', '要点二']);
});
