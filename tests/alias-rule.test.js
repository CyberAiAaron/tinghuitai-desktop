// M3：回看页把已有名字改成另一个 → memory.db 里一条别名规则卡（kind=rule, topic=alias, 全局, 用户纠正）+ 词表；下一场纠名表用得上。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const mem = require('../app/memory');
test('putAliasRule：写卡 + 词表；占位名（S2 / 未认人）不当别名；同一错名改新写法时旧卡撤销', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-')); const db = mem.open(dir);
  assert.equal(mem.putAliasRule(db, 'S2', '张珊', 'm').ok, false);
  assert.equal(mem.putAliasRule(db, '未认人', '张珊', 'm').ok, false);
  const r = mem.putAliasRule(db, '张三', '张珊', 'm1'); assert.equal(r.ok, true);
  const card = db.prepare('SELECT * FROM cards WHERE id=?').get(r.cardId);
  assert.equal(card.kind, 'rule'); assert.equal(card.topic, 'alias'); assert.equal(card.human_edited, 1); assert.match(card.change_reason, /source=user-correction; scope=global/);
  assert.deepEqual(mem.aliasRules(db), [{ wrong: '张三', right: '张珊' }]);
  assert.equal(mem.lexAll(db).find(x => x.wrong === '张三').right, '张珊');
  mem.putAliasRule(db, '张三', '章珊', 'm2');
  assert.deepEqual(mem.aliasRules(db), [{ wrong: '张三', right: '章珊' }]);
});
test('回看页答题改名：原来有名字 → 生成别名卡；原来没名字 → 只改本场', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-mp-')); const dir = path.join(data, 'state', 'meeting-pipeline'); fs.mkdirSync(dir, { recursive: true });
  const old = process.env.THT_DATA_DIR; process.env.THT_DATA_DIR = data;
  try {
    const mp = require('../app/meeting-pipeline')({ dir, idle: () => false });
    const key = require('crypto').createHash('sha256').update('m1').digest('hex').slice(0, 16);
    fs.writeFileSync(path.join(dir, key + '.job.json'), JSON.stringify({ key, sessionId: 'm1', created: '2026-09-25', status: 'done', input: '' }));
    fs.writeFileSync(path.join(dir, key + '.job.enhanced.json'), JSON.stringify({ id: 'm1', names: { '2': '李四' }, brief: { questions: [
      { id: 'q1', ask: 'S2 是谁？', options: ['李思', '丙'], recommend: 0, affects: ['speaker:2'] },
      { id: 'q2', ask: 'S3 是谁？', options: ['王五', '丁'], recommend: 0, affects: ['speaker:3'] }] } }));
    mp.answer('m1', 'q1', 0, ''); mp.answer('m1', 'q2', 0, '');
    assert.deepEqual(mem.aliasRules(mem.open(data)), [{ wrong: '李四', right: '李思' }]);
  } finally { if (old === undefined) delete process.env.THT_DATA_DIR; else process.env.THT_DATA_DIR = old; }
});
test('纠名表读别名规则卡', () => {
  const s = fs.readFileSync(path.join(__dirname, '../app/server.js'), 'utf8');
  assert.match(s, /for \(const r of mem\.aliasRules\(mem\.open\(DATA\)\)\)/);
});
