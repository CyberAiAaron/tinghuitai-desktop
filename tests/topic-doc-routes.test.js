'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const topicDoc = require('../app/topic-doc');
const topicDocRoutes = require('../app/topic-doc-routes');

const sections = topicDoc.SECTIONS;
const topics = { '硬件架构': { keywords: ['sm7750'], owner: 'Abel', doc: null } };
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'topic-doc-routes-'));
const enhanced = (extra = {}) => ({ id: 'meeting-route-1', title: 'SM7750 评审', transcript: [{ seg: 'seg-1', text: '路标仍待确认' }], ...extra });
const response = items => ({ text: JSON.stringify({ sections: sections.map(section => ({ section, items: items.filter(item => item.section === section) })) }) });
const fakeReply = () => ({ code: 0, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return body; } });
function handlersFor(service) {
  const handlers = {};
  topicDocRoutes.create(service).mount({ get(route, handler) { handlers['GET ' + route] = handler; }, post(route, handler) { handlers['POST ' + route] = handler; } });
  return handlers;
}

test('topic-doc routes: classify 命中与未命中都返回明确 matched', async () => {
  let calls = 0;
  const service = topicDoc.create({ dataDir: tempDir(), topics, ask: async () => { calls++; return response([]); } });
  const handlers = handlersFor(service);
  let res = fakeReply();
  await handlers['POST /asr-relay/topic-diff/compute']({ body: { enhanced: enhanced() } }, res);
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.matched, true);
  assert.ok(res.body.diff.sections.every(group => group.items.length === 0));
  res = fakeReply();
  await handlers['POST /asr-relay/topic-diff/compute']({ body: { enhanced: enhanced({ id: 'meeting-route-2', title: '无关周会', transcript: [] }) } }, res);
  assert.deepStrictEqual(res.body, { ok: true, matched: false, diff: null });
  assert.strictEqual(calls, 1);
});

test('topic-doc routes: 非空 diff 可读取', async () => {
  const service = topicDoc.create({ dataDir: tempDir(), topics, ask: async () => response([{ section: '未决问题', text: '芯片路标待确认', evidence: ['seg-1'] }]) });
  const handlers = handlersFor(service);
  let res = fakeReply();
  await handlers['POST /asr-relay/topic-diff/compute']({ body: { enhanced: enhanced() } }, res);
  assert.strictEqual(res.body.diff.sections[0].items.length, 1);
  res = fakeReply();
  await handlers['GET /asr-relay/topic-diff']({ query: { id: 'meeting-route-1' } }, res);
  assert.strictEqual(res.body.diff.meetingId, 'meeting-route-1');
});

test('topic-doc routes: 60 字硬校验透传 502 且不落盘', async () => {
  const dataDir = tempDir();
  const service = topicDoc.create({ dataDir, topics, ask: async () => response([{ section: '未决问题', text: '甲'.repeat(61), evidence: ['seg-1'] }]) });
  const res = fakeReply();
  await handlersFor(service)['POST /asr-relay/topic-diff/compute']({ body: { enhanced: enhanced() } }, res);
  assert.strictEqual(res.code, 502);
  assert.match(res.body.error, /超过 60 字/);
  assert.strictEqual(fs.existsSync(path.join(dataDir, 'state/topic-diff/meeting-route-1.json')), false);
});

test('topic-doc routes: doc=null apply 零 gate、零 lark 副作用', async () => {
  let gateCalls = 0, larkCalls = 0;
  const service = topicDoc.create({ dataDir: tempDir(), topics, ask: async () => response([{ section: '最新进展', text: '已收到芯片样片', evidence: ['seg-1'] }]), sendGate: { send: async () => { gateCalls++; } }, lark: { docValidateAppend: async () => { larkCalls++; } } });
  const handlers = handlersFor(service);
  let res = fakeReply();
  await handlers['POST /asr-relay/topic-diff/compute']({ body: { enhanced: enhanced() } }, res);
  const id = res.body.diff.sections.flatMap(group => group.items)[0].id;
  res = fakeReply();
  await handlers['POST /asr-relay/topic-diff/apply']({ body: { id: 'meeting-route-1', ids: [id], confirmed: true } }, res);
  assert.strictEqual(res.body.skipped, 'no_document');
  assert.strictEqual(gateCalls, 0);
  assert.strictEqual(larkCalls, 0);
});


test('topic-doc routes: 未明确确认时拒绝 apply，零外部副作用', async () => {
  let larkCalls = 0;
  const service = topicDoc.create({ dataDir: tempDir(), topics: { '硬件架构': { keywords: ['sm7750'], owner: 'Abel', doc: 'doc-token' } }, ask: async () => response([{ section: '最新进展', text: '已收到芯片样片', evidence: ['seg-1'] }]), lark: { docValidateAppend: async () => { larkCalls++; return { ok: true }; } } });
  const handlers = handlersFor(service);
  let res = fakeReply();
  await handlers['POST /asr-relay/topic-diff/compute']({ body: { enhanced: enhanced() } }, res);
  const id = res.body.diff.sections.flatMap(group => group.items)[0].id;
  res = fakeReply();
  await handlers['POST /asr-relay/topic-diff/apply']({ body: { id: 'meeting-route-1', ids: [id] } }, res);
  assert.strictEqual(res.code, 400);
  assert.match(res.body.error, /点接受/);
  assert.strictEqual(larkCalls, 0);
});
