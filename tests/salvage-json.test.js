'use strict';
// 分诊结果的 JSON 抢救：模型在字符串值里写了未转义的英文引号（09-22 真实模型正例）时，整轮结果不能丢。
// server.js 一 require 就起服务，所以把这两个纯函数按源码抠出来测。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'server.js'), 'utf8');
const m = src.match(/function repairJsonQuotes[\s\S]*?\nfunction salvageJson[^\n]*\n/);
assert.ok(m, 'server.js 里找不到 repairJsonQuotes + salvageJson');
const { salvageJson, repairJsonQuotes } = new Function(m[0] + '; return { salvageJson, repairJsonQuotes };')();
test('owner 里带未转义引号的真实模型输出：修好后承诺回查那条还在', () => {
  const raw = '{"highlights":[{"text":"高通对Pin物料的报价上周已更新一版"}],"todos":[{"text":"整理Pin的BOM成本表并发给Cary","owner":"S1（自称"我"，身份未明确是否为本人）","how":""}],"factchecks":[{"kind":"link","label":"承诺回查","claim":"这件事09-12《硬件周会》和09-17《硬件周会》都已承诺过，记录里没看到落地","note":"此前两次承诺人为Hannah","evidence":"BOM 那个成本表我回头整理一下发给 Cary"}]}';
  assert.throws(() => JSON.parse(raw), '前提：原文本来就解析不了');
  const j = salvageJson(raw);
  assert.ok(j && j.factchecks && j.factchecks.length === 1, '承诺回查那条丢了：' + JSON.stringify(j));
  assert.equal(j.factchecks[0].label, '承诺回查');
  assert.equal(j.todos[0].owner, 'S1（自称"我"，身份未明确是否为本人）', '正文里的引号要原样保留');
});
test('合法 JSON 原样返回，不被修坏', () => {
  const ok = '{"a":"x, y","b":["1","2"],"c":{"d":"e: f"}}';
  assert.equal(repairJsonQuotes(ok), ok);
  assert.deepEqual(salvageJson(ok), JSON.parse(ok));
});
test('被截断的输出仍走原来的截断抢救', () => {
  const j = salvageJson('{"highlights":[{"text":"a"},{"text":"b"}],"todos":[{"text":"c"');
  assert.ok(j && Array.isArray(j.highlights) && j.highlights.length >= 1, '截断抢救失效：' + JSON.stringify(j));
});
