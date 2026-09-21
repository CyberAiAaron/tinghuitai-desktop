#!/usr/bin/env node
'use strict';
// 会后管线（Python）的模型入口：stdin 进一个 JSON，stdout 出一个 JSON，退出码 0 = 拿到正文。
//
// 为什么有这个文件：会中那条路是 Node 写的，早就只调 app/llm.js 这一层；会后那条路是 Python 写的，
// 以前它自己认 claude / codex / DeepSeek 三个牌子，换一家模型要改代码。现在 Python 只管起这个进程，
// 用哪家、降不降级、记多少账全由 settings 的 LLM_CHAIN 说了算，和服务端共用同一份 app/llm.js。
//
// 输入：{kind,system,user,maxTokens,noFallback,skip,sessionId,purpose,timeoutMs,temperature}
// 输出：{ok,text,provider,model,degraded,degradedReason,attempts,skipped,errorCode,error}
//   error 是已经能给人看的失败原因（哪几家、各自什么码），调用方直接往界面上放。
// 约定：stdout 只放这一行 JSON，日志一律走 stderr，不然协议会被日志撑坏。
const settings = require('./config');      // require 它就按 THT_DATA_DIR 建好目录、补 preset，和服务端同一套
const llm = require('./llm');

const log = m => { try { process.stderr.write(String(m) + '\n'); } catch (e) {} };

function readStdin() {
  return new Promise(resolve => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => { s += d; });
    process.stdin.on('end', () => resolve(s));
    process.stdin.on('error', () => resolve(s));
  });
}

// 失败原因写成人话：「Claude 没回应（claude:timeout）；通义 没回应（api:no balance）」。
// 一家都没配是另一回事，别说成「没回应」。
function reasonOf(r) {
  if (r.errorCode === 'no_provider') return '模型还没配好：设置里没有可用的模型';
  if (r.errorCode === 'chain_exhausted') return '降级链上可试的模型都已经试过了';
  const a = r.attempts || [];
  if (!a.length) return r.errorCode || '模型没有输出';
  return a.map(x => x.provider + ' 没回应（' + x.errorCode + '）').join('；');
}

(async () => {
  let req;
  try { req = JSON.parse((await readStdin()).trim() || '{}'); } catch (e) { req = null; }
  if (!req || typeof req !== 'object') {
    process.stdout.write(JSON.stringify({ ok: false, errorCode: 'bad_request', error: '模型请求不是合法 JSON' }) + '\n');
    return process.exit(2);
  }
  const tier = req.kind || 'post';
  const system = String(req.system || ''), user = String(req.user || '');
  let r;
  try {
    r = await llm.ask(settings.load(), {
      kind: tier, system, user,
      maxTokens: Number(req.maxTokens) || undefined,
      dataDir: settings.dataDir, log, fetchImpl: fetch,
      noFallback: !!req.noFallback,
      skip: Number(req.skip) || 0,
      timeoutMs: Number(req.timeoutMs) || 0,
      temperature: req.temperature == null ? undefined : Number(req.temperature),
    });
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, errorCode: 'ask_failed', error: String((e && e.message) || e).slice(0, 200) }) + '\n');
    return process.exit(1);
  }
  if (!r.text) {
    process.stdout.write(JSON.stringify({ ok: false, errorCode: r.errorCode || 'empty', error: reasonOf(r), attempts: r.attempts || [] }) + '\n');
    return process.exit(1);
  }
  llm.noteUsage(settings.dataDir, r, { system, user, tier, sessionId: String(req.sessionId || ''), purpose: String(req.purpose || '') });
  process.stdout.write(JSON.stringify({ ok: true, text: r.text, provider: r.provider || '', model: r.model || '',
    degraded: !!r.degraded, degradedReason: r.degradedReason || '', attempts: r.attempts || [], skipped: r.skipped || 0 }) + '\n');
  process.exit(0);
})();
