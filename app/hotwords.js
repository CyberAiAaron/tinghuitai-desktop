'use strict';
// 热词合并（纯函数，server.js sendConfig 调用）。三道闸，顺序固定：
//   ① 单词：去首尾空白，空的丢；超过 MAX_WORD_CHARS 字符的丢（超长词不是热词，是脏数据）
//   ② 去重：按原样字符串去重，先来的留（词表 > 简报 > 参会人，调用方按这个顺序传）
//   ③ 总量：条数 ≤ cap；所有词字符数之和 ≤ maxTotal，超出从后面按顺序截掉
const HOTWORD_CAP = 15;           // 火山当前接受的条数，验证过再谈扩容
const MAX_WORD_CHARS = 20;        // 单个热词最多 20 字符（中文按字算）
const MAX_TOTAL_CHARS = 1500;     // 全部热词字符总和上限（15 × 20 = 300 远在其下；防未来扩 cap 时忘了总量）

function mergeHotwords(lists, opts = {}) {
  const cap = Number.isFinite(opts.cap) ? opts.cap : HOTWORD_CAP;
  const maxWord = Number.isFinite(opts.maxWordChars) ? opts.maxWordChars : MAX_WORD_CHARS;
  const maxTotal = Number.isFinite(opts.maxTotalChars) ? opts.maxTotalChars : MAX_TOTAL_CHARS;
  const out = [], seen = new Set(); let total = 0;
  for (const list of Array.isArray(lists) ? lists : []) {
    for (const x of Array.isArray(list) ? list : []) {
      const w = String(x == null ? '' : x).trim();
      if (!w) continue;
      const len = [...w].length;
      if (len > maxWord) continue;
      if (seen.has(w)) continue;
      if (out.length >= cap || total + len > maxTotal) return out;
      seen.add(w); out.push(w); total += len;
    }
  }
  return out;
}

module.exports = { mergeHotwords, HOTWORD_CAP, MAX_WORD_CHARS, MAX_TOTAL_CHARS };
