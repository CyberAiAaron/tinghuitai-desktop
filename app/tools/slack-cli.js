#!/usr/bin/env node
'use strict';
// tht-slack：卡片对话框里那个无头 agent 用的 Slack 命令行（壳是仓库里的 app/tools/bin/tht-slack，app/card-thread.js 校验过它再把目录前置到 PATH）。
// 和 lark-cli 一样是 Bash 里的一条命令、输出 JSON；口令从本机 settings.json 读（SLACK_USER_TOKEN / SLACK_BOT_TOKEN，同 app/slack-share.js），
// 不进参数、不进输出、不进日志。读类：search / read-channel / read-thread / user；写类：send / dm（正文自动补「— Aaron 的 Claude 代回」）。
// 写类能不能被调到不由这里管——card-thread 只在用户确认了对应动作的那一轮才把 Bash(tht-slack send:*) / dm 放进 allowedTools。
const fs = require('fs'), path = require('path'), os = require('os');
const slack = require('./slack');

const SIGN = '— Aaron 的 Claude 代回';
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const READ_CMDS = ['search', 'read-channel', 'read-thread', 'user'];
const WRITE_CMDS = ['send', 'dm'];

function settingsFile(env) { return path.join(String(env.THT_DATA_DIR || path.join(os.homedir(), 'Library/Application Support/Tinghuitai')), 'settings.json'); }
function tokens(env) {
  try { const j = JSON.parse(fs.readFileSync(settingsFile(env), 'utf8')); return { user: String(j.SLACK_USER_TOKEN || '').trim(), bot: String(j.SLACK_BOT_TOKEN || '').trim() }; }
  catch (e) { return { user: '', bot: '' }; }
}
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v !== undefined && !v.startsWith('--')) { out[k] = v; i++; } else out[k] = true; }
    else out._.push(a);
  }
  return out;
}
const msgOf = m => ({ ts: m.ts || '', user: m.user || m.username || '', text: clip(m.text, 600), replies: Number(m.reply_count) || 0, thread_ts: m.thread_ts || '' });
const lim = (v, d, max) => Math.max(1, Math.min(max, Number(v) || d));

async function main(argv, { env = process.env, fetchImpl } = {}) {
  const a = parseArgs(argv);
  const cmd = a._[0] || '';
  const tk = tokens(env);
  const readTok = tk.user || tk.bot, writeTok = tk.bot || tk.user;
  if (![...READ_CMDS, ...WRITE_CMDS].includes(cmd)) return { ok: false, error: '用法：tht-slack <' + [...READ_CMDS, ...WRITE_CMDS].join('|') + '> --…' };
  if (!readTok) return { ok: false, error: '本机设置里没有接 Slack（设置页 → 连接 Slack）' };
  const call = (tok, m, p) => slack.call(tok, m, p, fetchImpl);
  // 读频道 / 线程：先用用户授权，缺 scope（用户授权没勾 channels:history / im:history）就换机器人口令再试一次；两份都缺才报
  const readCall = async (m, p) => { const r = await call(readTok, m, p); if (!r.ok && /missing_scope/.test(r.error) && tk.user && tk.bot) return call(tk.bot, m, p); return r; };
  if (cmd === 'search') {
    if (!a.query || a.query === true) return { ok: false, error: '要 --query' };
    if (!tk.user) return { ok: false, error: '搜索要用户授权（xoxp-），设置里只有机器人口令' };
    const r = await call(tk.user, 'search.messages', { query: a.query, count: String(lim(a.limit, 8, 20)), sort: 'timestamp' });
    if (!r.ok) return r;
    const ms = ((r.data.messages || {}).matches || []);
    return { ok: true, count: ms.length, items: ms.map(m => ({ ...msgOf(m), channel: (m.channel || {}).name ? '#' + m.channel.name : (m.channel || {}).id || '', channel_id: (m.channel || {}).id || '', url: m.permalink || '' })) };
  }
  if (cmd === 'read-channel') {
    if (!a.channel || a.channel === true) return { ok: false, error: '要 --channel' };
    const r = await readCall('conversations.history', { channel: a.channel, limit: String(lim(a.limit, 10, 50)) });
    if (!r.ok) return r;
    const ms = r.data.messages || [];
    return { ok: true, count: ms.length, items: ms.map(msgOf) };
  }
  if (cmd === 'read-thread') {
    if (!a.channel || a.channel === true || !a.ts || a.ts === true) return { ok: false, error: '要 --channel 和 --ts' };
    const r = await readCall('conversations.replies', { channel: a.channel, ts: a.ts, limit: String(lim(a.limit, 20, 100)) });
    if (!r.ok) return r;
    const ms = r.data.messages || [];
    return { ok: true, count: ms.length, items: ms.map(msgOf) };
  }
  if (cmd === 'user') {
    let r;
    if (a.email && a.email !== true) r = await call(readTok, 'users.lookupByEmail', { email: a.email });
    else if (a.user && a.user !== true) r = await call(readTok, 'users.info', { user: a.user });
    else return { ok: false, error: '要 --user 或 --email' };
    if (!r.ok) return r;
    const u = r.data.user || {};
    return { ok: true, user: { id: u.id || '', name: u.name || '', real_name: u.real_name || (u.profile || {}).real_name || '', title: (u.profile || {}).title || '', tz: u.tz || '' } };
  }
  // 写类
  const target = cmd === 'dm' ? a.user : a.channel;
  if (!target || target === true) return { ok: false, error: cmd === 'dm' ? '要 --user' : '要 --channel' };
  let text = String(a.text === true ? '' : (a.text || '')).trim();
  if (!text) return { ok: false, error: '要 --text' };
  if (text.length > 4000) return { ok: false, error: '正文超过 4000 字' };
  if (!text.includes(SIGN)) text = text + '\n' + SIGN;
  const p = { channel: target, text, unfurl_links: 'false', unfurl_media: 'false' };
  if (a['thread-ts'] && a['thread-ts'] !== true) p.thread_ts = a['thread-ts'];
  const r = await call(writeTok, 'chat.postMessage', p);
  if (!r.ok) return r;
  return { ok: true, channel: r.data.channel || '', ts: r.data.ts || '' };
}

if (require.main === module) {
  main(process.argv.slice(2)).then(r => { process.stdout.write(JSON.stringify(r) + '\n'); process.exit(r.ok ? 0 : 1); },
    e => { process.stdout.write(JSON.stringify({ ok: false, error: clip(e && e.message, 200) }) + '\n'); process.exit(1); });
}
module.exports = { main, parseArgs, SIGN, READ_CMDS, WRITE_CMDS };
