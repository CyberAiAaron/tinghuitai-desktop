'use strict';
// 会中分诊提速（主动智能需求单 · 批 5，Aaron 2026-09-22 拍板）。
//
// 09-22 14:23 那场实测（events.log / state/usage.jsonl）：每次 Sonnet 分诊中位 26.8 s / p90 39 s，
// 输出 token 中位 2,031、顶到 2000 上限（日志里有「JSON 被截断」），输入中位 29k token。
// 输出是大头：模型按 ~50 token/s 吐字，2000 token 就是 40 秒。所以先砍输出，再砍输入。
//
// 这个文件只放纯函数和一个小状态机，server.js 的 runTriageBody 调它们；不碰网络、不读文件。
//   ① existedSummary   已有条目只传 id + 前 20 字（原来整条 JSON 回传，20 条要点 + 20 待办 + 20 看法能到几千字）
//   ② outputRules      提示词尾巴：只输出新增；text ≤40 字、why ≤30 字、evidence 只引原句片段 ≤40 字
//   ③ MAX_OUTPUT_TOKENS 700（原 2000）。只对接口那条路（app/llm.js openai，max_tokens）生效；claude 命令行不设硬上限——
//      实测 CLAUDE_CODE_MAX_OUTPUT_TOKENS 超限是整次报错不是截断（见 app/cli-llm.js 头注）。
//   ③b liveThinking     分诊关思考（LLM_LIVE_THINKING 默认 '0'）。这一条不在 Aaron 拍板的六项里，是实测后加的：
//      那 2,000 多输出 token 里大半是思考（一次 4 条要点正文 212 字、output_tokens 2,278），提示词瘦身砍不到它；不关思考到不了 ≤10 s。
//   ④ gateWindow       Jev 命中触发的分诊：只带命中句 ±5 句 + 还没分诊过的增量，不再整段 8000 字
//   ⑤ PackDelta        项目背景 / 记忆块一场会只在第一次分诊全量带；之后 hash 不变就换成一行占位，用量账 contextDelta 记 same / full
//   ⑥ triageInterval   JEV_GATE=on → 120 s 兜底、只补漏；off → 25 s 全量（与改前一致）
//
// ⚠️ ⑤ 的前提是模型「记得上一次」。claude -p 每次都是新进程，模型其实看不到上一次那份资料；
//    占位省的是输入 token，代价是那一轮没有项目背景可对照（conflict / answer 类洞察会少）。这是 Aaron 拍板的取舍，
//    回放对照（scripts/replay-triage.js --compare）把两组的条目数并排给他看。
const crypto = require('crypto');

const MAX_OUTPUT_TOKENS = 700;
const INTERVAL_GATE_ON_MS = 120000;
const INTERVAL_GATE_OFF_MS = 25000;
const HIT_WINDOW = 5;
const SUMMARY_CHARS = 20;
const KEEP_EXISTED = 20;

// ⑥ 定时器间隔：门卫开着就只兜底
function triageInterval(gateEnabled) { return gateEnabled ? INTERVAL_GATE_ON_MS : INTERVAL_GATE_OFF_MS; }

// ③b 分诊的思考预算：LLM_LIVE_THINKING '0' → 0（关）；'' / 缺 → undefined（不干预）；正整数 → 该数；其他非法值 → undefined
function liveThinking(env) {
  const raw = env && env.LLM_LIVE_THINKING;
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  const n = Number(raw); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

// ① 已有条目摘要：非 stale、各留最近 20 条、每条 id + 前 20 字。给模型去重用，不需要全文。
function existedSummary({ highlights, todos, factchecks } = {}, { keep = KEEP_EXISTED, chars = SUMMARY_CHARS } = {}) {
  const brief = (arr, key) => (Array.isArray(arr) ? arr : []).filter(x => x && !x.stale).slice(-keep)
    .map(x => ({ id: String(x.id || ''), [key]: String(x[key] || '').slice(0, chars) }));
  return JSON.stringify({ highlights: brief(highlights, 'text'), todos: brief(todos, 'text'), factchecks: brief(factchecks, 'claim') });
}

// ② 输出瘦身规则（进 system 尾部，语言锁之前）。sweep = 定时兜底那一轮（门卫开着时）：只补上一轮 Jev 没触发的遗漏。
function outputRules({ enUI = false, sweep = false } = {}) {
  const zh = '\n\n【输出瘦身】只输出【新增】条目，已有条目一条都不要回显；每条字段都写短句：text ≤40 字、why ≤30 字、evidence 只引原句片段 ≤40 字、claim ≤40 字；没有新增就返回各字段为空数组的 JSON。'
    + (sweep ? '\n【兜底轮】这一轮是定时补漏：只补上一轮逐句门卫没触发到的遗漏，门卫已经触发过分诊的句子不要再出条目。' : '');
  const en = '\n\n[Output budget] Output ONLY new items; never echo existing ones. Keep every field short: text ≤40 chars, why ≤30 chars, evidence a verbatim fragment ≤40 chars, claim ≤40 chars; return empty arrays when nothing is new.'
    + (sweep ? '\n[Sweep round] This is the periodic fallback: only fill gaps the sentence gate did not trigger on; do not re-emit items for sentences the gate already handled.' : '');
  return enUI ? en : zh;
}

// ④ 门卫触发时喂给模型的转写行下标：未分诊增量 [lastTriageIndex, endIndex) ∪ 每个命中句 ±window。升序、去重。
function gateWindow({ marks = [], lastTriageIndex = 0, endIndex = 0, window = HIT_WINDOW } = {}) {
  const keep = new Set();
  for (let i = Math.max(0, lastTriageIndex); i < endIndex; i++) keep.add(i);
  for (const m of marks) {
    if (!m || !(m.idx >= 0) || m.idx >= endIndex) continue;
    for (let i = Math.max(0, m.idx - window); i <= Math.min(endIndex - 1, m.idx + window); i++) keep.add(i);
  }
  return [...keep].sort((a, b) => a - b);
}

// ⑤ 一场会一个 PackDelta：第一次全量，之后 hash 相同就给占位行。hash 变了（记忆块 4 分钟刷新、文件改了）重带全文并记新 hash。
class PackDelta {
  constructor() { this.lastHash = ''; this.full = 0; this.same = 0; }
  apply(pack) {
    if (!pack || !pack.text) return pack;
    if (pack.hash && pack.hash === this.lastHash) {
      this.same++;
      return { ...pack, delta: 'same', fullChars: pack.text.length,
        text: `【本机资料】同上一次分诊（资料 hash ${pack.hash} 未变，本轮未重带）\n`, chars: 0 };
    }
    this.lastHash = pack.hash || ''; this.full++;
    return { ...pack, delta: 'full' };
  }
  snapshot() { return { lastHash: this.lastHash, full: this.full, same: this.same }; }
}

const hashOf = text => crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 12);

module.exports = { MAX_OUTPUT_TOKENS, INTERVAL_GATE_ON_MS, INTERVAL_GATE_OFF_MS, HIT_WINDOW, SUMMARY_CHARS,
  triageInterval, liveThinking, existedSummary, outputRules, gateWindow, PackDelta, hashOf };
