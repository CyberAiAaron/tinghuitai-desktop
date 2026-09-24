'use strict';
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const L = require('../app/live-insight');
test('开场 5 分钟不出卡', () => {
  assert.strictEqual(L.inWarmup(1000, 1000 + 299999), true);
  assert.strictEqual(L.inWarmup(1000, 1000 + 300000), false);
  assert.strictEqual(L.inWarmup(0, 5), false);
});
test('server.js runTriage 先查热身再查冷却', () => {
  const s = fs.readFileSync(path.join(__dirname, '../app/server.js'), 'utf8');
  const w = s.indexOf('liveInsight.inWarmup(this.cardClockStart)'), c = s.indexOf('liveInsight.inCooldown(this.lastCardAt)');
  assert.ok(w > 0 && c > w);
  assert.ok(s.includes('this.cardClockStart = Date.now()'));
});
