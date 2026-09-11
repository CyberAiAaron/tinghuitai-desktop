'use strict';
// 会议记忆真源：SQLite。有事务、能并发、坏不了。
// 另有一份只读 md 投影（见 memory-ops.js），给人在 Claude 里看；投影改了不生效。
const path = require('path'), fs = require('fs');
let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) { /* 旧 node：整层降级为不可用 */ }

const KINDS = new Set(['decision', 'question', 'promise', 'term']);
// 四类记忆的生命周期不同，不能共用一套状态
const STATES = {
  decision: ['active', 'superseded', 'revoked'],
  term:     ['active', 'superseded', 'revoked'],
  question: ['open', 'resolved'],
  promise:  ['pending', 'done', 'cancelled'],
};
const DEFAULT_STATE = { decision: 'active', term: 'active', question: 'open', promise: 'pending' };
const TERMINAL = new Set(['revoked', 'superseded', 'resolved', 'done', 'cancelled']);
const DROP_STATE = { decision: 'revoked', term: 'revoked', question: 'resolved', promise: 'cancelled' };

// 每次调用都新建连接会把 fd 和内存吃光（retrieve 是高频路径）。按数据目录做单例。
const POOL = new Map();
function open(dataDir) {
  if (!DatabaseSync) return null;
  const key = path.resolve(dataDir);
  const hit = POOL.get(key);
  if (hit) { try { hit.prepare('SELECT 1').get(); return hit; } catch (e) { POOL.delete(key); } }
  const dir = path.join(key, 'state');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dir, 'memory.db'));
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA busy_timeout=4000');
  db.exec('PRAGMA synchronous=NORMAL');
  db.exec(`CREATE TABLE IF NOT EXISTS cards(
    id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1,
    project TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL, state TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '', due TEXT NOT NULL DEFAULT '',
    aliases TEXT NOT NULL DEFAULT '', meeting_id TEXT NOT NULL DEFAULT '', meeting_title TEXT NOT NULL DEFAULT '',
    source_refs TEXT NOT NULL DEFAULT '[]', recorded_at TEXT NOT NULL, effective_at TEXT,
    supersedes_id TEXT, human_edited INTEGER NOT NULL DEFAULT 0, needs_review INTEGER NOT NULL DEFAULT 0,
    review_note TEXT NOT NULL DEFAULT '')`);
  db.exec(`CREATE TABLE IF NOT EXISTS card_history(
    id TEXT NOT NULL, revision INTEGER NOT NULL, snapshot TEXT NOT NULL, changed_at TEXT NOT NULL,
    PRIMARY KEY(id, revision))`);
  // status 区分「正在抽」和「抽完了」：进程中途死掉时，claiming 会过期，不会让这场永远抽不了
  db.exec(`CREATE TABLE IF NOT EXISTS ingested(
    meeting_id TEXT PRIMARY KEY, input_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'done', at TEXT NOT NULL)`);
  try { db.exec("ALTER TABLE ingested ADD COLUMN status TEXT NOT NULL DEFAULT 'done'"); } catch (e) { /* 已有 */ }
  db.exec('CREATE INDEX IF NOT EXISTS idx_cards_kind_state ON cards(kind,state)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cards_meeting ON cards(meeting_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cards_live ON cards(state,needs_review,recorded_at)');
  POOL.set(key, db);
  return db;
}
function closeAll() { for (const [k, db] of POOL) { try { db.close(); } catch (e) {} POOL.delete(k); } }

const now = () => new Date().toISOString();
const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
// 模型可能把 owner 返回成对象、把 due 返回成数字。数字照抄，对象/数组一律当没填，
// 不要 String() 成 [object Object] 存进去。
const str = (v, n) => {
  if (typeof v === 'string') return v.slice(0, n);
  if (typeof v === 'number' && isFinite(v)) return String(v).slice(0, n);
  return '';
};
// 上游给的时间可能是毫秒数或任意串，不归一化会让衰减算成 NaN、投影里打印出一串数字
function iso(v) {
  if (typeof v === 'number' && isFinite(v)) { const d = new Date(v); return isNaN(d) ? now() : d.toISOString(); }
  if (typeof v === 'string' && v) { const d = new Date(/^\d{10,}$/.test(v) ? Number(v) : v); return isNaN(d) ? now() : d.toISOString(); }
  return now();
}
// 事务嵌套会让内层的 ROLLBACK 把外层一起回滚。统一用 SAVEPOINT。
let spSeq = 0;
function inTx(db, fn) {
  const sp = 'sp' + (++spSeq);
  db.exec('SAVEPOINT ' + sp);
  let r;
  try { r = fn(); }
  catch (e) { try { db.exec('ROLLBACK TO ' + sp); db.exec('RELEASE ' + sp); } catch (e2) {} throw e; }
  // RELEASE 自己也可能失败（磁盘满、I/O 错）。连接是长生命周期池化的，
  // 这里不收拾就会留下一个永不提交的事务，之后所有写入都不落盘。
  try { db.exec('RELEASE ' + sp); }
  catch (e) { try { db.exec('ROLLBACK TO ' + sp); db.exec('RELEASE ' + sp); } catch (e2) { try { db.exec('ROLLBACK'); } catch (e3) {} } throw e; }
  return r;
}

const COLS = ['project','kind','topic','text','state','owner','due','aliases','meeting_id','meeting_title',
              'source_refs','recorded_at','effective_at','supersedes_id','human_edited','needs_review','review_note'];

function putCard(db, c) {
  const kind = KINDS.has(c.kind) ? c.kind : 'decision';
  const allowed = STATES[kind];
  const state = allowed.includes(c.state) ? c.state : DEFAULT_STATE[kind];
  const row = {
    id: str(c.id, 64) || uid(), revision: 1, project: str(c.project, 80), kind, topic: str(c.topic, 120),
    text: str(c.text, 2000), state, owner: str(c.owner, 80), due: str(c.due, 40),
    aliases: Array.isArray(c.aliases) ? c.aliases.map(x => str(x, 60)).join(',').slice(0, 300) : str(c.aliases, 300),
    meeting_id: str(c.meeting_id, 100), meeting_title: str(c.meeting_title, 200),
    source_refs: JSON.stringify(Array.isArray(c.source_refs) ? c.source_refs.slice(0, 20) : []),
    recorded_at: iso(c.recorded_at), effective_at: c.effective_at ? iso(c.effective_at) : null,
    supersedes_id: str(c.supersedes_id, 64) || null, human_edited: c.human_edited ? 1 : 0,
    needs_review: c.needs_review ? 1 : 0, review_note: str(c.review_note, 300),
  };
  if (!row.text.trim()) return null;
  return inTx(db, () => {
    db.prepare(`INSERT INTO cards(id,revision,${COLS.join(',')}) VALUES(?,?,${COLS.map(() => '?').join(',')})`)
      .run(row.id, row.revision, ...COLS.map(k => row[k]));
    db.prepare('INSERT INTO card_history(id,revision,snapshot,changed_at) VALUES(?,?,?,?)')
      .run(row.id, row.revision, JSON.stringify(row), row.recorded_at);
    return row;
  });
}

// 终态不可复活：撤销过的决定不能被改回 active
function transitionOk(kind, from, to) {
  if (from === to) return true;
  if (TERMINAL.has(from) && !TERMINAL.has(to)) return false;
  return (STATES[kind] || STATES.decision).includes(to);
}

function updateCard(db, id, patch, reason) {
  const cur = db.prepare('SELECT * FROM cards WHERE id=?').get(id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  next.revision = cur.revision + 1;
  if (!transitionOk(next.kind, cur.state, next.state)) next.state = cur.state;
  next.text = str(next.text, 2000) || cur.text;
  next.topic = str(next.topic, 120); next.owner = str(next.owner, 80); next.due = str(next.due, 40);
  next.review_note = str(reason || next.review_note, 300);
  next.human_edited = next.human_edited ? 1 : 0; next.needs_review = next.needs_review ? 1 : 0;
  if (Array.isArray(next.source_refs)) next.source_refs = JSON.stringify(next.source_refs.slice(0, 20));
  return inTx(db, () => {
    // 乐观锁：两处同时改同一条时，后到的那次读到的 revision 已经过期，这里会拦下来
    const r = db.prepare(`UPDATE cards SET revision=?,${COLS.map(k => k + '=?').join(',')} WHERE id=? AND revision=?`)
      .run(next.revision, ...COLS.map(k => next[k]), id, cur.revision);
    if (!r.changes) throw new Error('这条记忆刚被别处改过，请重新打开再改');
    // 历史用 INSERT 而不是 REPLACE：同版本号冲突说明并发写，宁可报错也不要把上一次的来历覆盖掉
    db.prepare('INSERT INTO card_history(id,revision,snapshot,changed_at) VALUES(?,?,?,?)')
      .run(id, next.revision, JSON.stringify(next), now());
    return next;
  });
}

function flagPossiblyChanged(db, id, note) {
  const cur = db.prepare('SELECT state,human_edited FROM cards WHERE id=?').get(id);
  if (!cur) return null;
  if (TERMINAL.has(cur.state)) return null;      // 已经作废的别再翻出来
  if (cur.human_edited) return null;             // 用户处理过的，别覆盖他的判断
  return updateCard(db, id, { needs_review: 1 }, note || '可能已变更，等你核对');
}

function dropCard(db, id, note) {
  const cur = db.prepare('SELECT kind FROM cards WHERE id=?').get(id);
  if (!cur) return null;
  return updateCard(db, id, { state: DROP_STATE[cur.kind] || 'revoked', human_edited: 1, needs_review: 0 }, note || '你标为作废');
}

module.exports = { open, closeAll, inTx, putCard, updateCard, dropCard, flagPossiblyChanged,
                   KINDS, STATES, DEFAULT_STATE, DROP_STATE, TERMINAL, uid, now, iso };
