'use strict';
// D9：记忆库给老库补列的两处原来是裸 catch（`catch(e){ /* 已有 */ }`）。
// 库被锁、只读或文件坏的时候，「加列失败」被当成「这列本来就有」吞掉，接着 claiming / attempts
// 一路写不进去 —— 表现是这台机器永远抽不出记忆，而且日志里一个字都没有。
// 判据要和 cards.change_reason 那处一样：报的是 duplicate column、并且这一列现在确实在表上，才算正常。
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const memory = require('../app/memory.js');

// 假库：exec 抛指定的错，prepare 只服务 PRAGMA table_info
function fakeDb({ error, columns = [], pragmaThrows = false }) {
  const execs = [];
  return {
    execs,
    exec(sql) { execs.push(sql); if (error) throw Object.assign(new Error(error), { code: 'ERR_SQLITE_ERROR' }); },
    prepare() {
      if (pragmaThrows) throw new Error('database is locked');
      return { all: () => columns.map(name => ({ name })) };
    },
  };
}

test('加列成功就什么都不做', () => {
  const db = fakeDb({});
  memory.addColumn(db, 'ingested', 'attempts', 'attempts INTEGER NOT NULL DEFAULT 0');
  assert.equal(db.execs.length, 1);
  assert.match(db.execs[0], /ALTER TABLE ingested ADD COLUMN attempts/);
});

test('列本来就有（duplicate column + PRAGMA 里确实看得到）才算正常，不抛', () => {
  const db = fakeDb({ error: 'duplicate column name: attempts', columns: ['meeting_id', 'attempts'] });
  memory.addColumn(db, 'ingested', 'attempts', 'attempts INTEGER NOT NULL DEFAULT 0');
});

test('库只读或被锁：抛出来并记一行日志，不当成「已有」吞掉', () => {
  for (const err of ['attempt to write a readonly database', 'database is locked', 'database disk image is malformed']) {
    const logs = [];
    assert.throws(
      () => memory.addColumn(fakeDb({ error: err, columns: ['attempts'] }), 'ingested', 'attempts', 'attempts INTEGER', m => logs.push(m)),
      /记忆库升级失败（ingested\.attempts 列）/,
      err + ' 必须抛出来');
    assert.equal(logs.length, 1, err + ' 必须留下日志');
    assert.match(logs[0], new RegExp(err.slice(0, 12)), '日志里要带原始错因');
  }
});

test('报 duplicate column、但这一列其实不在表上：仍然算出事了', () => {
  assert.throws(() => memory.addColumn(fakeDb({ error: 'duplicate column name: attempts', columns: ['meeting_id'] }),
    'ingested', 'attempts', 'attempts INTEGER'), /记忆库升级失败/);
});

test('连 PRAGMA 都读不出来时不静默放过', () => {
  assert.throws(() => memory.addColumn(fakeDb({ error: 'duplicate column name: attempts', pragmaThrows: true }),
    'ingested', 'attempts', 'attempts INTEGER'), /记忆库升级失败/);
});

test('真库：同一份库连开两次，第二次走的就是「列已经有了」这条路，照常可用', t => {
  let DatabaseSync = null;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) {}
  if (!DatabaseSync) return t.skip('这个 node 没有 node:sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-mem-'));
  try {
    const first = memory.open(dir);
    assert.ok(first, '第一次打开应当建好库');
    memory.closeAll();
    const again = memory.open(dir);                 // 表和列都在了：三处 addColumn 全走 duplicate column
    assert.ok(again);
    const cols = again.prepare('PRAGMA table_info(ingested)').all().map(c => c.name);
    assert.ok(cols.includes('status') && cols.includes('attempts'), '补的两列要在：' + cols.join(','));
    const card = memory.putCard(again, { kind: 'decision', text: '重开一次库也要能写进去', meeting_id: 'm1' });
    assert.ok(card && card.id);
    memory.closeAll();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
