'use strict';
// X3：会后「分享到 Slack」原来是把整份纪要交给一个起在本机、关掉全部权限确认、能搜到账号里
// 任何连接器的命令行去代发——会上别人说的一句话就可能被当成指令执行，而且绑死了某一家模型。
// 这里守住改完之后的行为：用本机 token 直接调 Slack，发送目标和界面上的选项一致，没连就明说。
// 全程假 fetch，一个字节都不会真的发到 Slack。
const { test } = require('node:test'), assert = require('node:assert/strict');
const share = require('../app/share.js');
const slack = require('../app/slack-share.js');

const OK = { ok: true, json: async () => ({ ok: true, channel: 'D1', ts: '1.2' }) };
// 假 fetch：记下每一次请求，永远回成功
const spy = (resp = OK) => { const calls = []; return { calls, fetch: async (url, opt) => { calls.push({ url, opt }); return resp; } }; };
// deps 注入：settings 用假的，post 仍然是 slack-share 里那一个真函数（只把网络换成假的）
const deps = (cfg, f) => ({ settings: { load: () => cfg }, post: a => slack.postText({ ...a, fetcher: f }) });
const MD = '# 一场会\n\n纪要正文\n\n---\n\n## 逐字稿（2 条）\n\n- `0:01` 逐字稿不该被发出去';

test('没连 Slack 就明说去哪儿连，一个请求都不发', async () => {
  const s = spy();
  await assert.rejects(() => share.sendSlack(MD, 'self', deps({}, s.fetch)), /请先在设置里连接 Slack/);
  assert.equal(s.calls.length, 0);
});

test('只连了机器人、没做个人授权时，发给自己要说清楚缺什么', async () => {
  const s = spy();
  await assert.rejects(() => share.sendSlack(MD, 'self', deps({ SLACK_BOT_TOKEN: 'xoxb-假的' }, s.fetch)),
    /个人授权/);
  assert.equal(s.calls.length, 0);
});

test('发给自己：用本机 token 直接调 chat.postMessage，发到我本人', async () => {
  const s = spy();
  const r = await share.sendSlack(MD, 'self', deps({ SLACK_BOT_TOKEN: 'xoxb-假的', SLACK_SELF_ID: 'U自己' }, s.fetch));
  assert.equal(r, true, 'server.js 按返回值判断是否成功，得保持 true');
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, 'https://slack.com/api/chat.postMessage');
  assert.equal(s.calls[0].opt.headers.Authorization, 'Bearer xoxb-假的');
  const body = JSON.parse(s.calls[0].opt.body);
  assert.equal(body.channel, 'U自己');
  assert.match(body.markdown_text, /纪要正文/);
  assert.ok(!/逐字稿不该被发出去/.test(body.markdown_text), '消息里只发纪要，逐字稿让人自己下载');
  assert.equal(body.unfurl_links, false);
});

test('发到频道：频道 id 原样用，不会被改成发给自己', async () => {
  const s = spy();
  await share.sendSlack(MD, 'C频道', deps({ SLACK_BOT_TOKEN: 'xoxb-假的', SLACK_SELF_ID: 'U自己' }, s.fetch));
  assert.equal(JSON.parse(s.calls[0].opt.body).channel, 'C频道');
});

test('不传目标等于发给自己（server.js 传的就是 self）', async () => {
  const s = spy();
  await share.sendSlack(MD, '', deps({ SLACK_BOT_TOKEN: 'xoxb-假的', SLACK_SELF_ID: 'U自己' }, s.fetch));
  assert.equal(JSON.parse(s.calls[0].opt.body).channel, 'U自己');
});

test('Slack 说没发成就往上抛，不许报成功', async () => {
  const s = spy({ ok: true, json: async () => ({ ok: false, error: 'channel_not_found' }) });
  await assert.rejects(() => share.sendSlack(MD, 'C不存在', deps({ SLACK_BOT_TOKEN: 'xoxb-假的', SLACK_SELF_ID: 'U自己' }, s.fetch)),
    /channel_not_found/);
});

test('发消息的实现只有一份：share.js 用的就是 slack-share 导出的那个函数', () => {
  assert.equal(typeof slack.postText, 'function');
  assert.equal(typeof slack.upload, 'function');
  assert.equal(typeof slack.api, 'function');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'app', 'share.js'), 'utf8');
  assert.match(src, /require\('\.\/slack-share'\)\.postText/);
  assert.ok(!/chat\.postMessage/.test(src), 'share.js 不许自己再拼一份 Slack 请求');
});
