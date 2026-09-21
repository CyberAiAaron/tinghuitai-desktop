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
