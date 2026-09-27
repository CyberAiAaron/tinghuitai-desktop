'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const api = require('../app/context-sources-http');

function request(method, body) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  return req;
}

function response() {
  let status = 0, headers = {}, text = '';
  return {
    writeHead(code, next) { status = code; headers = next || {}; },
    end(chunk = '') { text += String(chunk); },
    result() { return { status, headers, text, json: JSON.parse(text) }; },
  };
}

async function call(dataDir, { method = 'GET', body, authed = true } = {}) {
  const req = request(method, body), res = response();
  const handled = await api.route(req, res, new URL('http://localhost/asr-relay/context-sources'), { authed, dataDir });
  assert.equal(handled, true);
  return res.result();
}

test('context sources API requires authentication without leaking local paths', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-context-api-')); t.after(() => fs.rmSync(dataDir, { recursive:true, force:true }));
  const secretPath = path.join(dataDir, 'private', 'secret.md');
  const result = await call(dataDir, { authed:false });
  assert.equal(result.status, 401);
  assert.deepEqual(result.json, { ok:false, error:'请连接 Mac' });
  assert.equal(result.text.includes(secretPath), false);
  assert.equal(result.text.includes(dataDir), false);
});

test('context sources API creates, reads, toggles and deletes a local file source', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-context-api-')); t.after(() => fs.rmSync(dataDir, { recursive:true, force:true }));
  const sourcePath = path.join(dataDir, 'brief.md'); fs.writeFileSync(sourcePath, '# brief\n');

  let result = await call(dataDir, { method:'POST', body:{ action:'upsert', source:{ title:'Brief', type:'file', path:sourcePath, scope:'project', projectId:'Chansey' } } });
  assert.equal(result.status, 200); assert.equal(result.json.ok, true); assert.equal(result.json.sources.length, 1);
  const source = result.json.sources[0];
  assert.match(source.id, /^brief-/); assert.equal(source.projectId, 'Chansey'); assert.equal(source.status.state, 'ready'); assert.equal(source.status.available, true); assert.ok(source.status.version);

  result = await call(dataDir);
  assert.equal(result.status, 200); assert.equal(result.json.version, 1); assert.equal(result.json.sources[0].path, sourcePath);

  result = await call(dataDir, { method:'POST', body:{ action:'toggle', id:source.id, enabled:false } });
  assert.equal(result.status, 200); assert.equal(result.json.sources[0].enabled, false);

  result = await call(dataDir, { method:'POST', body:{ action:'delete', id:source.id } });
  assert.equal(result.status, 200); assert.deepEqual(result.json.sources, []);
});

test('context sources API returns stable errors instead of filesystem exception paths', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-context-api-')); t.after(() => fs.rmSync(dataDir, { recursive:true, force:true }));
  const stateDir = path.join(dataDir, 'state'); fs.mkdirSync(stateDir, { recursive:true });
  fs.writeFileSync(path.join(stateDir, 'context-sources.json'), '{bad json');
  const result = await call(dataDir);
  assert.equal(result.status, 500);
  assert.equal(result.json.error, '本机来源暂时读不了');
  assert.equal(result.text.includes(dataDir), false);
});
