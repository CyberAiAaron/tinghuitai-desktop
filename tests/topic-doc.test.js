'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const topicDoc = require('../app/topic-doc');
const realGate = require('../app/send-gate');
const larkTools = require('../app/tools/lark-cli');

const TOPICS = {
  '硬件架构': { doc: 'SecretDocToken12345', owner: 'Abel', keywords: ['Pin', 'ISP'] },
  '高通路标': { doc: null, owner: 'Hannah', keywords: ['SM7750'] },
};

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'topic-doc-')); }
function enhanced(extra = {}) {
  return {
    id: 'meeting-1', title: 'Pin ISP 讨论', start: Date.UTC(2026, 8, 24),
    transcript: [{ seg: 's1', text: 'Pin 的 ISP 功耗还没有结论' }, { seg: 's2', text: '下周补测' }],
    ...extra,
  };
}
function model(items) {
  return { text: JSON.stringify({ sections: topicDoc.SECTIONS.map(section => ({ section, items: items.filter(item => item.section === section) })) }) };
}

test('topic-doc: classify 按配置顺序、大小写不敏感，无命中和空输入返回 null', () => {
  const api = topicDoc.create({ dataDir: tempDir(), topics: TOPICS, ask: async () => model([]) });
  assert.strictEqual(api.classify(enhanced()), '硬件架构');
  assert.strictEqual(api.classify({ transcript: [{ text: 'sm7750 roadmap' }] }), '高通路标');
  assert.strictEqual(api.classify({ transcript: [{ text: '完全无关' }] }), null);
  assert.strictEqual(api.classify(null), null);
});

test('topic-doc: computeDiff 生成固定四节、pending、稳定 id 和合法证据并原子落盘', async () => {
  const dataDir = tempDir();
  let request = null;
  const api = topicDoc.create({ dataDir, topics: TOPICS, ask: async input => {
    request = input;
    return model([
      { section: '未决问题', text: 'ISP 功耗目标还没有结论', evidence: ['s1'] },
      { section: '下一步最重要的事', text: '下周补测 ISP 功耗', evidence: ['s2'] },
    ]);
  } });
  const result = await api.computeDiff(enhanced(), '# 当前主题文档');
  assert.strictEqual(result.status, 'pending');
  assert.deepStrictEqual(result.sections.map(group => group.section), topicDoc.SECTIONS);
  const items = result.sections.flatMap(group => group.items);
  assert.strictEqual(items.length, 2);
  assert.ok(items.every(item => item.status === 'pending' && /^td-[0-9a-f]{16}$/.test(item.id)));
  assert.deepStrictEqual(items[0].evidence, ['s1']);
  assert.strictEqual(request.kind, 'post');
  assert.strictEqual(request.json, true);
  assert.strictEqual(request.tools, false);
  const file = path.join(dataDir, 'state', 'topic-diff', 'meeting-1.json');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), result);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['meeting-1.json']);
});

test('topic-doc: 60 Unicode code point 允许，61 字拒绝且不落盘；坏 evidence 也拒绝', async () => {
  const sixty = '字'.repeat(60), sixtyOne = '字'.repeat(61);
  const okDir = tempDir();
  const ok = topicDoc.create({ dataDir: okDir, topics: TOPICS, ask: async () => model([{ section: '讨论中', text: sixty, evidence: ['s1'] }]) });
  const result = await ok.computeDiff(enhanced());
  assert.strictEqual([...result.sections[1].items[0].text].length, 60);

  const longDir = tempDir();
  const tooLong = topicDoc.create({ dataDir: longDir, topics: TOPICS, ask: async () => model([{ section: '讨论中', text: sixtyOne, evidence: ['s1'] }]) });
  await assert.rejects(tooLong.computeDiff(enhanced()), /超过 60 字/);
  assert.ok(!fs.existsSync(path.join(longDir, 'state', 'topic-diff', 'meeting-1.json')));

  const badEvidence = topicDoc.create({ dataDir: tempDir(), topics: TOPICS, ask: async () => model([{ section: '讨论中', text: '有内容', evidence: ['missing'] }]) });
  await assert.rejects(badEvidence.computeDiff(enhanced()), /不存在的证据段/);

  const missingSection = topicDoc.create({ dataDir: tempDir(), topics: TOPICS, ask: async () => ({ text: JSON.stringify({ sections: [{ section: '未决问题', items: [] }] }) }) });
  await assert.rejects(missingSection.computeDiff(enhanced()), /完整包含四个章节/);
});

test('topic-doc: apply 同一条两次只 parse/update 各一次，日志不含 token', async () => {
  const dataDir = tempDir(), calls = [], logs = [];
  const api = topicDoc.create({
    dataDir, topics: TOPICS, sendGate: realGate, log: line => logs.push(line),
    ask: async () => model([{ section: '最新进展', text: 'ISP 样片已经到位', evidence: ['s1'] }]),
    lark: larkTools,
    larkOptions: { execImpl: (bin, args, options, callback) => {
      calls.push(args);
      const data = args.includes('+script') ? { assessment: { status: 'passed' } } : { document: { revision_id: '7' } };
      callback(null, JSON.stringify({ ok: true, data }), '');
    } },
  });
  const diff = await api.computeDiff(enhanced());
  const id = diff.sections[2].items[0].id;
  const first = await api.apply('meeting-1', [id]);
  const second = await api.apply('meeting-1', [id]);
  assert.strictEqual(first.applied[0].alreadySent, false);
  assert.strictEqual(second.applied[0].alreadySent, true);
  assert.strictEqual(calls.filter(args => args.includes('+script')).length, 1);
  assert.strictEqual(calls.filter(args => args.includes('+update')).length, 1);
  assert.ok(!calls.find(args => args.includes('+script')).includes('--doc-format'));
  assert.ok(!logs.join('\n').includes('SecretDocToken12345'));
  assert.ok(!JSON.stringify(first).includes('SecretDocToken12345'));
});

test('topic-doc: doc=null 在 gate 和 lark 前返回 skipped', async () => {
  const dataDir = tempDir();
  let larkCalls = 0, gateCalls = 0;
  const api = topicDoc.create({
    dataDir, topics: TOPICS,
    ask: async () => model([{ section: '未决问题', text: '芯片路标待确认', evidence: ['s1'] }]),
    lark: { docValidateAppend: async () => { larkCalls++; return { ok: true }; } },
    sendGate: { send: async () => { gateCalls++; return { status: 'sent' }; } },
  });
  const diff = await api.computeDiff(enhanced({ title: 'SM7750 路标', transcript: [{ seg: 's1', text: 'SM7750 路标待确认' }] }));
  assert.strictEqual(diff.topic, '高通路标');
  const id = diff.sections[0].items[0].id;
  const result = await api.apply('meeting-1', [id]);
  assert.strictEqual(result.skipped, 'no_document');
  assert.strictEqual(larkCalls, 0);
  assert.strictEqual(gateCalls, 0);
});

test('topic-doc: routes 注册 GET/POST 并校验请求', async () => {
  const dataDir = tempDir();
  const api = topicDoc.create({ dataDir, topics: TOPICS, ask: async () => model([]) });
  await api.computeDiff(enhanced());
  const handlers = {};
  api.routes({ get: (route, fn) => { handlers['GET ' + route] = fn; }, post: (route, fn) => { handlers['POST ' + route] = fn; } });
  assert.ok(handlers['GET /asr-relay/topic-diff']);
  assert.ok(handlers['POST /asr-relay/topic-diff/apply']);
  const reply = { code: 0, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return body; } };
  await handlers['GET /asr-relay/topic-diff']({ query: { id: 'meeting-1' } }, reply);
  assert.strictEqual(reply.code, 200);
  assert.strictEqual(reply.body.diff.meetingId, 'meeting-1');
  await handlers['POST /asr-relay/topic-diff/apply']({ body: { id: 'meeting-1', ids: [], confirmed: true } }, reply);
  assert.strictEqual(reply.code, 400);
  assert.match(reply.body.error, /没有选择/);
});
