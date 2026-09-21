'use strict';
// 用本机已经装好、已经登录的 AI 命令行来跑分析，用户不用申请 API Key、不用充值。
// 支持 Codex（ChatGPT 登录）和 Claude Code（Claude 订阅）。两者都是只读沙箱，只让它读本场材料。
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CANDIDATES = {
  codex: [
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    path.join(process.env.HOME || '', '.local/bin/codex'),
    '/opt/homebrew/bin/codex', '/usr/local/bin/codex',
  ],
  claude: [
    path.join(process.env.HOME || '', '.local/bin/claude'),
    '/opt/homebrew/bin/claude', '/usr/local/bin/claude',
  ],
};

function findBin(kind) {
  for (const p of CANDIDATES[kind] || []) { try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (e) {} }
  return '';
}
// 装了不等于能用：没登录的话调用会失败。检测只回「装没装」，能不能用由一次真实试跑决定。
function detect() {
  const out = {};
  for (const kind of Object.keys(CANDIDATES)) { const bin = findBin(kind); if (bin) out[kind] = bin; }
  return out;
}

// 不给 --system-prompt 的话 claude 会加载它自己那套默认系统提示词 + 全部工具 + 用户设置，
// 实测 2026-09-20：默认 60,971 token / 次，换成下面这套 1,222 token / 次，同一句 READY 回答一致。
const MIN_SYSTEM = '你是会议记录分析助手。只输出被要求的内容，不解释、不寒暄。';

function args(kind, { model = '', system = '' } = {}) {
  if (kind === 'codex') return ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-'];
  const a = ['-p', '--output-format', 'json'];
  if (model) a.push('--model', model);
  a.push(
    '--setting-sources', '',          // 不读 ~/.claude 的 settings、CLAUDE.md、skill
    '--strict-mcp-config',            // 不连任何 MCP
    '--disable-slash-commands',       // 不加载 skill
    '--tools', 'Read',                // 工具表只留 Read，工具描述是大头
    '--allowedTools', 'Read',
    '--disallowedTools', 'Bash,Edit,Write,WebFetch,WebSearch',
    '--system-prompt', system || MIN_SYSTEM,
  );
  return a;
}

// 返回 { ok, text, reason, usage, model }。reason 是失败原因码，给红条和日志用，不给用户看原文。
// 失败原因码：not_installed / spawn_failed / timeout / proc_error / cli_exit_<码> / cli_is_error / empty / bad_json
function askDetailed(kind, prompt, { dataDir, timeoutMs = 180000, log = () => {}, model = '', system = '' } = {}) {
  const bin = findBin(kind);
  if (!bin) return Promise.resolve({ ok: false, reason: 'not_installed' });
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    let p;
    try { p = spawn(bin, args(kind, { model, system }), { cwd: dataDir || process.cwd(), env: { ...process.env, CLAUDECODE: '' } }); }
    catch (e) { log('cli-llm spawn 失败 ' + e.message); return finish({ ok: false, reason: 'spawn_failed' }); }
    let out = '', err = '';
    const timer = setTimeout(() => { log('cli-llm 超时 ' + kind); finish({ ok: false, reason: 'timeout' }); try { p.kill('SIGTERM'); } catch (e) {} setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, 2000); }, timeoutMs);
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('error', e => { clearTimeout(timer); log('cli-llm 出错 ' + e.message); finish({ ok: false, reason: 'proc_error' }); });
    p.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) { log('cli-llm 退出码 ' + code + ' ' + err.slice(0, 200)); return finish({ ok: false, reason: 'cli_exit_' + code, stderr: err.slice(0, 200) }); }
      if (!out.trim()) return finish({ ok: false, reason: 'empty' });
      finish(parseOut(kind, out, log));
    });
    // 系统提示词走 --system-prompt，stdin 只放本场材料
    try { p.stdin.write(kind === 'codex' && system ? system + '\n\n' + prompt : prompt); p.stdin.end(); } catch (e) {}
  });
}

// 一次调用的 modelUsage 里可能同时有主模型和它内部借用的小模型（如 Haiku）；
// 记账要记花得最多的那个，取第一个键会把 Sonnet 的调用记成 Haiku。
function mainModel(modelUsage) {
  let best = '', bestCost = -1;
  for (const [name, u] of Object.entries(modelUsage || {})) {
    const cost = Number(u && u.costUSD) || 0;
    const tokens = (Number(u && u.inputTokens) || 0) + (Number(u && u.outputTokens) || 0) + (Number(u && u.cacheReadInputTokens) || 0) + (Number(u && u.cacheCreationInputTokens) || 0);
    const score = cost > 0 ? cost * 1e9 : tokens;
    if (score > bestCost) { best = name; bestCost = score; }
  }
  return best;
}

function parseOut(kind, out, log) {
  if (kind === 'codex') { const t = clean(kind, out); return t ? { ok: true, text: t } : { ok: false, reason: 'empty' }; }
  let d;
  try { d = JSON.parse(out); }
  catch (e) {
    // CLI 换了输出格式也不能整条链路哑掉：有正文就降级当纯文本用，并把原因记进日志
    const t = String(out || '').trim();
    log('cli-llm 输出不是 JSON，降级按文本处理');
    return t ? { ok: true, text: t, reason: 'bad_json_fallback' } : { ok: false, reason: 'bad_json' };
  }
  if (d && d.is_error) { log('cli-llm is_error: ' + String(d.result || '').slice(0, 200)); return { ok: false, reason: 'cli_is_error', detail: String(d.result || '').slice(0, 200) }; }
  const text = String((d && d.result) || '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  const u = (d && d.usage) || {};
  return {
    ok: true, text,
    model: mainModel(d && d.modelUsage),
    usage: {
      in: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
      out: u.output_tokens || 0,
    },
  };
}

// 返回模型回复的纯文本；失败或超时返回 null，调用方自己退回 API 那条路。
function ask(kind, prompt, opts = {}) { return askDetailed(kind, prompt, opts).then(r => (r.ok ? r.text : null)); }

// codex exec 会在正文前后带上自己的运行日志，把它剥掉只留模型说的话
function clean(kind, out) {
  let s = String(out || '').trim();
  if (kind === 'codex') {
    s = s.replace(/^warning:[^\n]*\n/gm, '');
    const i = s.lastIndexOf('tokens used');
    if (i > 0) s = s.slice(0, i);
    s = s.replace(/^codex\s*$/gm, '').trim();
  }
  return s.trim() || null;
}

// 一次真实试跑，用来在设置页告诉用户「能用 / 不能用，为什么」
async function probe(kind, dataDir) {
  const bin = findBin(kind);
  if (!bin) return { ok: false, reason: 'not_installed' };
  const r = await askDetailed(kind, '只回这一行，不要别的：READY', { dataDir, timeoutMs: 120000 });
  if (!r.ok) return { ok: false, reason: r.reason || 'not_logged_in_or_failed', bin };
  const t = r.text || '';
  return { ok: /READY/i.test(t), reason: /READY/i.test(t) ? '' : 'unexpected_reply', bin, sample: t.slice(0, 80) };
}

module.exports = { detect, findBin, ask, askDetailed, probe, mainModel };
