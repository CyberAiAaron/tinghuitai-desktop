'use strict';
// N-02 合并规则。09-20 那次生产合并条数全对，却把桌面版 15 份资料的逐字稿换成了空值——
// 这里的每一条都对着那次事故写：有值不被空值盖、桌面版内容不变短、丢了就拒写。
const test = require('node:test'), assert = require('node:assert');
const { mergeHubs, findLosses } = require('../scripts/merge-work-hub.js');
const hub = (over = {}) => ({ revision: 1, tasks: [], workItems: [], projects: [], events: [], sources: [], knowledgeNodes: [], ...over });

test('a populated desktop field is never replaced by an empty old-hub field', () => {
  const old = hub({ sources: [{ id: 's1', updated: '2026-09-20T10:00:00Z', title: '周会', transcript: '', body: '原始转写堆'.repeat(50), url: '' }] });
  const desk = hub({ sources: [{ id: 's1', updated: '2026-09-19T10:00:00Z', title: '周会', transcript: '逐字稿'.repeat(100), body: '结构化纪要', url: 'https://x/1', archiveVerified: true }] });
  const { merged } = mergeHubs(old, desk); const s = merged.sources[0];
  assert.equal(s.transcript, desk.sources[0].transcript);
  assert.equal(s.body, '结构化纪要');                       // 内容字段桌面版有值就留桌面版的，哪怕旧库那份更长
  assert.equal(s.url, 'https://x/1'); assert.equal(s.archiveVerified, true);
  assert.deepEqual(findLosses(old, desk, merged), []);
});
test('old-hub fields fill what the desktop copy lacks, and old-only records come across', () => {
  const old = hub({ tasks: [{ id: 't1', updated: '2026-09-20T10:00:00Z', text: '做A', status: 'open', projectId: 'p1' }, { id: 't2', text: '只在旧库' }], projects: [{ id: 'p1', title: '项目' }] });
  const desk = hub({ tasks: [{ id: 't1', updated: '2026-09-20T09:00:00Z', text: '做A', status: 'open', projectId: '', due: '2026-09-30' }, { id: 't3', text: '只在桌面' }] });
  const { merged } = mergeHubs(old, desk); const t1 = merged.tasks.find(t => t.id === 't1');
  assert.equal(t1.projectId, 'p1'); assert.equal(t1.due, '2026-09-30');
  assert.deepEqual(merged.tasks.map(t => t.id).sort(), ['t1', 't2', 't3']); assert.equal(merged.projects.length, 1);
  assert.deepEqual(findLosses(old, desk, merged), []);
});
test('when both sides changed a task, the newer record wins and the change is reported', () => {
  const old = hub({ tasks: [{ id: 't1', updated: '2026-09-21T10:00:00Z', text: 'x', status: 'done' }] });
  const desk = hub({ tasks: [{ id: 't1', updated: '2026-09-20T10:00:00Z', text: 'x', status: 'open' }] });
  const { merged, parts } = mergeHubs(old, desk);
  assert.equal(merged.tasks[0].status, 'done'); assert.equal(parts.tasks.stats.newerWins.length, 1);
  const back = mergeHubs(hub({ tasks: [{ ...old.tasks[0], updated: '2026-09-19T10:00:00Z' }] }), desk);
  assert.equal(back.merged.tasks[0].status, 'open');
});
test('runtime state stays with the desktop hub; merging twice changes nothing more', () => {
  const old = hub({ sync: { index: 9 }, version: 1, sources: [{ id: 's1', title: 'a', body: 'old' }] });
  const desk = hub({ sync: { index: 2 }, version: 3, knowledgeVersion: 5, sources: [{ id: 's1', title: 'a', body: 'desk body', transcript: 'tt' }] });
  const first = mergeHubs(old, desk).merged;
  assert.deepEqual(first.sync, { index: 2 }); assert.equal(first.version, 3); assert.equal(first.knowledgeVersion, 5);
  const second = mergeHubs(old, first).merged;
  assert.deepEqual(second.sources, first.sources);
});
test('the loss gate catches emptied fields, shortened desktop content and dropped records', () => {
  const old = hub({ sources: [{ id: 's1', url: 'u' }] }), desk = hub({ sources: [{ id: 's1', transcript: 'long text' }, { id: 's2', title: 'x' }] });
  const bad = hub({ sources: [{ id: 's1', url: '', transcript: 'long' }] });
  const losses = findLosses(old, desk, bad);
  assert.equal(losses.length, 3);
  assert.ok(losses.some(l => l.includes('url 变空'))); assert.ok(losses.some(l => l.includes('transcript 变短'))); assert.ok(losses.some(l => l.includes('丢记录')));
});

// —— D10：服务在跑的时候不许 --write ——
// 服务内存里揣着合并前那份数据，几分钟后一次 save() 就把合并结果整份盖回去，而且不报错。
// 另外 Hub.save() 的临时文件也叫 work-hub.json.tmp，和这个脚本原来用的名字撞了。
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, spawnSync } = require('child_process');
const { livingServer, pidFilesFor, tmpFor } = require('../scripts/merge-work-hub.js');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'merge-work-hub.js');

// 摆一份「数据目录/state/work-hub.json」，pid 文件按 launch.js 的位置放在数据目录下
function stage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-merge-'));
  const state = path.join(dir, 'state'); fs.mkdirSync(state);
  const target = path.join(state, 'work-hub.json'), source = path.join(dir, 'old.json');
  fs.writeFileSync(target, JSON.stringify(hub({ sources: [{ id: 's1', title: '桌面版有的' }] })));
  fs.writeFileSync(source, JSON.stringify(hub({ sources: [{ id: 's2', title: '旧库独有的' }] })));
  return { dir, target, source, pidFile: path.join(dir, 'server.pid'),
    clean: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} } };
}
const run = (s, ...args) => spawnSync(process.execPath, [SCRIPT, s.source, s.target, ...args], { encoding: 'utf8' });

test('pid 文件找的是数据目录和 state 两处，和 launch.js 写的位置对得上', () => {
  const files = pidFilesFor('/x/y/state/work-hub.json');
  assert.deepEqual(files, ['/x/y/state/server.pid', '/x/y/server.pid']);
});

test('临时文件带自己的 pid，不和 Hub.save() 的 work-hub.json.tmp 撞名', () => {
  const t = tmpFor('/x/y/work-hub.json');
  assert.ok(t.includes(String(process.pid)), t);
  assert.notEqual(t, '/x/y/work-hub.json.tmp');
});

test('pid 文件是上一次留下的死号、或被别的程序占了，都不算服务还活着', () => {
  const s = stage();
  try {
    fs.writeFileSync(s.pidFile, '4242');
    assert.equal(livingServer(s.target, { isAlive: () => false, command: () => '' }), null, '进程早没了');
    assert.equal(livingServer(s.target, { isAlive: () => true, command: () => '/usr/bin/vim 笔记.md' }), null, 'pid 被别人复用');
    const live = livingServer(s.target, { isAlive: () => true, command: () => '/usr/bin/node /somewhere/app/server.js' });
    assert.equal(live && live.pid, 4242);
  } finally { s.clean(); }
});

test('服务还活着：--write 被拒、目标库一个字没改；停了之后同一条命令就能写', () => {
  const s = stage();
  // 一个真的在跑、命令行里带 server.js 的进程（只是个睡着的脚本，不是真服务）
  const fake = path.join(s.dir, 'app'); fs.mkdirSync(fake);
  fs.writeFileSync(path.join(fake, 'server.js'), 'setTimeout(()=>{},30000);\n');
  const child = spawn(process.execPath, [path.join(fake, 'server.js')], { stdio: 'ignore' });
  try {
    fs.writeFileSync(s.pidFile, String(child.pid));
    const before = fs.readFileSync(s.target, 'utf8');

    const dry = run(s);                                  // 试跑不受影响
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /这是试跑/);
    assert.equal(fs.readFileSync(s.target, 'utf8'), before);

    const blocked = run(s, '--write');
    assert.equal(blocked.status, 3, '服务在跑就该拒绝：' + blocked.stderr);
    assert.match(blocked.stderr, /服务还在跑/);
    assert.equal(fs.readFileSync(s.target, 'utf8'), before, '被拒时一个字节都不许改');

    child.kill('SIGKILL');
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) { try { process.kill(child.pid, 0); } catch (e) { break; } }
    const ok = run(s, '--write');
    assert.equal(ok.status, 0, ok.stderr);
    const after = JSON.parse(fs.readFileSync(s.target, 'utf8'));
    assert.deepEqual(after.sources.map(x => x.id).sort(), ['s1', 's2'], '停了之后正常合并');
    assert.deepEqual(fs.readdirSync(path.dirname(s.target)).filter(n => n.endsWith('.tmp')), [], '临时文件要收干净');
  } finally { try { child.kill('SIGKILL'); } catch (e) {} s.clean(); }
});
