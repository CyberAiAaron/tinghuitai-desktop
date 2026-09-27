'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const sources = require('../app/context-sources'), contextPack = require('../app/context-pack');
const memory = require('../app/memory'), memoryOps = require('../app/memory-ops');

const temp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('来源注册表只把本场选择且项目匹配的本机文件和目录交给 context-pack', () => {
  const dir = temp('tht-context-sources-'), docs = path.join(dir, 'docs');
  try {
    fs.mkdirSync(docs); fs.writeFileSync(path.join(docs, 'one.md'), 'A 目录事实');
    const a = path.join(dir, 'a.md'), b = path.join(dir, 'b.md'), g = path.join(dir, 'global.md');
    fs.writeFileSync(a, 'A 项目机密'); fs.writeFileSync(b, 'B 项目机密'); fs.writeFileSync(g, '全局词典');
    sources.save(dir, [
      { id: 'a-file', type: 'file', path: a, projectId: 'A', title: 'A 文件' },
      { id: 'a-dir', type: 'directory', path: docs, projectId: 'A', title: 'A 目录' },
      { id: 'b-file', type: 'file', path: b, projectId: 'B', title: 'B 文件' },
      { id: 'global', type: 'file', path: g, scope: 'global', title: '全局来源' },
    ]);
    const pack = contextPack.build({}, { purpose: 'live', dataDir: dir,
      session: { projectId: 'A', contextSourceIds: ['a-file', 'a-dir', 'b-file', 'global'] } });
    assert.match(pack.text, /A 项目机密/); assert.match(pack.text, /A 目录事实/); assert.match(pack.text, /全局词典/);
    assert.doesNotMatch(pack.text, /B 项目机密/);
    const blocked = pack.parts.find(x => x.key === 'selected-sources/b-file');
    assert.equal(blocked.missing, true); assert.match(blocked.reason, /其他项目/);
    assert.ok(pack.parts.filter(x => x.key.startsWith('selected-sources/')).every(x => x.missing || x.version));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('来源注册表拒绝重复 id，更新采用原子文件并保留显式 global', () => {
  const dir = temp('tht-context-registry-');
  try {
    assert.throws(() => sources.save(dir, [
      { id: 'same', type: 'file', path: '/tmp/a', projectId: 'A' },
      { id: 'same', type: 'file', path: '/tmp/b', projectId: 'B' },
    ]), /重复/);
    sources.upsert(dir, { id: 'shared', type: 'directory', path: '/tmp', scope: 'global', enabled: true });
    const row = sources.load(dir).sources[0];
    assert.equal(row.scope, 'global'); assert.equal(row.projectId, '');
    assert.equal(fs.statSync(sources.fileOf(dir)).mode & 0o077, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('会议记忆按项目强隔离，只有显式 global 可以跨项目', t => {
  let DatabaseSync = null; try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) {}
  if (!DatabaseSync) return t.skip('这个 node 没有 node:sqlite');
  const dir = temp('tht-memory-project-');
  try {
    const db = memory.open(dir);
    memory.putCard(db, { kind: 'decision', project: 'A', text: '电池供应商测试周五完成', recorded_at: new Date().toISOString() });
    memory.putCard(db, { kind: 'decision', project: 'B', text: '电池供应商测试周六完成', recorded_at: new Date().toISOString() });
    memory.putCard(db, { kind: 'term', project: '', scope: 'global', text: '电池供应商测试叫 EVT', recorded_at: new Date().toISOString() });
    const a = memoryOps.retrieve(dir, '电池供应商测试', { projectId: 'A' });
    assert.ok(a.some(x => x.text.includes('周五'))); assert.ok(a.some(x => x.scope === 'global'));
    assert.ok(!a.some(x => x.text.includes('周六')));
    const b = memoryOps.retrieve(dir, '电池供应商测试', { projectId: 'B' });
    assert.ok(b.some(x => x.text.includes('周六'))); assert.ok(!b.some(x => x.text.includes('周五')));
    const none = memoryOps.retrieve(dir, '电池供应商测试');
    assert.deepEqual(none.map(x => x.scope), ['global']);
  } finally { memory.closeAll(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('旧记忆库打开时补 scope 列，旧卡保持 project 范围而不会自动变 global', t => {
  let DatabaseSync = null; try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) {}
  if (!DatabaseSync) return t.skip('这个 node 没有 node:sqlite');
  const dir = temp('tht-memory-scope-migration-'), state = path.join(dir, 'state'); fs.mkdirSync(state);
  const raw = new DatabaseSync(path.join(state, 'memory.db'));
  raw.exec(`CREATE TABLE cards(
    id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1, project TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL,
    topic TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, state TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '', due TEXT NOT NULL DEFAULT '',
    aliases TEXT NOT NULL DEFAULT '', meeting_id TEXT NOT NULL DEFAULT '', meeting_title TEXT NOT NULL DEFAULT '', source_refs TEXT NOT NULL DEFAULT '[]',
    recorded_at TEXT NOT NULL, effective_at TEXT, supersedes_id TEXT, change_reason TEXT NOT NULL DEFAULT '', human_edited INTEGER NOT NULL DEFAULT 0,
    needs_review INTEGER NOT NULL DEFAULT 0, review_note TEXT NOT NULL DEFAULT '')`);
  raw.prepare("INSERT INTO cards(id,project,kind,text,state,recorded_at) VALUES('old','A','decision','旧卡','active',?)").run(new Date().toISOString()); raw.close();
  try {
    const db = memory.open(dir), cols = db.prepare('PRAGMA table_info(cards)').all().map(x => x.name);
    assert.ok(cols.includes('scope')); assert.equal(db.prepare("SELECT scope FROM cards WHERE id='old'").get().scope, 'project');
  } finally { memory.closeAll(); fs.rmSync(dir, { recursive: true, force: true }); }
});
