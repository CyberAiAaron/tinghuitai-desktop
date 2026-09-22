'use strict';
// 静默纠名（2026-09-22 第①批）：app/name-fix.js 是纯函数，这里只测替换规则本身。
//   正例 3：中文别名（新宇→星宇）、中文→拉丁别名（露娜→Luna）、拉丁近音自动认（dearra→Daria）
//   反例 2：非人名的同音词不动（新余 / 路那 / carry）、≤1 字的别名不收
//   另外：撤销过的组合（ignore）不再改；改过的每一条都带 from/to
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const nf = require('../app/name-fix');

const ROSTER = ['Shawn Liu', 'Daria', 'Luna Min', '刘星宇', 'Cary Luo'];
const table = () => nf.buildTable(ROSTER, { aliases: { '新宇': '星宇', '露娜': 'Luna', '星': '刘星宇' }, ignore: [] });

test('正例：中文别名按名单纠正，记录 from/to', () => {
  const r = nf.fix('新宇说这个方案明天定', table());
  assert.equal(r.text, '星宇说这个方案明天定');
  assert.deepEqual(r.changes, [{ from: '新宇', to: '星宇' }]);
});

test('正例：中文听写的英文名（露娜）改回 Luna，且已经写对的 Luna 不重复算', () => {
  const r = nf.fix('露娜和 Luna 是同一个人', table());
  assert.equal(r.text, 'Luna和 Luna 是同一个人');
  assert.equal(r.changes.length, 1);
});

test('正例：拉丁名近音（dearra→Daria）按读音键 + 编辑距离自动认，整词替换', () => {
  const r = nf.fix('dearra will join, Daria confirmed', table());
  assert.equal(r.text, 'Daria will join, Daria confirmed');
  assert.deepEqual(r.changes, [{ from: 'dearra', to: 'Daria' }]);
});

test('反例：非人名的同音 / 近音词不动（新余、路那、carry）', () => {
  const src = '新余的路那么远，carry on 就好';
  const r = nf.fix(src, table());
  assert.equal(r.text, src);
  assert.equal(r.changes.length, 0);
});

test('反例：≤1 字的别名不进表，单字不会被改', () => {
  const t = table();
  assert.equal(t.exact.has('星'), false);
  const r = nf.fix('星期三再说', t);
  assert.equal(r.text, '星期三再说');
  assert.equal(r.changes.length, 0);
});

test('撤销过的组合进 ignore 后不再改；ignore 文件原子写、读不到就当空', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemate-namefix-')), file = path.join(dir, 'name-aliases.json');
  assert.deepEqual(nf.readAliasFile(file), { aliases: {}, ignore: [] });
  const cur = nf.addIgnore(file, [{ seg: 'g1', from: '新宇', to: '星宇' }]);
  assert.deepEqual(cur.ignore, ['新宇→星宇']);
  const t = nf.buildTable(ROSTER, { aliases: { '新宇': '星宇' }, ignore: nf.readAliasFile(file).ignore });
  assert.equal(nf.fix('新宇来了', t).text, '新宇来了');
  fs.rmSync(dir, { recursive: true, force: true });
});
