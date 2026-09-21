#!/usr/bin/env node
'use strict';
// 本机 MCP 出口（2026-09-22）。
//
// 一个 stdio 的 MCP 服务（JSON-RPC 2.0，手写最小实现，不加依赖）。它自己不碰任何数据：
// 只把调用转给本机听会台服务的 /tools 和 /tools/call，所以权限、审计、写类门禁都还在服务端那一份里。
// 只暴露读类工具——写类在服务端那条路由上就是 403，这里连列都不列。
//
// 用法（不要改 ~/.claude.json，也不要 claude mcp add）：
//   claude -p --mcp-config <临时 json> --strict-mcp-config --allowedTools "mcp__tinghuitai__meetings_search" ...
// 临时 json：{"mcpServers":{"tinghuitai":{"command":"node","args":["<这个文件>"],"env":{"THT_DATA_DIR":"…","THT_PORT":"…"}}}}
//
// 端口和口令从数据目录的 settings.json 读（THT_PORT 环境变量优先）。服务没起就返回说得清的错误。
// 日志只许写 stderr；stdout 只许出协议帧。
const fs = require('fs'), path = require('path'), os = require('os');

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST = SUPPORTED[0];
const SERVER_INFO = { name: 'tinghuitai', title: '听会台本机工具', version: '1' };

const logErr = (...a) => { try { process.stderr.write('[mcp-bridge] ' + a.join(' ') + '\n'); } catch (e) {} };

function dataDir() {
  return path.resolve(process.env.THT_DATA_DIR || path.join(os.homedir(), 'Library/Application Support/Tinghuitai'));
}
function conf() {
  const file = path.join(dataDir(), 'settings.json');
  let j = {};
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { error: '读不到本机配置 ' + file + '（' + e.code + '）' }; }
  const token = String(j.RELAY_TOKEN || '').trim();
  if (!token) return { error: '本机配置里没有 RELAY_TOKEN' };
  const port = Number(process.env.THT_PORT || j.PORT || j.THT_PORT || 47823);
  if (!Number.isInteger(port) || port <= 0) return { error: '端口不对：' + port };
  return { token, port };
}

// MCP 工具名用下划线，和登记表的点号名一一对应。
const toMcp = n => n.replace(/\./g, '_');

async function hit(pathname, init) {
  const c = conf();
  if (c.error) return { ok: false, error: c.error };
  const url = 'http://127.0.0.1:' + c.port + '/asr-relay' + pathname + (pathname.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(c.token);
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(60000) });
    const j = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, error: '听会台服务返回 ' + r.status + (j && j.error ? '：' + j.error : '') };
    return { ok: true, json: j };
  } catch (e) {
    return { ok: false, error: '连不上本机听会台服务（127.0.0.1:' + c.port + '）：' + String(e.message || e).slice(0, 120) + '。先把听会台跑起来再试。' };
  }
}

async function listTools() {
  const r = await hit('/tools');
  if (!r.ok) return r;
  const rows = ((r.json || {}).tools || []).filter(t => t.level === 'read');
  return { ok: true, tools: rows.map(t => ({
    name: toMcp(t.name), title: t.title || t.name,
    description: (t.description || '') + (t.available ? '' : '（当前不可用：' + t.reason + '）'),
    inputSchema: t.input && t.input.type === 'object' ? t.input : { type: 'object', properties: {} },
  })) };
}

async function callTool(mcpName, args) {
  const r = await hit('/tools');
  if (!r.ok) return { ok: false, error: r.error };
  const row = ((r.json || {}).tools || []).find(t => t.level === 'read' && toMcp(t.name) === mcpName);
  if (!row) return { ok: false, error: '没有这个工具：' + String(mcpName).slice(0, 60) };
  const c = await hit('/tools/call', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: row.name, args: args || {} }) });
  if (!c.ok) return { ok: false, error: c.error };
  return { ok: true, result: c.json };
}

// ===== JSON-RPC 2.0 over stdio =====
const write = obj => { try { process.stdout.write(JSON.stringify(obj) + '\n'); } catch (e) { logErr('写 stdout 失败 ' + e.message); } };
const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg || {};
  const hasId = id !== undefined && id !== null;
  if (method === 'initialize') {
    const want = String(((params || {}).protocolVersion) || '');
    return reply(id, { protocolVersion: SUPPORTED.includes(want) ? want : LATEST,
      capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;   // 通知没有 id，不回
  if (method === 'ping') return hasId && reply(id, {});
  if (method === 'tools/list') {
    const r = await listTools();
    if (!r.ok) return fail(id, -32603, r.error);
    return reply(id, { tools: r.tools });
  }
  if (method === 'tools/call') {
    const name = String(((params || {}).name) || '');
    const r = await callTool(name, (params || {}).arguments);
    if (!r.ok) return reply(id, { content: [{ type: 'text', text: r.error }], isError: true });
    const out = r.result || {};
    return reply(id, { content: [{ type: 'text', text: JSON.stringify(out) }], isError: out.ok === false });
  }
  if (!hasId) return;                                   // 别的通知一律忽略
  return fail(id, -32601, '不支持这个方法：' + String(method).slice(0, 60));
}

function start() {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (e) { logErr('收到不是 JSON 的一行'); write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); continue; }
      Promise.resolve(handle(msg)).catch(e => {
        logErr('处理失败 ' + (e && e.message));
        if (msg && msg.id !== undefined && msg.id !== null) fail(msg.id, -32603, String((e && e.message) || e).slice(0, 200));
      });
    }
  });
  process.stdin.on('end', () => process.exit(0));
  logErr('已启动，数据目录 ' + dataDir());
}

if (require.main === module) start();
module.exports = { toMcp, listTools, callTool, handle, SUPPORTED, LATEST, SERVER_INFO };
