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

function args(kind, dataDir) {
  if (kind === 'codex') return ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-'];
  return ['-p', '--output-format', 'text', '--allowedTools', 'Read', '--disallowedTools', 'Bash,Edit,Write,WebFetch,WebSearch'];
}

// 返回模型回复的纯文本；失败或超时返回 null，调用方自己退回 API 那条路。
function ask(kind, prompt, { dataDir, timeoutMs = 180000, log = () => {} } = {}) {
  const bin = findBin(kind);
  if (!bin) return Promise.resolve(null);
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    let p;
    try { p = spawn(bin, args(kind, dataDir), { cwd: dataDir || process.cwd(), env: { ...process.env, CLAUDECODE: '' } }); }
    catch (e) { log('cli-llm spawn 失败 ' + e.message); return finish(null); }
    let out = '', err = '';
    const timer = setTimeout(() => { log('cli-llm 超时 ' + kind); finish(null); try { p.kill('SIGTERM'); } catch (e) {} setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, 2000); }, timeoutMs);
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('error', e => { clearTimeout(timer); log('cli-llm 出错 ' + e.message); finish(null); });
    p.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || !out.trim()) { log('cli-llm 退出码 ' + code + ' ' + err.slice(0, 200)); return finish(null); }
      finish(clean(kind, out));
    });
    try { p.stdin.write(prompt); p.stdin.end(); } catch (e) {}
  });
}

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
  const t = await ask(kind, '只回这一行，不要别的：READY', { dataDir, timeoutMs: 120000 });
  if (!t) return { ok: false, reason: 'not_logged_in_or_failed', bin };
  return { ok: /READY/i.test(t), reason: /READY/i.test(t) ? '' : 'unexpected_reply', bin, sample: t.slice(0, 80) };
}

module.exports = { detect, findBin, ask, probe };
