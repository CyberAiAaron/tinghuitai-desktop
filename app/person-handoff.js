'use strict';
// 「交给某人」：把一场会里分给某个人（例如张三）的行动建成飞书任务、私聊他、追加到行动清单文档并 @ 他。
// 同一个人在同一场会的行动合成一条消息，不写依据和长证据。
// 所以现在是：同一个人在同一场会的全部行动 → 一次请求（body.items=[{text,due,kind,sourceId}]）→ 三件事各一次：
//   a. 一条飞书任务：标题 = 第一件（多件加「等 N 件」），描述列全部条目 + 会议日期，--due 取最早截止
//   b. 一条私聊：「<会议>（<日期>）后的 N 件事：」+ 编号动作（截止）+ 任务链接 + 落款。不写依据、不写来源、不写内网链接、不写「默认值，可改」
//   c. 行动清单文档追加一行并 @ 这个人（全部条目合在一行）
// 旧的单条请求体（text/due/...）仍收，当 items 长度 1。
// 幂等（app/send-gate.js）：key = 会议 + 人 + 这批条目的 sourceId 集合；已发过的条目从下一批里剔掉（索引在 state/person-handoff-sent/<会议>.json），
// 全剔光就原样回上次收据；剩下的作为「补 N 件」单独发一条，不重发旧的。请求体必须 confirmed:true。
// 飞书命令行只在 app/tools 里拼（tests/tools-architecture 守着），这里只调函数。
const fs = require('fs'), path = require('path');
const lark = require('./tools/lark');
const sendGate = require('./send-gate');

const DOC_TITLE = '听会台行动清单';
const SIGN = '— Aaron 的 Claude 代发';
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const oneLine = v => String(v || '').replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const okId = v => /^[A-Za-z0-9_-]{1,80}$/.test(String(v || ''));
const isOpenId = v => /^ou_[A-Za-z0-9]{1,64}$/.test(String(v || ''));
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const shDate = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);   // Asia/Shanghai 的日期
const plusDays = (n, t = Date.now()) => shDate(t + n * 86400e3);
const MAX_ITEMS = 20;

// 请求体 → 干净的输入；不合法就抛 {code:400}
function normalize(body) {
  const b = body && typeof body === 'object' ? body : {};
  const bad = m => { const e = Error(m); e.code = 400; return e; };
  const meetingId = String(b.meetingId || b.id || '').trim();
  if (!okId(meetingId)) throw bad('会议编号不对');
  const person = oneLine(b.person).slice(0, 60);
  if (!person) throw bad('缺「交给谁」');
  const raw = Array.isArray(b.items) ? b.items : [b];   // 旧单条：整个 body 就是一条
  if (!raw.length) throw bad('缺事项内容');
  if (raw.length > MAX_ITEMS) throw bad('一次最多 ' + MAX_ITEMS + ' 件');
  const items = raw.map(it => {
    const o = it && typeof it === 'object' ? it : {};
    const text = oneLine(o.text).slice(0, 400);
    if (!text) throw bad('缺事项内容');
    const dueRaw = String(o.due || '').trim();
    if (dueRaw && !isDate(dueRaw)) throw bad('截止日期要写成 YYYY-MM-DD');
    const sourceId = String(o.sourceId || '').trim().slice(0, 120);
    if (sourceId && !/^[A-Za-z0-9_.:-]{1,120}$/.test(sourceId)) throw bad('sourceId 不对');
    return { text, kind: String(o.kind || b.kind || '').trim() === 'decision' ? 'decision' : 'todo', due: dueRaw || plusDays(3), sourceId: sourceId || sendGate.hash([text]) };
  });
  const seen = new Set();
  for (const it of items) { if (seen.has(it.sourceId)) throw bad('条目重复：' + it.sourceId); seen.add(it.sourceId); }
  const meetingDate = String(b.meetingDate || '').trim();
  if (meetingDate && !isDate(meetingDate)) throw bad('会议日期要写成 YYYY-MM-DD');
  return { meetingId, person, items, meetingTitle: oneLine(b.meetingTitle).slice(0, 120), meetingDate: meetingDate || shDate(), retryConfirmed: b.retryConfirmed === true };
}

function docFile(dataDir) { return path.join(dataDir, 'state', 'handoff-doc.json'); }
function readDoc(dataDir) { try { const j = JSON.parse(fs.readFileSync(docFile(dataDir), 'utf8')); return j && /^[A-Za-z0-9]{10,64}$/.test(j.token || '') ? j : null; } catch (e) { return null; } }
function writeDoc(dataDir, j) { fs.mkdirSync(path.dirname(docFile(dataDir)), { recursive: true }); fs.writeFileSync(docFile(dataDir), JSON.stringify({ ...j, at: new Date().toISOString() }), { mode: 0o600 }); }

// 已发条目索引：<dataDir>/state/person-handoff-sent/<会议>.json = { [sourceId]: {at, person, partial, taskUrl} }。会后页按 sourceId 读它画「已发」。
function indexFile(dataDir, meetingId) { return path.join(dataDir, 'state', 'person-handoff-sent', meetingId + '.json'); }
function readIndex(dataDir, meetingId) { try { const j = JSON.parse(fs.readFileSync(indexFile(dataDir, meetingId), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; } }
function writeIndex(dataDir, meetingId, idx) { const f = indexFile(dataDir, meetingId); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(idx), { mode: 0o600 }); }
function sentState(dataDir, meetingId, sourceId) { const e = readIndex(dataDir, meetingId)[sourceId]; return e ? { at: e.at || 0, partial: !!e.partial, person: e.person || '', taskUrl: e.taskUrl || '' } : null; }

// 行动清单文档没有就建一份。返回 {ok,token,url,created}
async function ensureDoc(dataDir, cli) {
  const have = readDoc(dataDir);
  if (have) return { ok: true, token: have.token, url: have.url || '', created: false };
  const xml = '<p>Aaron 在听会台回看页上点「发」后自动追加的行动清单：每行一个人、这场会交给他的全部事项和任务链接。被 @ 到的人看这一行就够。</p>';
  const r = await cli.docCreate({ title: DOC_TITLE, content: xml });
  if (!r.ok) return r;
  writeDoc(dataDir, { token: r.token, url: r.url, title: DOC_TITLE });
  return { ok: true, token: r.token, url: r.url, created: true };
}

const lineOf = it => (it.kind === 'decision' ? '请拍板：' : '') + it.text;
const meetingHead = input => (input.meetingTitle ? clip(input.meetingTitle, 40) : '会议') + '（' + input.meetingDate + '）';

// 私聊正文：Aaron 定的格式，别往里加东西
function messageText(input, taskUrl, supplement) {
  const n = input.items.length;
  const L = [meetingHead(input) + (supplement ? '补 ' + n + ' 件：' : '后的 ' + n + ' 件事：')];
  input.items.forEach((it, i) => L.push((i + 1) + '. ' + lineOf(it) + '（截止 ' + it.due + '）'));
  if (taskUrl) L.push('任务：' + taskUrl);
  L.push(SIGN);
  return L.join('\n');
}

// 三件事本体。不抛（除非三件全败），每项 {ok, ...} 或 {ok:false, error}
async function perform(input, prev, { dataDir, execImpl, log = () => {}, supplement = false }) {
  const keep = k => !!(prev && prev[k] && (prev[k].ok || (prev[k].uncertain && !input.retryConfirmed)));
  const skipped = [];
  const cliOpts = { execImpl, log };
  const cli = {
    resolveIds: n => lark.resolveIds(n, cliOpts),
    selfOpenId: () => lark.selfOpenId(cliOpts),
    taskCreate: a => lark.taskCreate(a, cliOpts),
    messageSend: a => lark.messageSend(a, cliOpts),
    docCreate: a => lark.docCreate(a, cliOpts),
    docAppend: a => lark.docAppend(a, cliOpts),
  };
  const out = { person: input.person, items: input.items, supplement, assignee: null, fallbackToSelf: false, task: null, message: null, doc: null };

  // 0. 找人。找不到不猜（发错人是真外发），任务建给当前登录用户本人并注明代办对象；私聊和 @ 都退给本人。
  let openId = '', name = input.person;
  if (isOpenId(input.person)) openId = input.person;
  else {
    try {
      const r = await cli.resolveIds([input.person]);
      if (r.ok && r.ids.length === 1) { openId = r.ids[0]; name = (r.users[0] && r.users[0].name) || input.person; }
      else out.resolveError = r.ok ? ('通讯录里没找到唯一匹配的「' + input.person + '」') : r.error;
    } catch (e) { out.resolveError = String(e.message || e).slice(0, 200); }
  }
  if (!openId) {
    out.fallbackToSelf = true;
    try { openId = String((await cli.selfOpenId()) || ''); } catch (e) { openId = ''; }
    if (!openId) { const e = Error('通讯录里没找到「' + input.person + '」，也拿不到当前登录的飞书用户'); e.results = out; e.definite = true; throw e; }
  }
  out.assignee = { openId, name: out.fallbackToSelf ? '你本人' : name };

  // a. 一条任务：标题 = 第一件（多件加「等 N 件」），描述列全部，截止取最早
  const n = input.items.length;
  const summary = lineOf(input.items[0]) + (n > 1 ? '（等 ' + n + ' 件）' : '');
  const due = input.items.map(it => it.due).sort()[0];
  const descLines = [
    out.fallbackToSelf ? '代办对象：' + input.person + '（通讯录里没解析到，先建给你本人）' : '',
    '会议：' + meetingHead(input),
    ...input.items.map((it, i) => (i + 1) + '. ' + lineOf(it) + '（截止 ' + it.due + '）'),
  ].filter(Boolean);
  if (keep('task')) { out.task = prev.task; skipped.push('task'); } else try {
    const r = await cli.taskCreate({ summary: clip(summary, 120), description: descLines.join('\n'), assignee: openId, due });
    out.task = r.ok ? { ok: true, url: r.url, id: r.id } : { ok: false, error: r.error, uncertain: !!r.uncertain };
  } catch (e) { out.task = { ok: false, error: String(e.message || e).slice(0, 200) }; }

  // b. 一条私聊
  const taskUrl = out.task && out.task.ok && out.task.url ? out.task.url : '';
  const md = (out.fallbackToSelf ? '（本想交给 ' + input.person + '，通讯录里没解析到，先发给你）\n' : '') + messageText(input, taskUrl, supplement);
  if (keep('message')) { out.message = prev.message; skipped.push('message'); } else try {
    const r = await cli.messageSend({ openId, markdown: md });
    out.message = r.ok ? { ok: true, messageId: r.messageId, to: openId } : { ok: false, error: r.error, uncertain: !!r.uncertain };
  } catch (e) { out.message = { ok: false, error: String(e.message || e).slice(0, 200) }; }

  // c. 行动清单追加一行并 @ 人（全部条目合在这一行）
  if (keep('doc')) { out.doc = prev.doc; skipped.push('doc'); } else try {
    const d = await ensureDoc(dataDir, cli);
    if (!d.ok) out.doc = { ok: false, error: d.error, uncertain: !!d.uncertain };
    else {
      const parts = [
        esc(shDate()) + ' ｜ ' + esc(meetingHead(input)) + (supplement ? '补' : '') + ' ｜ 交给 ',
        '<cite type="user" user-id="' + esc(openId) + '"/>',
        out.fallbackToSelf ? esc('（代办对象：' + input.person + '）') : '',
        ' ｜ ' + input.items.map((it, i) => esc((i + 1) + '. ' + lineOf(it) + '（截止 ' + it.due + '）')).join('；'),
        taskUrl ? ' ｜ <a href="' + esc(taskUrl) + '">任务</a>' : ' ｜ 任务未建成',
      ];
      const r = await cli.docAppend({ token: d.token, content: '<p>' + parts.join('') + '</p>' });
      out.doc = r.ok ? { ok: true, token: d.token, url: d.url, created: d.created } : { ok: false, error: r.error, token: d.token, url: d.url, uncertain: !!r.uncertain };
    }
  } catch (e) { out.doc = { ok: false, error: String(e.message || e).slice(0, 200) }; }

  const okCount = ['task', 'message', 'doc'].filter(k => out[k] && out[k].ok).length;
  out.partial = okCount < 3;
  out.failed = ['task', 'message', 'doc'].filter(k => !(out[k] && out[k].ok));
  if (skipped.length) out.skipped = skipped;
  if (!okCount) {
    const e = Error('三件事都没做成：' + ['task', 'message', 'doc'].map(k => (out[k] && out[k].error) || '?').join('；'));
    e.results = out; e.definite = !['task', 'message', 'doc'].some(k => out[k] && out[k].uncertain);
    throw e;
  }
  return out;
}

// 入口：剔掉已发条目 → 过门禁（确认 + 幂等）→ 干活 → 记索引。返回收据（含 alreadySent）；抛 {code:400|409|...}
async function run({ dataDir, body, execImpl, log = () => {} }) {
  const input = normalize(body);
  const idx = readIndex(dataDir, input.meetingId);
  const retry = body && body.retryFailed === true;
  const fresh = retry ? input.items : input.items.filter(it => !idx[it.sourceId]);
  if (!fresh.length) {
    // 全部发过：回最近那份收据，一条命令不跑
    const last = input.items.map(it => idx[it.sourceId]).filter(Boolean).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    let prev = null; try { prev = JSON.parse(fs.readFileSync(path.join(dataDir, 'state', 'send-receipts', 'person-handoff', last.receipt + '.json'), 'utf8')); } catch (e) {}
    return { ...(prev || { status: 'sent', meetingId: input.meetingId, person: input.person, task: last.taskUrl ? { ok: true, url: last.taskUrl } : null, at: last.at }), alreadySent: true };
  }
  const supplement = !retry && fresh.length < input.items.length || (!retry && Object.values(idx).some(e => e.person === input.person));
  const batch = { ...input, items: fresh };
  const key = ['person-handoff', input.meetingId, 'owner', input.person, ...fresh.map(it => it.sourceId).sort()];
  const receipt = await sendGate.send({
    dataDir, kind: 'person-handoff', body: body || {}, key,
    meta: { meetingId: input.meetingId, person: input.person, sourceIds: fresh.map(it => it.sourceId) },
    run: prev => perform(batch, prev, { dataDir, execImpl, log, supplement }),
  });
  if (receipt.status === 'sent') {
    const cur = readIndex(dataDir, input.meetingId), k = sendGate.hash(key);
    for (const it of fresh) cur[it.sourceId] = { at: receipt.at || Date.now(), person: (receipt.assignee && receipt.assignee.name) || input.person, partial: !!receipt.partial, taskUrl: (receipt.task && receipt.task.url) || '', receipt: k };
    writeIndex(dataDir, input.meetingId, cur);
  }
  return receipt;
}

// 路由：主会话在 server.js 里挂一行 —— if (p.endsWith('/person-handoff')) return personHandoff.route(req, res, { authed, dataDir: DATA, log, port: PORT });
async function route(req, res, { authed, dataDir, log = () => {}, execImpl } = {}) {
  const reply = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(j)); };
  if (!authed) { res.writeHead(401); return res.end('unauthorized'); }
  if (req.method !== 'POST') { res.writeHead(405); return res.end('method not allowed'); }
  const parts = []; let size = 0; for await (const c of req) { size += c.length; if (size > 40000) return reply(413, { ok: false, error: '太长' }); parts.push(c); }
  let j; try { j = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); } catch (e) { return reply(400, { ok: false, error: '格式不对' }); }
  try {
    const r = await run({ dataDir, body: j, execImpl, log });
    log('person-handoff ' + r.meetingId + ' → ' + r.person + ' ×' + ((r.items || []).length || '?') + (r.alreadySent ? '（已发过，未重发）' : r.supplement ? '（补发）' : ''));
    return reply(200, { ok: true, ...r });
  } catch (e) {
    const code = e.code === 400 ? 400 : e.code === 409 ? 409 : 500;
    return reply(code, { ok: false, error: e.message, ...(e.uncertain ? { uncertain: true } : {}), ...(e.results ? { results: e.results } : {}) });
  }
}

module.exports = { run, route, sentState, DOC_TITLE, __test: { normalize, perform, ensureDoc, readDoc, messageText } };
