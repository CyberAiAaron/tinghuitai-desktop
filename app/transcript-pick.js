'use strict';
// D5（2026-09-22）：同一场会的转写在盘上最多有 5 份（pending 的 sess-/offline- 两种文件名、
// 会后管线的结果、工作台的副本、exports 的调试残留），而「用哪一份」以前在三个地方各写各的：
//   回看页 /meetings：有收敛 4 分 + 有过审 2 分 + 有转写 1 分，分高的赢
//   工作台 syncDisk：转写条数 + 总结字数，大的赢
//   分享 loadSession：只比转写条数，多的赢
// 留错的后果不一样：前两处留错 → 「已整理」显示成「没整理」；第三处留错 → 发出去的逐字稿缺几分钟。
// 收成这一份，三处都调它。
//
// 两个函数，因为它们回答的是两个不同的问题（都写在这里，不再散开）：
//   better(a,b)          同一场有两份「记录」，留哪一份整条（回看页、工作台）
//   pickTranscript(a,b)  两份记录都要用，只问「逐字稿取谁的」（分享）
//
// better 的排序以回看页那处为准（收敛 > 过审 > 有转写），后面补两级平手判据：
// 转写条数、总结字数。补这两级是为了不把工作台原来的行为弄丢——它比的就是条数，
// 只按回看页那三档会在「两份都只有转写」时变成看 readdir 顺序，可能留下被截断的那份。
function score(o) {
  if (!o) return -1;
  return (o.condensed ? 4 : 0) + (o.review ? 2 : 0) + ((o.transcript || []).length ? 1 : 0);
}
function rank(o) {
  return [score(o), (o.transcript || []).length, String(o && o.summary || '').length];
}
// 打平时留 a（调用方按「先遇到的」传第一个参数，结果就是稳定的）
function better(a, b) {
  if (!a) return b; if (!b) return a;
  const ra = rank(a), rb = rank(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i] ? a : b;
  return a;
}
// 分享那处问的不是「哪份记录更全」而是「逐字稿取谁的」：会后管线那份做过纠错合并，
// pending 那份可能多出最后几分钟。这里只比条数，多的赢——按 better 排会因为管线那份有收敛
// 而直接赢下，发出去的逐字稿反而变短，那是实打实的丢内容。
// 平手时用 b：调用方把「默认那份」（质量更好的，比如做过纠错合并的管线结果）放第二个参数。
function pickTranscript(a, b) {
  const ta = (a && a.transcript) || [], tb = (b && b.transcript) || [];
  return ta.length > tb.length ? ta : tb;
}
module.exports = { score, rank, better, pickTranscript };
