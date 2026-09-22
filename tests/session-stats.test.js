'use strict';
// 主动智能批 4（需求单 F5）：每场结束的四个数（Jev 调用 / Sonnet 调用 / 洞察 / 采纳）从 usage.jsonl 与场次算，合成账本行逐条核对。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const S = require(path.join(__dirname, '..', 'app/session-stats.js'));

const row = (sessionId, provider, tier, extra = {}) => JSON.stringify({ ts: Date.now(), sessionId, provider, tier, in: 100, out: 0, ...extra });

test('compute：jev 按 provider 数（失败行也算）；Sonnet 按 live 档非 jev 数；post 档 / 其它场次 / 没 sessionId 的不算', () => {
  const rows = [
    { provider: 'jev', tier: 'gate', hit: true }, { provider: 'jev', tier: 'gate', hit: false, error: 'timeout 3000ms' }, { provider: 'jev', tier: 'gate' },
    { provider: 'claude', tier: 'live', purpose: 'triage' }, { provider: 'claude', tier: 'triage' }, { provider: 'api', tier: 'quick' },
    { provider: 'claude', tier: 'post', purpose: 'one-pager' }, { provider: 'claude', tier: 'post', purpose: 'condense' },
  ];
  const sess = { id: 's1', factchecks: [
    { id: 'a', type: 'conflict', rating: 'adopt' }, { id: 'b', type: 'recheck', actionState: { status: 'done' } },
    { id: 'c', type: 'answer', rating: 'useless' }, { id: 'd', type: 'conflict', actionState: { status: 'failed' } }, null,
  ] };
  const st = S.compute(sess, rows);
  assert.equal(st.jevCalls, 3); assert.equal(st.sonnetCalls, 3); assert.equal(st.insights, 4); assert.equal(st.adopted, 2);
  assert.deepEqual(st.sourceHit, { hit: 0, miss: 0 }, '第五个数：没有按钮执行过 → 0/0');
  assert.deepEqual(S.compute({ id: 'x' }, []), { ...S.compute({ id: 'x' }, []), jevCalls: 0, sonnetCalls: 0, insights: 0, adopted: 0, sourceHit: { hit: 0, miss: 0 } });
});

test('compute：sourceHit 第五个数（Aaron 2026-09-22 拍板兜底 B）：卡片 sourceHit hit / miss 各数一次，同卡重复只算一次，别的值不算', () => {
  const sess = { id: 's5', factchecks: [
    { id: 'a', type: 'conflict', actionState: { status: 'done' }, sourceHit: 'hit' }, { id: 'a', sourceHit: 'hit' },
    { id: 'b', type: 'recheck', actionState: { status: 'offer' }, sourceHit: 'miss' },
    { id: 'c', type: 'recheck', actionState: { status: 'done' }, sourceHit: 'miss' },
    { id: 'd', type: 'answer' }, { id: 'e', type: 'conflict', sourceHit: 'junk' },
  ] };
  const st = S.compute(sess, []);
  assert.deepEqual(st.sourceHit, { hit: 1, miss: 2 }); assert.equal(st.insights, 5); assert.equal(st.adopted, 2, 'offer 不算采纳');
});

test('compute：同一张卡重复出现（同 id 两条，一条 rating、一条 actionState）只算一张、采纳只算一次；没 id 按 claim 归并', () => {
  const sess = { id: 's2', factchecks: [
    { id: 'a', rating: 'adopt' }, { id: 'a', actionState: { status: 'done' } }, { id: 'a' },
    { claim: '同一句', rating: 'useful' }, { claim: '同一句', actionState: { status: 'done' } },
    { id: 'b', rating: 'useless' }, 'junk', null,
  ] };
  const st = S.compute(sess, []);
  assert.equal(st.insights, 3, 'a / 同一句 / b 三张'); assert.equal(st.adopted, 2, 'a 一次 + 同一句一次');
});

test('readUsageRows：只取本场 sessionId 的行，usage.jsonl.1（滚过的）一起看，坏行跳过；forSession 四个数与合成账本对得上', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemate-stats-'));
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'state', 'usage.jsonl.1'), [row('m1', 'jev', 'gate'), row('m2', 'jev', 'gate')].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'state', 'usage.jsonl'), [
    row('m1', 'jev', 'gate', { hit: true }), row('m1', 'jev', 'gate', { error: 'timeout 3000ms' }),
    row('m1', 'claude', 'live', { purpose: 'triage' }), row('m1', 'claude', 'live', { purpose: 'triage' }), row('m1', 'claude', 'post', { purpose: 'one-pager' }),
    row('m2', 'claude', 'live'), '{"sessionId":"m1",broken', JSON.stringify({ ts: 1, provider: 'claude', tier: 'live' }),
    // sessionId 只在别的字段里出现（粗筛命中、细筛不认）
    JSON.stringify({ ts: 1, sessionId: 'm9', provider: 'claude', tier: 'live', purpose: 'm1' }),
  ].join('\n') + '\n');
  const rows = S.readUsageRows(dir, 'm1');
  assert.equal(rows.length, 6);
  const sess = { id: 'm1', factchecks: [{ id: 'a', rating: 'adopt' }, { id: 'b', rating: 'useful' }, { id: 'c', actionState: { status: 'done' }, rating: 'adopt' }] };
  const st = S.forSession(dir, sess);
  assert.equal(st.jevCalls, 3, 'jev：.1 里 1 行 + 当前 2 行（含失败）');
  assert.equal(st.sonnetCalls, 2, 'Sonnet：两次 live 分诊；post 档纠错单不算');
  assert.equal(st.insights, 3); assert.equal(st.adopted, 2, 'adopt 或按钮执行完，同一张卡只算一次');
  assert.deepEqual(S.readUsageRows(dir, ''), []); assert.deepEqual(S.readUsageRows(path.join(dir, 'nope'), 'm1'), []);
});
