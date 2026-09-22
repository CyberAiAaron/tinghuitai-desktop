'use strict';
// 会中飞书提醒白名单（app/push-whitelist.js，THT-R4「分析可以密，推送必须稀」）。
// 三条能推：点名本人、冲突类洞察、本人带截止的承诺；普通要点不推；开关关零推送但分诊照产；节流 + 同内容不重复。
const test = require('node:test'), assert = require('node:assert/strict');
const pw = require('../app/push-whitelist');
const env = { MEETING_PUSH: 'on', MEETING_PUSH_SELF_NAMES: 'Aaron Wang, Aaron', MEETING_PUSH_MIN_GAP_MS: '120000' };
const batch = {
  highlights: [{ text: '屏幕尺寸倾向 5.5 寸阔屏直板' }, { text: 'Aaron 你来拍一下 D3 的对外文案？' }, { text: '⚠️ 冲突：会上说 CDCP 09-22，决策板记延期未定' }],
  todos: [{ text: '09-25 前把 BOM 表发给 Cary', owner: 'Aaron' }, { text: '把 demo 录屏要过来', owner: 'Hannah Yin' }, { text: '下周三前定 D1 前提', owner: '本人' }],
  factchecks: [{ type: 'conflict', claim: '会上说 CDCP 09-22；决策板 D1（2026-09-21）记延期未定', source: '决策板 D1' }, { type: 'answer', claim: 'D5 口径以 Cary 成本模型为准' }, { type: 'recheck', claim: '这件事 09-12《硬件例会》已承诺过，记录里没看到落地' }],
};

test('pick：点名本人 / 冲突类 / 本人带截止承诺入选，普通要点、别人的待办、answer / recheck 洞察不入选', () => {
  const got = pw.pick(batch, env);
  assert.deepEqual(got.map(x => x.reason).sort(), ['conflict', 'conflict', 'mention', 'self-due', 'self-due']);
  const texts = got.map(x => x.text).join('\n');
  assert.ok(texts.includes('Aaron 你来拍一下') && texts.includes('BOM 表发给 Cary') && texts.includes('下周三前定 D1 前提') && texts.includes('会上说 CDCP 09-22'));
  assert.ok(!texts.includes('5.5 寸阔屏') && !texts.includes('demo 录屏') && !texts.includes('Cary 成本模型为准') && !texts.includes('已承诺过'));
});

test('点名要配「提问 / 交办」语气：只是提到名字不推；owner 是本人但没截止也不推', () => {
  assert.deepEqual(pw.pick({ highlights: [{ text: 'Aaron 上周去了 SF 做用研' }], todos: [{ text: '整理用研纪要', owner: 'Aaron' }] }, env), []);
  assert.equal(pw.pick({ todos: [{ text: '整理用研纪要，周五前', owner: 'Aaron Wang' }] }, env).length, 1);
  assert.equal(pw.pick({ highlights: [{ text: '请 Aaron 确认一下 D7 的 owner' }] }, env)[0].reason, 'mention');
});

test('开关关（默认）：候选照样数出来（分诊没少），推送为零', () => {
  const g = new pw.Gate({ ...env, MEETING_PUSH: 'off' });
  assert.deepEqual(g.consider(batch, 1000), []);
  assert.equal(g.stats().considered, 5); assert.equal(g.stats().pushed, 0); assert.equal(g.stats().lastSkip, 'off');
  assert.deepEqual(new pw.Gate({}).consider(batch, 1000), [], '没配 MEETING_PUSH 等于 off');
});

test('开关开：第一轮推出 5 条；同内容再来不重复；节流期内新内容压住；过了间隔新内容再推', () => {
  const g = new pw.Gate(env);
  assert.equal(g.consider(batch, 1000).length, 5);
  assert.deepEqual(g.consider(batch, 2000), [], '同一批再来一遍不再推'); assert.equal(g.stats().lastSkip, 'dup');
  const more = { highlights: [{ text: 'Aaron 能不能今天定 D6？' }] };
  assert.deepEqual(g.consider(more, 60000), [], '120 秒内新内容压住'); assert.equal(g.stats().lastSkip, 'throttle');
  assert.deepEqual(g.consider(more, 200000), [], '节流期压住的内容已记成 seen，不补推');
  assert.equal(g.consider({ highlights: [{ text: 'Aaron 你定一下 D8 的量级' }] }, 200001).length, 1, '过了间隔、新内容 → 推');
  assert.equal(g.stats().pushed, 6);
});

test('formatMessage：一条一行带原因标签，最多 3 行', () => {
  const m = pw.formatMessage('硬件周会', pw.pick(batch, env));
  assert.match(m, /^【听会台 · 会中提醒】硬件周会\n- 【(点名|冲突|本人截止)】/);
  assert.equal(m.split('\n').length, 4);
});

test('server.js 接线：分诊结果先过 pushGate 再 larkPush，larkPush 没收件人只记日志，默认配置 MEETING_PUSH=off', () => {
  const fs = require('fs'), path = require('path');
  const s = fs.readFileSync(path.join(__dirname, '..', 'app', 'server.js'), 'utf8');
  assert.ok(s.includes("this.pushGate = new pushWhitelist.Gate(env"), '会话里没建 pushGate');
  assert.ok(/this\.pushGate\.consider\(fb\)[\s\S]{0,80}this\.larkPush\(hit\)/.test(s), '分诊末尾没过白名单就推');
  assert.ok(s.includes("push skipped（没配 MEETING_PUSH_TO / THT_ARCHIVE_OWNER_ID）"), '没收件人要写 skipped，不许假装发了');
  assert.ok(!/log\(`push \$\{/.test(s), '不许再出现「push N」这种没发也记发了的日志');
  assert.equal(require('../app/config').defaults ? require('../app/config').defaults.MEETING_PUSH : 'off', 'off');
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'app', 'config.js'), 'utf8').includes("MEETING_PUSH:'off'"), '默认必须安静');
});
