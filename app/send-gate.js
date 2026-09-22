'use strict';
// 真外发的服务端门禁（2026-09-22 架构审查 X6）。
// 在这之前，「发到飞书 / 发到 Slack / 建日历 / 派任务」四条路只认口令：拿到口令的任何一方，
// 或者界面上一次误触带来的重复请求，都会真发出去，服务端事后查不出「人到底点没点确认」。
//
// 规则和 app/slack-share.js 的 /sharing/slack/send 完全同一套，不另造第二套：
//   1) 请求体必须带 confirmed:true。界面上那一下点击要在服务端留下证据，光有口令不算确认。
//   2) 幂等：同一个 key 的第二次请求直接回上一次的收据，不重发。
//   3) 上一次结果不确定（收据停在 pending，比如超时、进程被杀）时，必须带 retryConfirmed:true
//      才允许重来——「不确定有没有发出去」时默认是不重发，让人先去对面核对。
// 收据落在 <dataDir>/state/send-receipts/<kind>/<key>.json。
const crypto = require('crypto'), fs = require('fs'), path = require('path');

const locks = new Set();   // 同一进程内的双击/并发：文件收据挡不住「两个请求同时进来」
const hash = v => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');

function bad(msg, code, extra) { const e = Error(msg); e.code = code || 400; Object.assign(e, extra || {}); return e; }

// 只要确认、不要幂等的地方用它（例如那条自带 larkStatus 去重的 /sharing/bundle/lark）
function requireConfirmed(body) {
  if (!body || body.confirmed !== true) throw bad('请在界面上确认后再发送（服务端没收到确认）', 400);
}

async function send({ dataDir, kind, key, body = {}, meta = null, run }) {
  requireConfirmed(body);
  if (!dataDir || !kind) throw bad('外发门禁没配好', 500);
  const k = hash(key);
  const lockId = kind + '/' + k;
  const dir = path.join(dataDir, 'state', 'send-receipts', kind);
  const file = path.join(dir, k + '.json');
  if (locks.has(lockId)) throw bad('正在发送，请勿重复点击', 409);
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { prev = null; }
  if (prev && prev.status === 'sent') return { ...prev, alreadySent: true };
  if (prev && body.retryConfirmed !== true) throw bad('上次发送结果还没确认，请先到对方那边核对，确认没发出去再重试', 409, { uncertain: true });
  locks.add(lockId);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ status: 'pending', ...(meta || {}), at: Date.now() }), { mode: 0o600 });
    let out;
    try { out = await run(); }
    catch (e) {
      // 对方明确说了「没发成」（definite）才清收据允许重来；含糊的（超时、网络断）留着 pending，
      // 下一次必须显式 retryConfirmed。宁可让人多看一眼，也不要重复外发。
      if (e && e.definite) { try { fs.rmSync(file, { force: true }); } catch (x) {} }
      else if (e) e.uncertain = true;
      throw e;
    }
    const receipt = { status: 'sent', ...(meta || {}), ...(out && typeof out === 'object' ? out : {}), at: Date.now() };
    try { fs.writeFileSync(file, JSON.stringify(receipt), { mode: 0o600 }); } catch (e) {}
    return receipt;
  } finally { locks.delete(lockId); }
}

module.exports = { send, requireConfirmed, hash };
