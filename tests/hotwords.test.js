'use strict';
// 热词合并三道闸（Codex 复审 major #1）：条数 / 单词长度 / 总字符；去重后再合并，词表 > 简报 > 参会人
const { test } = require('node:test'), assert = require('node:assert/strict');
const { mergeHotwords, HOTWORD_CAP, MAX_WORD_CHARS, MAX_TOTAL_CHARS } = require('../app/hotwords');

test('去重 + 顺序：词表优先，简报和参会人只补位，空白 / 空值丢掉', () => {
  const r = mergeHotwords([['Chansey', ' Pin '], ['Pin', '', null, 'CDCP'], ['王新宇', 'Chansey']]);
  assert.deepEqual(r, ['Chansey', 'Pin', 'CDCP', '王新宇']);
});

test('单词超过 ' + MAX_WORD_CHARS + ' 字符的丢掉，其余照收', () => {
  const long = 'x'.repeat(MAX_WORD_CHARS + 1), edge = '字'.repeat(MAX_WORD_CHARS);
  assert.deepEqual(mergeHotwords([[long, edge, 'ok']]), [edge, 'ok']);
});

test('条数封顶 ' + HOTWORD_CAP + '：第 16 个起不进', () => {
  const words = Array.from({ length: 40 }, (_, i) => 'w' + i);
  const r = mergeHotwords([words]);
  assert.equal(r.length, HOTWORD_CAP);
  assert.deepEqual(r, words.slice(0, HOTWORD_CAP));
});

test('总字符封顶：超出按顺序截断，不打乱前面的', () => {
  const r = mergeHotwords([['abcde', 'fghij', 'klmno', 'pqrst']], { cap: 100, maxTotalChars: 12 });
  assert.deepEqual(r, ['abcde', 'fghij']);
  assert.ok(MAX_TOTAL_CHARS >= HOTWORD_CAP * MAX_WORD_CHARS, '默认总量上限必须容得下 cap × 单词上限，否则条数闸形同虚设');
});

test('极端：超长参会人名单 + 重复 + 超长词一起来，输出仍在三道闸内', () => {
  const attendees = Array.from({ length: 200 }, (_, i) => (i % 3 ? '参会人' + i : '超'.repeat(50)));
  const r = mergeHotwords([['Chansey'], ['Chansey'], attendees]);
  assert.equal(r.length, HOTWORD_CAP);
  assert.ok(r.every(w => [...w].length <= MAX_WORD_CHARS));
  assert.ok(r.reduce((n, w) => n + [...w].length, 0) <= MAX_TOTAL_CHARS);
  assert.equal(new Set(r).size, r.length);
});
