'use strict';
// 会后一键带走：把「纪要 + 待办 + 带说话人的逐字稿」拼成一份 Markdown，
// 再把它发到飞书或 Slack。两条通道都用这台机器上已经有的东西：
//   飞书 —— lark-cli（归档管线一直在用）
//   Slack —— Aaron 账号里的 Slack 连接器，起一个无头 claude 调它（meeting-archive-exec.sh 就是这么发的）
// 不引入任何新凭据：这台机器上没有 Slack token，也不该为了一个按钮去申请企业 app。
const { execFile } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const two = n => String(n).padStart(2, '0');
// 跟转写里已有的 t 字段同一种写法（0:07 / 12:03 / 1:05:09），不然同一份文件里两种时间样式
function clock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return (h ? h + ':' + two(m) : String(m)) + ':' + two(s % 60);
}
const who = (session, spk) => {
  const names = session.names || {};
  const k = String(spk == null ? '' : spk);
  return names[k] || names['S' + k] || (k === '' ? '' : 'S' + k);
};

// 一份文件里两段：上面是给人看的纪要，下面是逐字稿。
// 分成两个文件的话，转发时总有一个会被落下。
function buildMarkdown(session, note) {
  const title = session.topicTitle || session.title || ('会议 ' + (session.id || ''));
  const when = session.start ? new Date(session.start).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '';
  const out = ['# ' + title];
  if (when) out.push('', '_' + when + '_');
  out.push('', note && note.trim() ? note.trim() : '_这一场还没有整理好的纪要。_');
  const tr = Array.isArray(session.transcript) ? session.transcript : [];
  out.push('', '---', '', '## 逐字稿（' + tr.length + ' 条）', '');
  let last = null;
  for (const r of tr) {
    const name = who(session, r.speaker);
    const t = r.t || clock(r.at);
    if (name && name !== last) { out.push('', '**' + name + '**'); last = name; }
    out.push('- `' + t + '` ' + String(r.text || '').replace(/\n+/g, ' ').trim());
  }
  if (!tr.length) out.push('_这一场没有录到转写。_');
  return out.join('\n');
}

const safe = s => String(s || '').replace(/[\/\\:*?"<>|\n\r]/g, '_').slice(0, 60);
const fileNameOf = session => safe(session.title || session.id || '会议') + '_纪要与逐字稿.md';

function run(cmd, args, input, timeoutMs = 120000) {
  return new Promise((res, rej) => {
    const c = execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' } },
      (e, so, se) => e ? rej(new Error(String(se || e.message).slice(0, 400))) : res(String(so || '')));
    if (input != null) { c.stdin.end(input); }
  });
}

// 飞书：搜会话。搜不到就只给「发给自己」，不编造结果。
async function larkTargets(q, cli = process.env.THT_LARK_CLI || 'lark-cli') {
  const out = [{ id: 'self', name: '发给我自己（飞书私聊）' }];
  const term = String(q || '').trim();
  if (!term) return out;
  try {
    const raw = await run(cli, ['im', 'chats', 'search', '--params', JSON.stringify({ query: term, page_size: 10 }), '--as', 'user'], null, 25000);
    const j = JSON.parse(raw.slice(raw.indexOf('{')));
    for (const it of (j.data && (j.data.items || j.data.chats)) || [])
      if (it.chat_id) out.push({ id: it.chat_id, name: it.name || it.chat_id });
  } catch (e) { /* 搜不到就只剩「发给自己」，不报错打断 */ }
  return out;
}

// 一场会的完整 Markdown 常有几十 KB，整段贴进 IM 会被截断甚至发不出去。
// 所以：消息里发「纪要」这一段（人要读的就是它），逐字稿作为文件附上。
function splitForIM(md) {
  const i = md.indexOf('\n---\n\n## 逐字稿');
  const note = (i > 0 ? md.slice(0, i) : md).trim();
  return { note: note.length > 3500 ? note.slice(0, 3500) + '\n…（太长，完整版见附件）' : note, full: md };
}
// 「发给自己」不该要人先去配一个 open_id：lark-cli 自己就知道现在登录的是谁。
let selfIdCache = '';
async function larkSelfId(cli) {
  if (selfIdCache) return selfIdCache;
  const raw = await run(cli, ['contact', '+get-user', '--as', 'user'], null, 25000);
  const j = JSON.parse(raw.slice(raw.indexOf('{')));
  const id = j && j.data && j.data.user && j.data.user.open_id;
  if (!id) throw new Error('拿不到你的飞书身份，先跑一次 lark-cli auth login');
  return (selfIdCache = id);
}
async function sendLark(text, chatId, ownerOpenId, cli = process.env.THT_LARK_CLI || 'lark-cli') {
  const { note, full } = splitForIM(text);
  const who = (chatId && chatId !== 'self') ? ['--chat-id', chatId]
    : ['--user-id', ownerOpenId || await larkSelfId(cli)];
  const check = raw => { if (/"ok"\s*:\s*false/.test(raw)) throw new Error(raw.slice(0, 200)); };
  check(await run(cli, ['im', '+messages-send', '--as', 'user', ...who, '--text', note], null, 60000));
  // 逐字稿当附件发。这一步是加分项不是必需项：飞书的文件上传要单独的授权范围，
  // 没授权就只发纪要，不能因为附件发不了就把已经发出去的纪要说成失败。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-share-'));
  const name = 'meeting-transcript.md';
  fs.writeFileSync(path.join(dir, name), full, { mode: 0o600 });
  try {
    check(await new Promise((res, rej) => execFile(cli, ['im', '+messages-send', '--as', 'user', ...who, '--file', name],
      { cwd: dir, timeout: 90000, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' } },
      (e, so, se) => e ? rej(new Error(String(se || e.message).slice(0, 300))) : res(String(so || '')))));
    return { ok: true, attached: true };
  } catch (e) {
    return { ok: true, attached: false, why: /missing_scope|99991679/.test(String(e.message)) ? '飞书没给这个账号发文件的权限' : String(e.message).slice(0, 120) };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
}

// Slack：不走 token，起一个无头 claude 用 Aaron 账号里的连接器发。
// 正文写成临时文件让它读，避免超长内容挤进命令行。
async function sendSlack(text, channel) {
  const f = path.join(os.tmpdir(), 'tht-slack-' + Date.now() + '.txt');
  fs.writeFileSync(f, splitForIM(text).note, { mode: 0o600 });   // 只发纪要，逐字稿让人自己下载
  const target = channel && channel !== 'self'
    ? `channel_id=${channel}` : '发到我自己的 Slack 私聊（把消息发给我本人，不要发到任何频道）';
  const prompt = [
    '只做一件事：把一段已经写好的文本原样发到 Slack。不要改写、不要润色、不要加字、不要删字。',
    '1. Read ' + f,
    '2. 用 ToolSearch 找 Slack 连接器的发消息工具（关键词 slack send message）。',
    '3. 调用它，' + target + '，内容 = 第 1 步读到的逐字原文。',
    '4. 成功只输出一行 SHARE_OK；失败输出 SHARE_FAIL 加原因。不要输出别的。'
  ].join('\n');
  try {
    const out = await run('claude', ['-p', prompt, '--model', 'claude-haiku-4-5-20251001',
      '--allowedTools', 'Read', 'ToolSearch', '--permission-mode', 'bypassPermissions'], null, 180000);
    if (!/SHARE_OK/.test(out)) throw new Error(out.replace(/\s+/g, ' ').slice(0, 300) || '没有拿到成功回执');
    return true;
  } finally { try { fs.unlinkSync(f); } catch (e) {} }
}

module.exports = { buildMarkdown, fileNameOf, larkTargets, sendLark, sendSlack, __test: { clock, who, buildMarkdown, splitForIM } };
