'use strict';
// 用本机已经装好、已经登录的 AI 命令行来跑分析，用户不用申请 API Key、不用充值。
// 支持 Codex（ChatGPT 登录）和 Claude Code（Claude 订阅）。两者都是只读沙箱，只让它读本场材料。
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
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
  // THT_CODEX_BIN / THT_CLAUDE_BIN：指定用哪个可执行文件。测试拿它挂假命令行，
  // 装在别处的人也能靠它指路（不设就按下面的常见位置找）。
  const forced = String(process.env['THT_' + kind.toUpperCase() + '_BIN'] || '').trim();
  if (forced) { try { fs.accessSync(forced, fs.constants.X_OK); return forced; } catch (e) { return ''; } }
  for (const p of CANDIDATES[kind] || []) { try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (e) {} }
  return '';
}

// —— Codex 净室 ——
// Claude 那条早就是净室启动了（--setting-sources ''、--strict-mcp-config、工具只留 Read）。
// Codex 这条原来只有 --sandbox read-only，它会把 $CODEX_HOME/config.toml 里配的 MCP 全连上、
// 把 $CODEX_HOME/AGENTS.md（Aaron 那份几千字的全局规则）当成系统指令带进去。
// 那就违反了「模型知道的一切只来自引擎递给它的那份输入」：同一段会议材料，换台机器结果不一样，
// 而且它凭什么看到那些东西没人说得清。所以给它一个干净的家。
// 依据 codex-cli 0.155.0-alpha.9.2 的 `codex exec --help`：
//   --ignore-user-config  不读 $CODEX_HOME/config.toml（MCP 就配在那儿），auth 仍然从 CODEX_HOME 取
//   --ignore-rules        不读用户 / 项目的 execpolicy .rules
//   --ephemeral           不往盘上写会话文件
//   -c project_doc_max_bytes=0   项目文档（AGENTS.md）一个字都不带（这是 config.toml 里的真实键，默认 32768）
// 全局 AGENTS.md 读的是 CODEX_HOME 底下那份，--ignore-user-config 管不着它，所以还要换家：
// <数据目录>/state/codex-home 里只软链一个 auth.json，别的什么都没有。
function codexHome(dataDir) {
  if (!dataDir) return '';
  try {
    const real = path.join(os.homedir(), '.codex', 'auth.json');
    if (!fs.existsSync(real)) return '';        // 没有这份凭证就别换家，不然直接登不上
    const dir = path.join(dataDir, 'state', 'codex-home');
    fs.mkdirSync(dir, { recursive: true });
    const link = path.join(dir, 'auth.json');
    let cur = null; try { cur = fs.readlinkSync(link); } catch (e) {}
    if (cur !== real) { try { fs.rmSync(link, { force: true }); } catch (e) {} fs.symlinkSync(real, link); }
    return dir;
  } catch (e) { return ''; }                    // 建不出来就退回原来的家，宁可带上规则也别调不起来
}
// —— 第三种命令行（kind:'custom'）——
// 只从配置来：bin / args / stdin / promptArg / outputJson（见 app/llm.js 的 normalize）。
// 加第三家不改代码，改设置就行（Aaron 2026-09-22：「我现在优先调用 Claude 和 codex 不代表以后我不调用别的」）。
// 净室同样适用：cwd 是数据目录，环境变量只留下面这三个——别的（AI 厂商的 key、代理设置、
// 各种 *_HOME）都不传，不然「模型知道的一切只来自引擎递给它的那份输入」这条就破了。
const CUSTOM_ENV_KEYS = ['PATH', 'HOME', 'LANG'];
function customEnv() {
  const e = {};
  for (const k of CUSTOM_ENV_KEYS) if (process.env[k] != null) e[k] = process.env[k];
  return e;
}
const slot = (s, prompt, model) => String(s).split('{prompt}').join(prompt).split('{model}').join(model || '');
function customArgs(spec, { prompt, model }) {
  const a = (spec.args || []).map(x => slot(x, prompt, model));
  if (spec.promptArg) a.push(slot(spec.promptArg, prompt, model));
  return a;
}
// outputJson:'a.b.0.c' —— stdout 是 JSON 时按点号路径取正文；取不到就当没拿到。
function digPath(obj, route) {
  let cur = obj;
  for (const k of String(route).split('.')) {
    if (cur == null) return null;
    cur = Array.isArray(cur) && /^\d+$/.test(k) ? cur[Number(k)] : cur[k];
  }
  if (cur == null) return null;
  return typeof cur === 'string' ? cur : JSON.stringify(cur);   // 有的命令行把答案直接放成 JSON 对象，不是字符串
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

// Codex 按用途给推理强度（M1，09-25）：会中要快、会后要稳、思考档要深。和 Claude 那条「live 关思考、think 给预算」同一个意思。
// codex exec 没有 --effort，推理强度是 config 键 model_reasoning_effort（-c 覆盖），模型走 -m。
const CODEX_EFFORT = { live: 'low', quick: 'low', triage: 'low', post: 'medium', think: 'high', verify: 'medium', 'insight-deep': 'high' };
function args(kind, { model = '', system = '', tools, purpose = '' } = {}) {
  if (kind === 'codex') {
    const a = ['exec', '--sandbox', 'read-only', '--skip-git-repo-check',
      '--ignore-user-config', '--ignore-rules', '--ephemeral', '-c', 'project_doc_max_bytes=0'];
    if (model) a.push('-m', model);
    if (CODEX_EFFORT[purpose]) a.push('-c', 'model_reasoning_effort="' + CODEX_EFFORT[purpose] + '"');
    a.push('-');
    return a;
  }
  const a = ['-p', '--output-format', 'json'];
  if (model) a.push('--model', model);
  a.push(
    '--setting-sources', '',          // 不读 ~/.claude 的 settings、CLAUDE.md、skill
    '--strict-mcp-config',            // 不连任何 MCP
    '--disable-slash-commands',       // 不加载 skill
    // 工具表：默认只留 Read（工具描述是大头）；tools === false → 一个都不给（会中分诊用：09-24 回放实测模型会去 Read 文件，
    // 一次分诊 1,971 输出 token 里正文只有 271 字、耗时 35 s，全是多轮工具调用；分诊只要读 prompt 里的资料，不该翻盘）
    // tools === 'web'：只给会中核查 / 思考档（M6，09-25 Aaron 定联网核查）：多给 WebSearch、WebFetch，其余照旧禁。
    ...(tools === false ? ['--tools', ''] : tools === 'web' ? ['--tools', 'Read,WebSearch,WebFetch', '--allowedTools', 'Read,WebSearch,WebFetch'] : ['--tools', 'Read', '--allowedTools', 'Read']),
    '--disallowedTools', tools === 'web' ? 'Bash,Edit,Write' : 'Bash,Edit,Write,WebFetch,WebSearch',
    '--system-prompt', system || MIN_SYSTEM,
  );
  return a;
}

// 返回 { ok, text, reason, usage, model }。reason 是失败原因码，给红条和日志用，不给用户看原文。
// 失败原因码：not_installed / spawn_failed / timeout / proc_error / cli_exit_<码> / cli_is_error / empty / bad_json
// thinking：claude 命令行的思考预算，走 MAX_THINKING_TOKENS 环境变量；0 = 关掉思考（批 5 提速：会中分诊用）。undefined = 不设，沿用命令行默认。
//   实测 2026-09-22（haiku 同一题）：MAX_THINKING_TOKENS=0 → thinking 0 / api 1.2 s；不设 → thinking 107 / api 2.3 s。
//   会中分诊那 2,000 多输出 token 里大半是思考（一次 4 条要点、正文 212 字，output_tokens 2,278），所以 max_tokens 砍不到它。
// ⚠️ 没走 CLAUDE_CODE_MAX_OUTPUT_TOKENS 限输出：实测超限时 claude -p 直接 is_error「exceeded the N output token maximum」，
//   整次调用报废而不是截断——比原来「截断 + 抢救」更糟，而且思考 token 也算在里面。输出上限只对接口那条路（app/llm.js openai）生效。
function askDetailed(kind, prompt, { dataDir, timeoutMs = 180000, log = () => {}, model = '', system = '', custom = null, thinking, tools, purpose = '' } = {}) {
  const spec = kind === 'custom' ? custom : null;
  if (kind === 'custom' && !spec) return Promise.resolve({ ok: false, reason: 'not_configured' });
  let bin = spec ? spec.bin : findBin(kind);
  if (spec) { try { fs.accessSync(bin, fs.constants.X_OK); } catch (e) { bin = ''; } }
  if (!bin) return Promise.resolve({ ok: false, reason: 'not_installed' });
  const full = system ? system + '\n\n' + prompt : prompt;
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    let p;
    const home = kind === 'codex' ? codexHome(dataDir) : '';
    try { p = spawn(bin, spec ? customArgs(spec, { prompt: full, model }) : args(kind, { model, system, tools, purpose }),
      spec ? { cwd: dataDir || process.cwd(), env: customEnv() }
           : { cwd: dataDir || process.cwd(), env: { ...process.env, CLAUDECODE: '', ...(home ? { CODEX_HOME: home } : {}),
               ...(kind === 'claude' && Number.isFinite(Number(thinking)) && thinking !== undefined && thinking !== null && thinking !== '' ? { MAX_THINKING_TOKENS: String(Math.max(0, Math.floor(Number(thinking)))) } : {}) } }); }
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
      if (spec) return finish(parseCustom(spec, out, log));
      finish(parseOut(kind, out, log));
    });
    // 系统提示词走 --system-prompt，stdin 只放本场材料；codex 和第三家命令行没有这个参数，拼进正文。
    try {
      if (spec && spec.stdin === 'none') p.stdin.end();
      else { p.stdin.write(spec || kind === 'codex' ? (system ? full : prompt) : prompt); p.stdin.end(); }
    } catch (e) {}
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

// 第三家命令行的输出：默认整个 stdout 就是回答；配了 outputJson 就按路径从 JSON 里取正文。
// 用量它不回（各家格式不一样，不猜），账本按字符数估，和其他命令行同一口径。
function parseCustom(spec, out, log) {
  if (!spec.outputJson) { const t = String(out || '').trim(); return t ? { ok: true, text: t } : { ok: false, reason: 'empty' }; }
  let d;
  try { d = JSON.parse(String(out).trim()); }
  catch (e) { log('cli-llm 第三家命令行的输出不是 JSON'); return { ok: false, reason: 'bad_json' }; }
  const t = (digPath(d, spec.outputJson) || '').trim();
  return t ? { ok: true, text: t } : { ok: false, reason: 'empty' };
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
      // 批 5：思考 token 和轮数也记下来——分诊慢在哪（思考 / 多轮工具调用 / 正文）以后账本上能直接看
      thinking: Number((u.output_tokens_details && u.output_tokens_details.thinking_tokens) || 0),
      turns: Number(d.num_turns || 0),
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

// 卡片对话框（app/card-thread.js）要起的是能用工具的那家命令行；牌子只在这里认，那边不写厂商名。
const agentBin = () => findBin('claude');
// 开箱自动选模型（2026-09-25，Aaron：「一定要保证试用的是能用」）：
// 全新安装时降级链是空的——会中不出卡、会后没有想法，用户还得自己找到设置页点一下。
// 启动时如果一个模型都没配（没选命令行、没 DeepSeek Key、没 LLM_CHAIN），就按 Claude Code → Codex 的顺序
// 真跑一次 probe，第一个跑通（装了且已登录）的写进 LLM_PROVIDER。都不通就什么也不写，首页照旧提示去设置页。
// 已经配过的一律不碰（用户的选择优先）。
async function autopick({ settings, cli = module.exports, log = () => {} }) {
  const c = settings.load();
  if (c.LLM_PROVIDER || c.DEEPSEEK_API_KEY || (Array.isArray(c.LLM_CHAIN) && c.LLM_CHAIN.length)) return { skipped: 'configured' };
  let found = {};
  try { found = cli.detect() || {}; } catch (e) { return { skipped: 'detect_failed' }; }
  for (const kind of ['claude', 'codex']) {
    if (!found[kind]) continue;
    let r = null;
    try { r = await cli.probe(kind, settings.dataDir); } catch (e) { r = { ok: false }; }
    if (r && r.ok) {
      const now = settings.load();
      if (now.LLM_PROVIDER) return { skipped: 'configured' };   // probe 期间用户自己选了
      now.LLM_PROVIDER = kind; settings.save(now); log(`开箱自动选模型：${kind}`);
      return { picked: kind };
    }
  }
  log('开箱自动选模型：本机没有已登录的 Claude Code / Codex');
  return { picked: '' };
}
module.exports = { CODEX_EFFORT, autopick, detect, findBin, codexHome, ask, askDetailed, probe, mainModel, agentBin, args };
