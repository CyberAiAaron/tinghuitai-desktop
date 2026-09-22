#!/usr/bin/env node
'use strict';
// 会后管线（Python）的模型入口：stdin 进一个 JSON，stdout 出一个 JSON，退出码 0 = 拿到正文。
//
// 为什么有这个文件：会中那条路是 Node 写的，早就只调 app/llm.js 这一层；会后那条路是 Python 写的，
// 以前它自己认 claude / codex / DeepSeek 三个牌子，换一家模型要改代码。现在 Python 只管起这个进程，
// 用哪家、降不降级、记多少账全由 settings 的 LLM_CHAIN 说了算，和服务端共用同一份 app/llm.js。
//
// 输入：{kind,system,user,maxTokens,noFallback,skip,sessionId,purpose,timeoutMs,temperature,json,context}
//   json:true —— 这次要的是一个 JSON 对象；接口类会带上 response_format，命令行忽略这个参数。
//   context:{purpose,meetingId,memoryBlock} —— 带上它，本机资料由这边的 app/context-pack.js 拼好，
//   替换 system / user 里的占位符。Python 一侧不再自己找文件读资料：资料是什么、给多少字、
//   哪个用途能看什么，只由 context-pack 的那张表说了算，会中会后共用同一份。
// 输出：{ok,text,provider,model,degraded,degradedReason,attempts,skipped,errorCode,error,truncated,context}
//   error 是已经能给人看的失败原因（哪几家、各自什么码），调用方直接往界面上放。
//   context:{hash,chars,parts} —— 这次带了哪些资料、哪一版；Python 靠 chars>0 判断「带上背景没有」。
// 约定：stdout 只放这一行 JSON，日志一律走 stderr，不然协议会被日志撑坏。
const settings = require('./config');      // require 它就按 THT_DATA_DIR 建好目录、补 preset，和服务端同一套
const llm = require('./llm');
const contextPack = require('./context-pack');

// 占位符：Python 的 prompt 里留这两个记号，资料和那句「带没带上背景」的说明由这边填。
// 选 \x00 包起来是因为真实 prompt 里不可能出现空字符，不会误伤正文。
const CTX_SLOT = '\u0000CONTEXT\u0000', NOTE_SLOT = '\u0000CONTEXT_NOTE\u0000';
const fill = (s, text, note) => String(s || '').split(CTX_SLOT).join(text).split(NOTE_SLOT).join(note);

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
  // 先拼资料，再填进占位符。资料读不出来不该让这次调用整个失败：那就当没有资料，
  // 占位符替成空串，prompt 照发，parts 里留着缺哪一块（和会中那条路同一套规矩）。
  let pack = null;
  const want = req.context && req.context.purpose;
  if (want) {
    try {
      pack = contextPack.build(settings.load(), { purpose: String(req.context.purpose), dataDir: settings.dataDir,
        meetingId: String(req.context.meetingId || ''), memoryBlock: req.context.memoryBlock });
    } catch (e) { log('本机资料没拼出来（' + String((e && e.message) || e).slice(0, 120) + '），这次不带资料'); }
  }
  const system = fill(req.system, pack ? pack.text : '', pack ? pack.note : '');
  const user = fill(req.user, pack ? pack.text : '', pack ? pack.note : '');
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
      json: !!req.json,
    });
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, errorCode: 'ask_failed', error: String((e && e.message) || e).slice(0, 200) }) + '\n');
    return process.exit(1);
  }
  if (!r.text) {
    process.stdout.write(JSON.stringify({ ok: false, errorCode: r.errorCode || 'empty', error: reasonOf(r), attempts: r.attempts || [] }) + '\n');
    return process.exit(1);
  }
  llm.noteUsage(settings.dataDir, r, { system, user, tier, sessionId: String(req.sessionId || ''), purpose: String(req.purpose || ''), pack });
  process.stdout.write(JSON.stringify({ ok: true, text: r.text, provider: r.provider || '', model: r.model || '',
    degraded: !!r.degraded, degradedReason: r.degradedReason || '', attempts: r.attempts || [], skipped: r.skipped || 0,
    truncated: !!r.truncated, truncatedChars: r.truncatedChars || 0,
    context: pack ? { hash: pack.hash, chars: pack.chars, parts: pack.parts } : null }) + '\n');
  process.exit(0);
})();
