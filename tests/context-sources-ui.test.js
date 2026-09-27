'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('settings UI exposes project, CRUD, selection and source status controls', () => {
  const html = read('web/index.template.html');
  for (const id of ['s-project','s-context-path','s-context-title','s-context-type','s-context-scope','s-context-add','s-context-overview','s-context-sources']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} should be present`);
  }
  const ui = read('web/src/04a-context-sources.js');
  assert.match(ui, /action:'upsert'/); assert.match(ui, /action:'toggle'/); assert.match(ui, /action:'delete'/);
  assert.match(ui, /context-source-select/); assert.match(ui, /status\.modifiedAt/); assert.match(ui, /tht-project-id/); assert.match(ui, /tht-context-source-ids/);
});

test('both websocket start messages carry project and selected source IDs', () => {
  const primary = read('web/src/16-volc-asr.js');
  const refresh = read('web/src/19-one-line-fix.js');
  assert.match(primary, /type:'start'[\s\S]*\.\.\.meetingContextPayload\(cur\)/);
  assert.match(refresh, /type:'start'[\s\S]*\.\.\.meetingContextPayload\(cur\)/);
  const state = read('web/src/08-status.js');
  assert.match(state, /projectId:contextProjectId/);
  assert.match(state, /contextSourceIds:\[\.\.\.contextSourceIds\]/);
});

test('server wires authenticated context source route and refreshes resumed session context', () => {
  const server = read('app/server.js');
  assert.match(server, /contextSourcesHttp\.route\(req,res,u,\{authed,dataDir:DATA,log\}\)/);
  assert.match(server, /msg\.projectId !== undefined/);
  assert.match(server, /Array\.isArray\(msg\.contextSourceIds\)/);
});
