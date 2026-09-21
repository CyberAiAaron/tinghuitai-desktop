'use strict';
// 本机读类工具。重点不在「能搜到」，在于每条结果都能回溯：
//   ① 每条命中都带 ref / source / at，会议那几条还能点回那一场（url + meetingId）
//   ② 一个坏掉的 JSON 只跳自己，不让整次搜索失败——真机上 pending/ 里随时可能有半截文件
//   ③ 同一场会有整理结果就不再用 pending 那份，免得引用到旧结论
//   ④ 逐字稿不整份往外倒，一次最多 120 段
//   ⑤ 没配的工具在清单里写清缺什么，不是消失
//   ⑥ 找人重名不猜：搜出两个同名的就进 missing，宁可让他自己补
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const reg = require('../app/tools');

const tmp = tag => fs.mkdtempSync(path.join(os.tmpdir(), 'tht-' + tag + '-'));
const write = (f, j) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof j === 'string' ? j : JSON.stringify(j)); };

// 一份整理结果，结构照 .job.enhanced.json 的真实形状
const ENHANCED = {
  id: 'sess-tools-1', topicTitle: 'AI Phone 输入方式与端云切分', start: '2026-09-18T03:08:40.230Z',
  summary: '本次讨论覆盖输入方式改造。\n\n算法尽量放在片上，MCU 优先，不行再退到 SOC。',
  brief: { overview: {
    topics: [{ n: 1, title: '输入改造与软硬结合' }],
    conclusions: ['产品大定位为专门连接 Agent 的手机', '算法尽量放在片上，MCU 优先'],
    todos: [{ what: '确认 ID 设计与硬件形态', owner: 'Aaron Wang', due: '2026-09-30' }],
  } },
  highlights: [{ text: '北美市场对视频采集仍然敏感' }],
  transcript: Array.from({ length: 300 }, (_, i) => ({ t: i * 2, speaker: 'S' + (i % 2), text: '第 ' + i + ' 段：谈到端侧 ASR 的功耗账' })),
};

function dataDirWith() {
  const dir = tmp('local');
  write(path.join(dir, 'state/meeting-pipeline/abc.job.enhanced.json'), ENHANCED);
  // 同一场会的 pending 快照：结论写的是旧口径，整理结果必须压过它
  write(path.join(dir, 'pending/sess-tools-1.json'), { id: 'sess-tools-1', topicTitle: '旧标题', transcript: [{ t: 0, text: '这句是旧快照里的，不该被引用' }] });
  // 另一场只有 pending
  write(path.join(dir, 'pending/sess-tools-2.json'), { id: 'sess-tools-2', topicTitle: '深圳用研复盘', start: '2026-09-10T02:00:00.000Z',
    todos: [{ text: '把三条原假设被证伪的结论写进台账', owner: 'Aaron Wang' }], transcript: [{ t: 1, text: '深圳六场访谈的痛点排序' }] });
  // 半截文件：真机上随时会有
  write(path.join(dir, 'pending/sess-tools-broken.json'), '{"id":"sess-broken","transcr');
  return dir;
}

test('搜会议：命中带 ref / url / meetingId，能回溯到是哪一场哪一段', async () => {
  const dir = dataDirWith();
  const r = await reg.call('meetings.search', { query: '端侧 ASR 功耗' }, { dataDir: dir });
  assert.equal(r.ok, true);
  assert.ok(r.items.length > 0);
  for (const it of r.items) {
    assert.ok(it.ref && it.ref.startsWith('meeting:'), '每条都有 ref');
    assert.equal(it.source, 'local:meeting');
    assert.ok(it.meetingId);
    assert.equal(it.url, '/tinghuitai/archive.html?id=' + encodeURIComponent(it.meetingId));
    assert.ok('at' in it);
  }
  const conc = await reg.call('meetings.search', { query: 'MCU 片上' }, { dataDir: dir });
  assert.ok(conc.items.some(x => x.kind === 'conclusion' && /MCU/.test(x.text)), '结论也在检索范围里');
});

test('搜会议：坏掉的一个文件只跳自己，整次搜索照样成功并如实报数', async () => {
  const dir = dataDirWith();
  const r = await reg.call('meetings.search', { query: '深圳 用研' }, { dataDir: dir });
  assert.equal(r.ok, true);
  assert.equal(r.unreadableFiles, 1, '如实报出有 1 个文件读不了，不假装干净');
  assert.ok(r.items.some(x => x.meetingId === 'sess-tools-2'));
});

test('搜会议：没命中就是空清单，不是报错，也不编一条出来', async () => {
  const dir = dataDirWith();
  const r = await reg.call('meetings.search', { query: '量子计算光刻机' }, { dataDir: dir });
  assert.equal(r.ok, true);
  assert.deepEqual(r.items, []);
  assert.ok(r.scanned >= 2);
  assert.equal((await reg.call('meetings.search', { query: '的' }, { dataDir: dir })).ok, false, '全是停用词时说清楚，不空跑');
});

test('同一场会：整理结果压过 pending 快照，不会引用到旧口径', async () => {
  const dir = dataDirWith();
  const r = await reg.call('meetings.get', { meetingId: 'sess-tools-1' }, { dataDir: dir });
  assert.equal(r.ok, true);
  assert.equal(r.data.title, 'AI Phone 输入方式与端云切分');
  assert.ok(r.data.conclusions.length === 2);
  const old = await reg.call('meetings.search', { query: '旧快照' }, { dataDir: dir });
  assert.deepEqual(old.items, [], '旧快照的原话搜不到了');
});

test('取一场会：各 section 分开给，逐字稿一次最多 120 段', async () => {
  const dir = dataDirWith();
  const head = await reg.call('meetings.get', { meetingId: 'sess-tools-1', section: 'todos' }, { dataDir: dir });
  assert.equal(head.data.todos[0].what, '确认 ID 设计与硬件形态');

  const t = await reg.call('meetings.get', { meetingId: 'sess-tools-1', section: 'transcript', from: 0, to: 300 }, { dataDir: dir });
  assert.equal(t.data.segmentCount, 300);
  assert.equal(t.data.to, 120, '要 300 段也只给 120');
  assert.ok(t.data.segments.length <= 120);
  assert.equal(t.data.segments[0].ref, 'meeting:sess-tools-1#0');

  const mid = await reg.call('meetings.get', { meetingId: 'sess-tools-1', section: 'transcript', from: 200 }, { dataDir: dir });
  assert.equal(mid.data.segments[0].i, 200);

  const miss = await reg.call('meetings.get', { meetingId: 'sess-不存在' }, { dataDir: dir });
  assert.equal(miss.ok, false);
  assert.match(miss.error, /本机没有这场会/);
});

test('搜记忆：库是空的就给空清单，不报错（新机器上就是这样）', async () => {
  const dir = tmp('local-mem');
  const r = await reg.call('memory.search', { query: '决策板 D1' }, { dataDir: dir });
  assert.equal(r.ok, true);
  assert.deepEqual(r.items, []);
});

test('搜项目资料：按通配取到本机文件，命中带路径和最后修改时间；没配就在清单里写清缺什么', async () => {
  const base = tmp('local-ctx');
  write(path.join(base, 'kb_reorg/02_产品需求总纲.md'), '# 总纲\n\n## 决策项 D1\n\nPin 与手机绑定这条还没定，卡住 D2 / D6 / D7。\n');
  write(path.join(base, 'kb_reorg/01_知识库总图.md'), '# 总图\n\n与本题无关的一段。\n');
  const focus = path.join(base, 'focus.md');
  write(focus, '项目状态：CDCP 已延期，新日期未定。\n');

  const env = { PROJECT_CONTEXT_DIR: base, PROJECT_CONTEXT_FILES: ['kb_reorg/*.md'], PROJECT_FOCUS_FILES: [focus] };
  const r = await reg.call('project.context', { query: 'D1 绑定' }, { env, dataDir: base });
  assert.equal(r.ok, true);
  assert.ok(r.items.length >= 1);
  const hit = r.items[0];
  assert.ok(hit.path.endsWith('02_产品需求总纲.md'));
  assert.ok(hit.ref.startsWith('file:' + hit.path + '@'), 'ref 带上修改时间，引用的是当时那一版');
  assert.equal(hit.source, 'local:file');
  assert.ok(hit.at.endsWith('Z'));
  assert.equal(hit.heading, '决策项 D1');

  const f = await reg.call('project.context', { query: 'CDCP 延期' }, { env, dataDir: base });
  assert.ok(f.items.some(x => x.path === path.resolve(focus)));

  const none = reg.list({}, {}).find(x => x.name === 'project.context');
  assert.equal(none.available, false);
  assert.match(none.reason, /PROJECT_CONTEXT_DIR/);
  assert.equal(reg.list(env, { dataDir: base }).find(x => x.name === 'project.context').available, true);
});

test('搜工作台：待办和资料都搜得到，没有本机库也没配上游时清单里写清楚', async () => {
  const dir = tmp('local-hub');
  const before = reg.list({}, { dataDir: dir }).find(x => x.name === 'hub.search');
  assert.equal(before.available, false);
  assert.match(before.reason, /工作台/);

  write(path.join(dir, 'state/work-hub/work-hub.json'), {
    tasks: [{ id: 't1', text: '把 CDCP 汇报骨架搭出来', owner: 'Aaron Wang', status: 'doing', bucket: 'week', updated: '2026-09-20T02:00:00.000Z' }],
    sources: [{ id: 's1', title: 'CDCP 汇报框架 v2', url: 'https://example.invalid/doc', channel: '手动收集', updated: '2026-09-19T02:00:00.000Z' }],
    projects: [{ id: 'p1', title: '26191 概念决策', status: 'active' }],
  });
  assert.equal(reg.list({}, { dataDir: dir }).find(x => x.name === 'hub.search').available, true);

  const r = await reg.call('hub.search', { query: 'CDCP' }, { dataDir: dir });
  assert.equal(r.ok, true);
  assert.ok(r.items.some(x => x.kind === 'task' && x.ref === 'hub:task:t1'));
  assert.ok(r.items.some(x => x.kind === 'source' && x.url === 'https://example.invalid/doc'));
  const only = await reg.call('hub.search', { query: 'CDCP', kind: 'tasks' }, { dataDir: dir });
  assert.ok(only.items.every(x => x.kind === 'task'));
});

test('找人：本机名单 + 飞书通讯录；重名不猜，落进 missing', async () => {
  const dir = tmp('local-people');
  const roster = path.join(dir, 'team.md');
  write(roster, '# 团队\n- Shawn Liu —— 26191 总负责人\n- Cary Luo —— 项目经理\n');
  const seen = [];
  const exec = (bin, args, opts, cb) => {
    seen.push(args);
    cb(null, JSON.stringify({ data: { users: [
      { open_id: 'ou_shawnliu', localized_name: 'Shawn Liu', matched_query: 'Shawn Liu' },
      { open_id: 'ou_calvin1', localized_name: 'Calvin', matched_query: 'Calvin' },
      { open_id: 'ou_calvin2', localized_name: 'Calvin', matched_query: 'Calvin' },
    ] } }), '');
  };
  const r = await reg.call('people.lookup', { names: ['Shawn Liu', 'Calvin'] }, { env: { TEAM_MEMBERS_FILE: roster }, dataDir: dir, execImpl: exec });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.ids, ['ou_shawnliu']);
  assert.deepEqual(r.data.missing, ['Calvin'], '两个 Calvin 就不猜');
  assert.ok(seen[0].includes('--exclude-external-users'), '只搜内部同事');
  assert.ok(seen[0].includes('--as') && seen[0].includes('user'));
  assert.ok(r.items.some(x => x.from === 'roster' && /26191 总负责人/.test(x.text)), '本机名单那行也带回来，给模型判断用');
  assert.ok(r.items.some(x => x.from === 'lark' && x.ref === 'lark:user:ou_shawnliu'));

  const noIds = await reg.call('people.lookup', { names: ['Shawn Liu'], withIds: false }, { env: { TEAM_MEMBERS_FILE: roster }, dataDir: dir, execImpl: exec });
  assert.equal(seen.length, 1, 'withIds=false 时一次飞书都不问');
  assert.equal(noIds.items.length, 1);
});
