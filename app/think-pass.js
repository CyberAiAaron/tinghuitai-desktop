// 思考档（0.6.18，Aaron 2026-09-24 口述）：会中每隔一会儿让强模型（默认 fable）就最近这几段
// 想三件事——我们的目的是什么、现在在聊什么、可能的最佳方案是什么——写成「看法」推到看法栏。
// 与分诊（app/triage-fast.js）分开跑：分诊管要点 / 待办，思考档只管看法；0.6.14 的洞察门槛（insight-filter）
// 拦得太死（09-22 上线后 48 轮 0 条），这里只做四道轻门：claim 非空、不是套话、不与已有看法重复、字数上限。
// 节奏是目标不是死规矩：约 1 分钟 2 条 —— 每 THINK_INTERVAL_MS 看一次，新转写 ≥ THINK_MIN_CHARS 才叫模型，每次最多 MAX_ITEMS 条。
const THINK_INTERVAL_MS = 40000;    // 每轮最多 2 条 → 上限 3 条/分钟，实际被去重压到 1–2 条（Codex 6c7a525e：30 s 会到 4 条/分钟）
const THINK_MIN_CHARS = 120;
const MAX_ITEMS = 2;
const MAX_OUTPUT_TOKENS = 900;
const RECENT_CHARS = 3200;            // 最近这么多字进模型（含上一轮看过的一部分，让它有上下文）
const KINDS = ['goal', 'best', 'doubt', 'remind', 'answer'];
const LABEL = { goal: '目的', best: '最佳方案', doubt: '存疑', remind: '提醒', answer: '递答案' };
const JUNK = /无法核实|不可核实|无从核实|需要?确认|建议进一步|值得关注|很重要|有帮助|cannot verify/i;

function norm(s) { return String(s || '').replace(/[\s“”"'‘’「」『』（）()，。、,.!?！？：:；;…—\-]/g, '').toLowerCase(); }
function similar(a, b) { a = norm(a); b = norm(b); if (!a || !b) return false; if (a === b) return true; const s = a.length < b.length ? a : b, l = a.length < b.length ? b : a; if (s.length >= 8 && l.includes(s)) return true; let hit = 0; for (let i = 0; i + 6 <= s.length; i += 3) if (l.includes(s.slice(i, i + 6))) hit++; return hit * 3 >= s.length * 0.6; }

function systemPrompt(enUI) {
  if (enUI) return 'You are Aaron\'s product-thinking partner sitting in his meeting. Read the latest transcript together with the project material, and THINK: (1) what is the real purpose behind what is being discussed, (2) what exactly are they debating right now, (3) what is the best option and why, (4) anything the project material already answers or contradicts, (5) any question raised in the room that nobody answered (or answered "not researched yet"): answer it yourself (kind=answer) with concrete numbers or a conclusion from your own knowledge, and say in note that it is model knowledge, not project material. Output JSON only: {"views":[{"kind":"goal|best|doubt|remind|answer","claim":"≤40 chars, one sharp sentence","note":"≤90 chars: why, the reasoning or the source","evidence":"≤30 chars verbatim from the transcript that triggered this"}]}. Up to ' + MAX_ITEMS + ' views per round, each one must add information the listener does not already have. No filler like "worth attention", no "cannot verify". Never repeat an existing view. Write claim/note in English.';
  return '你是 Aaron 的产品思考搭档，和他一起坐在会上。读最新转写和项目资料，真正地想：① 这段讨论背后我们的目的是什么；② 现在到底在争什么；③ 可能的最佳方案是什么、为什么；④ 项目资料里有没有已经答过或对不上的地方；⑤ 会上有人提了问题而没人答上、或答「没调研过 / 不清楚 / 回头查」——你就直接替他们答（kind=answer），用你自己的知识给具体数字或结论，note 里写明「这是模型知识，非项目资料」并给判断依据（Aaron 2026-09-24：会上的问题你能答就当场答）。只输出 JSON：{"views":[{"kind":"goal|best|doubt|remind|answer","claim":"≤40 字，一句有锋芒的话","note":"≤90 字：为什么，推理或出处","evidence":"≤30 字，触发这条的转写原话片段"}]}。每轮最多 ' + MAX_ITEMS + ' 条，每条要给出听的人还没有的信息：一个判断、一个方案、一个数字、一个对不上的地方。不写「值得关注 / 很重要 / 需确认 / 无法核实」这种空话，不纠听写，不重复【已有看法】。claim / note 用中文。';
}

function parse(raw) {
  const cleaned = String(raw || '').replace(/^```json?|```$/g, '').trim();
  let j = null; try { j = JSON.parse(cleaned); } catch (e) { const a = cleaned.indexOf('{'), b = cleaned.lastIndexOf('}'); if (a >= 0 && b > a) { try { j = JSON.parse(cleaned.slice(a, b + 1)); } catch (e2) {} } }
  return j && Array.isArray(j.views) ? j.views : [];
}

// 四道轻门 + 归一化。existing：这场已有的看法（claim 列表）。
function normalize(views, existing) {
  const out = [], seen = (existing || []).slice();
  for (const v of Array.isArray(views) ? views : []) {
    if (!v || typeof v !== 'object') continue;
    const claim = String(v.claim || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!claim || claim.length < 4) continue;
    const note = String(v.note || v.why || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    if (JUNK.test(claim) || JUNK.test(note)) continue;
    if (seen.some(c => similar(c, claim))) continue;
    let kind = String(v.kind || '').toLowerCase(); if (!KINDS.includes(kind)) kind = 'remind';
    const evidence = String(v.evidence || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    seen.push(claim);
    out.push({ kind: 'think', type: kind, label: LABEL[kind], claim, note, why: note, evidence, source: '', verdict: 'true', action: { do: 'none' } });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function userPrompt({ packText, existingClaims, recent, enUI }) {
  const ex = (existingClaims || []).slice(-12).map(c => '- ' + c).join('\n') || (enUI ? '(none)' : '（还没有）');
  return `${packText || ''}\n\n【已有看法】\n${ex}\n\n【最新转写】\n${recent}${enUI ? '\n\n(Write claim/note in English. JSON only.)' : '\n\n（claim / note 用中文，只输出 JSON。）'}`;
}

module.exports = { THINK_INTERVAL_MS, THINK_MIN_CHARS, MAX_ITEMS, MAX_OUTPUT_TOKENS, RECENT_CHARS, KINDS, LABEL, systemPrompt, userPrompt, parse, normalize, similar, norm };
