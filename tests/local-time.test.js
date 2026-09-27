'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

function runIn(tz, source) {
  const r = spawnSync(process.execPath, ['-e', source], {
    cwd: root,
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('用户日期跟随设备时区，同一时刻可属于不同日期', () => {
  const code = "const t=require('./app/local-time');process.stdout.write(JSON.stringify(t.localDay('2026-09-22T01:00:00Z')))";
  assert.equal(runIn('Asia/Shanghai', code), '2026-09-22');
  assert.equal(runIn('America/Los_Angeles', code), '2026-09-21');
  assert.equal(runIn('Europe/London', code), '2026-09-22');
});

test('明天/后天按日历日推进，跨 DST 不假定 24 小时', () => {
  const code = [
    "const t=require('./app/local-time')",
    "const say=require('./app/todo-say')",
    "const at=new Date(2026,2,7,12,0,0)",
    "const next=t.addCalendarDays(at,1)",
    "process.stdout.write(JSON.stringify({tomorrow:say.parseDue('明天',at),after:say.parseDue('后天',at),hours:(next-at)/3600000,range:t.localDayRange(next).end-t.localDayRange(next).start}))",
  ].join(';');
  const la = runIn('America/Los_Angeles', code);
  assert.equal(la.tomorrow, '2026-03-08');
  assert.equal(la.after, '2026-03-09');
  assert.equal(la.hours, 23);
  assert.equal(la.range, 23 * 3600000 - 1);
});

test('周几解析在上海、洛杉矶、伦敦都以各自设备日历为准', () => {
  const code = "const s=require('./app/todo-say');const at=new Date(2026,8,22,10);process.stdout.write(JSON.stringify([s.parseDue('周五',at),s.parseDue('下周一',at)]))";
  for (const tz of ['Asia/Shanghai', 'America/Los_Angeles', 'Europe/London']) {
    assert.deepEqual(runIn(tz, code), ['2026-09-25', '2026-09-28']);
  }
});

test('任务草稿、卡片线程和记忆写回不再强制上海或 UTC 日期', () => {
  const actions = fs.readFileSync(path.join(root, 'app/actions.js'), 'utf8');
  const thread = fs.readFileSync(path.join(root, 'app/card-thread.js'), 'utf8');
  const diff = fs.readFileSync(path.join(root, 'app/memory-diff.js'), 'utf8');
  assert.match(actions, /localTime\.localDayPlus\(n, from\)/);
  assert.doesNotMatch(thread, /Asia\/Shanghai/);
  assert.match(thread, /localTime\.localDay\(t\)/);
  assert.match(diff, /const today = localTime\.localDay\(\)/);
});
