'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const visual = require('../app/visual-events');
const contextPack = require('../app/context-pack');

test('照片事件元数据会持久化、更新，并随文件一起删除', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-visual-'));
  const meetingId = 'meeting-29', d = visual.dir(dataDir, meetingId);
  fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'photo.jpg'), Buffer.from([1, 2, 3]));
  const made = visual.create(dataDir, meetingId, { name: 'photo.jpg', source: 'photo', capturedAt: '2026-09-27T01:02:03Z', mime: 'image/jpeg', size: 3 });
  let item = visual.list(dataDir, meetingId)[0];
  assert.equal(item.meetingId, meetingId); assert.equal(item.source, 'photo'); assert.equal(item.status, 'uploaded');
  visual.update(dataDir, meetingId, made.id, { status: 'failed', provider: 'Vision A', error: 'timeout' });
  item = visual.list(dataDir, meetingId)[0];
  assert.equal(item.provider, 'Vision A'); assert.equal(item.error, 'timeout'); assert.equal(item.status, 'failed');
  visual.remove(dataDir, meetingId, made.id);
  assert.deepEqual(visual.list(dataDir, meetingId), []); assert.equal(fs.existsSync(path.join(d, 'photo.jpg')), false);
});

test('visual context pack only exposes current meeting images and event metadata', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-context-')), id = 'm1', d = visual.dir(dataDir, id);
  fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'frame.png'), Buffer.from([1]));
  visual.create(dataDir, id, { name: 'frame.png', source: 'representative-frame', mime: 'image/png' });
  const pack = contextPack.build({}, { purpose: 'visual', dataDir, meetingId: id });
  assert.match(pack.text, /representative-frame/); assert.match(pack.text, /frame\.png/);
  assert.equal(pack.images.length, 1); assert.equal(pack.images[0].path, path.join(d, 'frame.png'));
  assert.equal(pack.parts[0].key, 'visual-events');
});
