'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '../app/server.js'), 'utf8');

test('asset uploads get a random suffix and the listing does not expose the host directory', () => {
  assert.match(server, /base\+'-'\+crypto\.randomUUID\(\)\.slice\(0,8\)\+ext/);
  assert.doesNotMatch(server, /JSON\.stringify\(\{v:1,dir:assetDir\(id\),items:assetList\(id\)\}\)/);
});

test('multi-image analysis runs in four-image batches and broadcasts failed state', () => {
  assert.match(server, /for\(let offset=0;offset<chosen\.length;offset\+=4\)/);
  assert.match(server, /visualNames:batch\.map\(x=>x\.name\)/);
  assert.match(server, /status:'failed'[\s\S]{0,180}broadcastAssets\(id\)/);
});

test('remembered meeting rules inherit the meeting project and deduplicate inside that project', () => {
  assert.match(server, /const project = String\(\(live && live\.projectId\)/);
  assert.match(server, /scope='project' AND project=\? AND text=\?/);
  assert.match(server, /project, scope:'project', meeting_id:meetingId/);
});
