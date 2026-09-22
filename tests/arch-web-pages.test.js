'use strict';
// X5：口令走 query（?token=…）。页面上点一条飞书或外部链接，浏览器默认会把当前地址
// 连同口令一起放进 Referer 发给对方。所有页面都声明 no-referrer 就不会发。
// （口令改走请求头是另一件事，另立项；这条是在那之前最省的止血。）
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '..', 'web');
// 例外名单，正常应当是空的。09-22 archive.html 已补齐，名单清空。
const PENDING = new Set([]);
const META = /<meta\s+name=["']referrer["']\s+content=["']no-referrer["']\s*\/?>/i;

const pages = () => fs.readdirSync(WEB).filter(f => f.endsWith('.html'));

test('web 下每个页面都声明 no-referrer', () => {
  const missing = pages().filter(f => !PENDING.has(f) && !META.test(fs.readFileSync(path.join(WEB, f), 'utf8')));
  assert.deepEqual(missing, [], '这些页面会把带口令的地址当 Referer 送出去：' + missing.join('、'));
});

test('声明写在 <head> 里，不是正文里的一段文字', () => {
  for (const f of pages()) {
    if (PENDING.has(f)) continue;
    const html = fs.readFileSync(path.join(WEB, f), 'utf8');
    const head = html.slice(0, html.toLowerCase().indexOf('</head>'));
    assert.ok(META.test(head), f + ' 的 no-referrer 不在 <head> 里');
  }
});

test('index.html 是构建产物：模板里有，构建出来的页面里也要有', () => {
  assert.ok(META.test(fs.readFileSync(path.join(WEB, 'index.template.html'), 'utf8')), '模板里没有');
  assert.ok(META.test(fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')), 'index.html 没跟上，跑一次 node scripts/build-web.js');
});

test('例外名单必须是空的：新加页面要么带 no-referrer，要么先说明为什么不能带', () => {
  assert.deepEqual([...PENDING], []);
});
