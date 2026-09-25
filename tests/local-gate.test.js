// M7：没 Jev 密钥时本机规则门卫顶上：数字 / 日期 / 人名 / 问句 / 决定词命中就触发分诊，2 秒最小间隔；不联网。
const test = require('node:test'); const assert = require('node:assert/strict');
const G = require('../app/jev-gate');
test('settingsOf：没密钥 → local 且 active；有密钥且 on → 走 Jev；LOCAL_GATE=off → 都不 active', () => {
  assert.deepEqual((({ enabled, local, active }) => ({ enabled, local, active }))(G.settingsOf({})), { enabled: false, local: true, active: true });
  assert.equal(G.settingsOf({ JEV_GATE: 'on', JEV_API_KEY: 'k' }).local, false);
  assert.equal(G.settingsOf({ LOCAL_GATE: 'off' }).active, false);
});
test('localJudge：五类规则 + 人名；闲聊不命中', () => {
  assert.equal(G.localJudge('那就这么定了，走 B 方案').kind, 'decision');
  assert.equal(G.localJudge('BOM 大概 45 美金').kind, 'claim');
  assert.equal(G.localJudge('我们 10月8日 之前出').hit, true);
  assert.equal(G.localJudge('这个能不能再便宜点？').kind, 'risk');
  assert.equal(G.localJudge('这块让 Kiko 看一下', ['Kiko']).hit, true);
  assert.equal(G.localJudge('嗯嗯对对，好的好的').hit, false);
  assert.equal(G.localJudge('嗯').hit, false);
});
test('Gate 本机模式：不调 fetch，命中立刻触发，2 秒内的并成一次', async () => {
  let clock = 1e6, fired = 0; const fetchImpl = () => { throw Error('本机模式不许联网'); };
  const g = new G.Gate({ env: {}, fetchImpl, now: () => clock, onTrigger: () => fired++, names: () => ['Tomo'] });
  assert.equal(g.minGapMs, 2000);
  await g.onFinal({ at: 1, text: '这个我们定了' }, 0, []); assert.equal(fired, 1);
  clock += 500; await g.onFinal({ at: 2, text: '交给 Tomo 跟' }, 1, []); assert.equal(fired, 1); assert.equal(g.stats.merged, 1);
  await g.onFinal({ at: 3, text: '好的好的嗯' }, 2, []); assert.equal(g.marks.length, 2, '闲聊不进标记');
  g.close(); assert.equal(g.snapshot().local, true);
});
