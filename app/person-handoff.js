'use strict';
// 「交给某人」（Aaron 2026-09-24：「give to Abel… share a task or message to him, add this action at my Lark document and @ Abel. 真正可以 act for me」）。
// 回看页上的待定项 / 待办点「交给 X」→ 一次做三件事，每件独立成败、逐项回报：
//   a. 给这个人建飞书任务（解析不到 open_id 就建给 Aaron 本人并写「代办对象：X」）
//   b. 飞书私聊给这个人发一条：一句话事项 + 依据 + 任务链接，末尾「— Aaron 的 Claude 代发」
//   c. 在「听会台行动清单」文档末尾追加一行并 @ 这个人（文档 token 记在 <dataDir>/state/handoff-doc.json，没有就建一份）
// 外发规矩和 /meeting-action do:'send' 同一套（app/send-gate.js）：请求体必须 confirmed:true；同一 sourceId（没有就按
// 会 + 人 + 类型 + 原文算指纹）第二次直接回上次的收据，不重发。三件事全败才清收据允许重来。
// 飞书命令行只在 app/tools 里拼（tests/tools-architecture 守着），这里只调函数。
const fs = require('fs'), path = require('path');
const lark = require('./tools/lark');   // 只调工具层的函数，命令行不在这里拼
const sendGate = require('./send-gate');

const AARON_OPEN_ID = 'ou_00c28e8ed0b15769a9a5f5e4ea36f7e8';
const DOC_TITLE = '听会台行动清单';
const SIGN = '— Aaron 的 Claude 代发';
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const oneLine = v => String(v || '').replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const okId = v => /^[A-Za-z0-9_-]{1,80}$/.test(String(v || ''));
const isOpenId = v => /^ou_[A-Za-z0-9]{1,64}$/.test(String(v || ''));
const shDate = (t = Date.now()) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);   // Asia/Shanghai 的日期
const plusDays = (n, t = Date.now()) => shDate(t + n * 86400e3);

// 请求体 → 干净的输入；不合法就抛 {code:400}
function normalize(body) {
  const b = body && typeof body === 'object' ? body : {};
  const bad = m => { const e = Error(m); e.code = 400; return e; };
  const meetingId = String(b.meetingId || b.id || '').trim();
  if (!okId(meetingId)) throw bad('会议编号不对');
  const person = oneLine(b.person).slice(0, 60);
  if (!person) throw bad('缺「交给谁」');
  const kind = String(b.kind || '').trim() === 'decision' ? 'decision' : 'todo';
  const text = oneLine(b.text).slice(0, 400);
  if (!text) throw bad('缺事项内容');
  const context = clip(String(b.context || '').trim(), 1500);
  const dueRaw = String(b.due || '').trim();
  if (dueRaw && !/^\d{4}-\d{2}-\d{2}$/.test(dueRaw)) throw bad('截止日期要写成 YYYY-MM-DD');
  const sourceId = String(b.sourceId || '').trim().slice(0, 120);
  if (sourceId && !/^[A-Za-z0-9_.:-]{1,120}$/.test(sourceId)) throw bad('sourceId 不对');
  const meetingTitle = oneLine(b.meetingTitle).slice(0, 120);
  return { meetingId, person, kind, text, context, due: dueRaw || plusDays(3), dueDefault: !dueRaw, sourceId, meetingTitle };
}

const kindLabel = k => (k === 'decision' ? '待决定' : '待办');

function docFile(dataDir) { return path.join(dataDir, 'state', 'handoff-doc.json'); }
function readDoc(dataDir) { try { const j = JSON.parse(fs.readFileSync(docFile(dataDir), 'utf8')); return j && /^[A-Za-z0-9]{10,64}$/.test(j.token || '') ? j : null; } catch (e) { return null; } }
function writeDoc(dataDir, j) { fs.mkdirSync(path.dirname(docFile(dataDir)), { recursive: true }); fs.writeFileSync(docFile(dataDir), JSON.stringify({ ...j, at: new Date().toISOString() }), { mode: 0o600 }); }

// 行动清单文档没有就建一份：标题 + 一段说明 + 首行表头。返回 {ok,token,url,created}
async function ensureDoc(dataDir, cli) {
  const have = readDoc(dataDir);
  if (have) return { ok: true, token: have.token, url: have.url || '', created: false };
  const xml = '<p>Aaron 在听会台回看页上点「交给某人」后自动追加的行动清单：每行一条，谁负责、依据是什么、任务链接在哪。' +
    '被 @ 到的人看这一行就够，不必翻会议记录。</p>';
  const r = await cli.docCreate({ title: DOC_TITLE, content: xml });
  if (!r.ok) return r;
  writeDoc(dataDir, { token: r.token, url: r.url, title: DOC_TITLE });
  return { ok: true, token: r.token, url: r.url, created: true };
}

// 三件事本体。不抛（除非三件全败），每项 {ok, ...} 或 {ok:false, error}
async function perform(input, { dataDir, execImpl, log = () => {}, archiveBase = '' }) {
  const cliOpts = { execImpl, log };
  const cli = {
    resolveIds: n => lark.resolveIds(n, cliOpts),
    taskCreate: a => lark.taskCreate(a, cliOpts),
    messageSend: a => lark.messageSend(a, cliOpts),
    docCreate: a => lark.docCreate(a, cliOpts),
    docAppend: a => lark.docAppend(a, cliOpts),
  };
  const out = { person: input.person, kind: input.kind, assignee: null, fallbackToAaron: false, task: null, message: null, doc: null };
  const meetingUrl = archiveBase ? archiveBase.replace(/\/$/, '') + '/archive.html?id=' + encodeURIComponent(input.meetingId) : '';
  const meetingLabel = input.meetingTitle ? '《' + input.meetingTitle + '》' : ('会议 ' + input.meetingId);

  // 0. 找人。找不到不猜（发错人是真外发），任务建给 Aaron 本人并注明代办对象；私聊和 @ 都退到 Aaron。
  let openId = '', name = input.person;
  if (isOpenId(input.person)) openId = input.person;
  else {
    try {
      const r = await cli.resolveIds([input.person]);
      if (r.ok && r.ids.length === 1) { openId = r.ids[0]; name = (r.users[0] && r.users[0].name) || input.person; }
      else out.resolveError = r.ok ? ('通讯录里没找到唯一匹配的「' + input.person + '」') : r.error;
    } catch (e) { out.resolveError = String(e.message || e).slice(0, 200); }
  }
  if (!openId) { out.fallbackToAaron = true; openId = AARON_OPEN_ID; }
  out.assignee = { openId, name: out.fallbackToAaron ? 'Aaron Wang' : name };

  // a. 建任务
  const summary = (input.kind === 'decision' ? '请拍板：' : '') + input.text;
  const descLines = [
    out.fallbackToAaron ? '代办对象：' + input.person + '（通讯录里没解析到，先建给 Aaron）' : '',
    kindLabel(input.kind) + '，来自' + meetingLabel + (meetingUrl ? '：' + meetingUrl : ''),
    input.context ? '依据：' + input.context : '',
    input.dueDefault ? '截止：' + input.due + '（默认截止，可改）' : '截止：' + input.due,
  ].filter(Boolean);
  try {
    const r = await cli.taskCreate({ summary: clip(summary, 120), description: descLines.join('\n'), assignee: openId, due: input.due });
    out.task = r.ok ? { ok: true, url: r.url, id: r.id } : { ok: false, error: r.error, uncertain: !!r.uncertain };
  } catch (e) { out.task = { ok: false, error: String(e.message || e).slice(0, 200) }; }

  // b. 私聊
  const md = [
    '**' + kindLabel(input.kind) + '｜' + input.text + '**',
    out.fallbackToAaron ? '（本想交给 ' + input.person + '，通讯录里没解析到，先发给你）' : '',
    input.context ? '依据：' + input.context : '',
    '来自' + meetingLabel + (meetingUrl ? '（' + meetingUrl + '）' : ''),
    out.task && out.task.ok && out.task.url ? '任务：' + out.task.url + (input.dueDefault ? '（截止 ' + input.due + '，默认值，可改）' : '（截止 ' + input.due + '）') : '（飞书任务没建成' + (out.task && out.task.error ? '：' + out.task.error : '') + '）',
    '', SIGN,
  ].filter(l => l !== '').join('\n');
  try {
    const r = await cli.messageSend({ openId, markdown: md });
    out.message = r.ok ? { ok: true, messageId: r.messageId, to: openId } : { ok: false, error: r.error, uncertain: !!r.uncertain };
  } catch (e) { out.message = { ok: false, error: String(e.message || e).slice(0, 200) }; }

  // c. 行动清单追加一行并 @ 人
  try {
    const d = await ensureDoc(dataDir, cli);
    if (!d.ok) out.doc = { ok: false, error: d.error, uncertain: !!d.uncertain };
    else {
      const parts = [
        esc(shDate()) + ' ｜ ' + esc(kindLabel(input.kind)) + ' ｜ ' + esc(input.text) + ' ｜ 交给 ',
        '<cite type="user" user-id="' + esc(openId) + '"/>',
        out.fallbackToAaron ? esc('（代办对象：' + input.person + '）') : '',
        input.context ? ' ｜ 依据：' + esc(clip(input.context, 300)) : '',
        ' ｜ 截止 ' + esc(input.due) + (input.dueDefault ? '（默认）' : ''),
        out.task && out.task.ok && out.task.url ? ' ｜ <a href="' + esc(out.task.url) + '">任务</a>' : ' ｜ 任务未建成',
        meetingUrl ? ' ｜ <a href="' + esc(meetingUrl) + '">回看</a>' : ' ｜ ' + esc(meetingLabel),
      ];
      const r = await cli.docAppend({ token: d.token, content: '<p>' + parts.join('') + '</p>' });
      out.doc = r.ok ? { ok: true, token: d.token, url: d.url, created: d.created } : { ok: false, error: r.error, token: d.token, url: d.url, uncertain: !!r.uncertain };
    }
  } catch (e) { out.doc = { ok: false, error: String(e.message || e).slice(0, 200) }; }

  const okCount = ['task', 'message', 'doc'].filter(k => out[k] && out[k].ok).length;
  if (!okCount) {
    // 三件全没成：确定都没发出去才允许重来；任何一件「不确定」就留 pending 收据（门禁要 retryConfirmed）
    const e = Error('三件事都没做成：' + ['task', 'message', 'doc'].map(k => (out[k] && out[k].error) || '?').join('；'));
    e.results = out; e.definite = !['task', 'message', 'doc'].some(k => out[k] && out[k].uncertain);
    throw e;
  }
  return out;
}

// 入口：过门禁（确认 + 幂等）再干活。返回收据（含 alreadySent）；抛 {code:400|409|...}
async function run({ dataDir, body, execImpl, log = () => {}, archiveBase = '' }) {
  const input = normalize(body);
  const key = ['person-handoff', input.meetingId, input.sourceId || sendGate.hash([input.person, input.kind, input.text])];
  const receipt = await sendGate.send({
    dataDir, kind: 'person-handoff', body: body || {}, key,
    meta: { meetingId: input.meetingId, sourceId: input.sourceId, person: input.person, kind: input.kind },
    run: () => perform(input, { dataDir, execImpl, log, archiveBase }),
  });
  return receipt;
}

// 路由：主会话在 server.js 里挂一行 —— if (p.endsWith('/person-handoff')) return personHandoff.route(req, res, { authed, dataDir: DATA, log, port: PORT });
async function route(req, res, { authed, dataDir, log = () => {}, port = 47823, execImpl } = {}) {
  const reply = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(j)); };
  if (!authed) { res.writeHead(401); return res.end('unauthorized'); }
  if (req.method !== 'POST') { res.writeHead(405); return res.end('method not allowed'); }
  const parts = []; let size = 0; for await (const c of req) { size += c.length; if (size > 20000) return reply(413, { ok: false, error: '太长' }); parts.push(c); }
  let j; try { j = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); } catch (e) { return reply(400, { ok: false, error: '格式不对' }); }
  try {
    const r = await run({ dataDir, body: j, execImpl, log, archiveBase: 'http://127.0.0.1:' + port });
    log('person-handoff ' + r.meetingId + ' → ' + r.person + (r.alreadySent ? '（已发过，未重发）' : ''));
    return reply(200, { ok: true, ...r });
  } catch (e) {
    const code = e.code === 400 ? 400 : e.code === 409 ? 409 : 500;
    return reply(code, { ok: false, error: e.message, ...(e.uncertain ? { uncertain: true } : {}), ...(e.results ? { results: e.results } : {}) });
  }
}

module.exports = { run, route, AARON_OPEN_ID, DOC_TITLE, __test: { normalize, perform, ensureDoc, readDoc } };
