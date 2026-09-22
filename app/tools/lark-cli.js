'use strict';
// 全仓只有这一处真正拼 lark-cli 的命令行。工具登记表里的飞书工具和找人都从这里走。
// 搬自 app/actions.js（2026-09-22）：那边原来自己跑命令，现在改成调登记表。
const fs = require('fs'), path = require('path'), { execFile } = require('child_process');

function binPath() { return process.env.THT_LARK_CLI || 'lark-cli'; }
// 装没装：绝对路径直接看文件，裸名字在 PATH 里找一遍。找不到就让 available 说清楚缺什么。
function binInstalled() {
  const b = binPath();
  if (b.includes('/')) { try { fs.accessSync(b, fs.constants.X_OK); return true; } catch (e) { return false; } }
  for (const dir of String(process.env.PATH || '').split(':')) {
    if (!dir) continue;
    try { fs.accessSync(path.join(dir, b), fs.constants.X_OK); return true; } catch (e) {}
  }
  return false;
}
const larkAvailable = () => (binInstalled() ? { ok: true } : { ok: false, reason: '未接：本机找不到 lark-cli（装好并 lark-cli auth login 之后自动可用）' });

const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

// 跑一条命令，只认 JSON 输出。失败一律返回 {ok:false,error}，不抛。
function runCli(args, { execImpl = execFile, log = () => {}, timeout = 60000 } = {}) {
  return new Promise(resolve => {
    execImpl(binPath(), args, { timeout, maxBuffer: 8e6 }, (err, out, errOut) => {
      // uncertain（第 9 条，2026-09-22）：命令是被超时 / 信号杀掉的，飞书那边可能已经建了 —— 外发门禁看这个标志决定要不要留 pending 收据。
      // 命令自己退出并报错、或回了非 JSON / 带 error 的 JSON，都算确定没发成。
      if (err) return resolve({ ok: false, error: clip(String((errOut || err.message || '')), 200) || 'lark-cli 没跑起来', uncertain: !!(err.killed || err.signal) });
      let j = null; try { j = JSON.parse(String(out).trim()); } catch (e) {}
      if (!j) return resolve({ ok: false, error: 'lark-cli 返回的不是 JSON' });
      if (j.ok === false || j.error) return resolve({ ok: false, error: clip((j.error && (j.error.message || j.error)) || '飞书拒绝了这次请求', 200) });
      resolve({ ok: true, json: j });
    });
    log('lark-cli ' + args.slice(0, 2).join(' '));
  });
}

const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

// 名字 → open_id。解析不到的原样回给调用方，写进说明里，不硬发。
// 真实返回是一个扁平的 users[]：{open_id, localized_name, matched_query}（2026-09-22 实测）。
async function resolveIds(names, opts = {}) {
  const list = (names || []).filter(Boolean);
  if (!list.length) return { ok: true, ids: [], missing: [], users: [] };
  const r = await runCli(['contact', '+search-user', '--queries', list.join(','), '--as', 'user', '--exclude-external-users', '--format', 'json'], opts);
  if (!r.ok) return { ok: false, error: r.error, ids: [], missing: list, users: [] };
  const users = [];
  const walk = v => {
    if (!v || typeof v !== 'object') return;
    if (typeof v.open_id === 'string' && v.open_id) users.push({ id: v.open_id, name: String(v.localized_name || v.name || v.en_name || ''), matched: String(v.matched_query || '') });
    for (const x of Object.values(v)) walk(x);
  };
  walk(r.json);
  const ids = [], missing = [], hits = [];
  for (const n of list) {
    // 名字全等的那一个；没有全等的，这个关键词只搜出一个人才认。搜「Calvin」出来两个 Calvin 就不猜——
    // 邀请发错人是真外发，宁可写进 missing 让他自己补。
    const exact = users.filter(u => norm(u.name) === norm(n));
    const byQuery = users.filter(u => norm(u.matched) === norm(n));
    const hit = exact.length === 1 ? exact[0] : (!exact.length && byQuery.length === 1 ? byQuery[0] : null);
    if (hit && hit.id) { if (!ids.includes(hit.id)) ids.push(hit.id); hits.push({ query: n, name: hit.name, openId: hit.id }); }
    else missing.push(n);
  }
  return { ok: true, ids, missing, users: hits };
}

// 文档 token → 可打开的链接与标题。只读；域名由 lark-cli 回读（drive +inspect 的 data.url），不在代码里手拼（需求单 §3）。
// 失败返回 {ok:false,error}，调用方自己决定退路（例如只写来源名不附链接）。
async function docInspect(token, opts = {}) {
  const t = String(token || '').trim();
  if (!/^[A-Za-z0-9]{10,64}$/.test(t)) return { ok: false, error: '文档 token 不像样' };
  const r = await runCli(['drive', '+inspect', '--url', t, '--type', 'docx', '--as', 'user', '--format', 'json'], { timeout: 12000, ...opts });
  if (!r.ok) return { ok: false, error: r.error, uncertain: false };
  const d = (r.json && r.json.data) || {};
  const url = String(d.url || '').trim();
  if (!/^https:\/\//.test(url)) return { ok: false, error: 'lark-cli 没回链接' };
  return { ok: true, url, title: clip(d.title || '', 120), token: String(d.token || t) };
}

// 建一条飞书任务（洞察卡「定日期」用，批 3）。写类：调用方自己过确认门禁再来。返回 {ok,url,id} 或 {ok:false,error,uncertain}
async function taskCreate({ summary, description = '', assignee = '', due = '' }, opts = {}) {
  const s = clip(String(summary || '').trim(), 120);
  if (!s) return { ok: false, error: '任务标题是空的' };
  const a = ['task', '+create', '--summary', s];
  if (description) a.push('--description', clip(description, 2000));
  if (/^(?:ou_|cli_)[A-Za-z0-9]{1,64}$/.test(assignee)) a.push('--assignee', assignee);
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) a.push('--due', due);   // 裸 YYYY-MM-DD（1.0.96 的 date: 前缀会解析失败）
  a.push('--as', 'user', '--format', 'json');
  const r = await runCli(a, { timeout: 30000, ...opts });
  if (!r.ok) return { ok: false, error: r.error, uncertain: !!r.uncertain };
  const dig = (o, ...ps) => { for (const p of ps) { const v = p.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o); if (v != null && v !== '') return String(v); } return ''; };
  return { ok: true, url: dig(r.json, 'data.task.url', 'data.url'), id: dig(r.json, 'data.task.guid', 'data.task.task_id', 'data.guid') };
}

module.exports = { binPath, binInstalled, larkAvailable, runCli, resolveIds, docInspect, taskCreate, clip, norm };
