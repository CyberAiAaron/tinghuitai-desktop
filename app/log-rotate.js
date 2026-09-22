'use strict';
// D7（2026-09-22）：events.log / usage.jsonl / view-feedback.jsonl 三份追加型文件从来不轮转。
// 一直涨下去的后果不是「占磁盘」，是每次 /meetings 都要把 usage.jsonl 整读一遍——文件越大页面越慢。
// 规矩：超过上限就改名成 <文件>.1（只留这一份，旧的 .1 直接被盖掉），原文件由下一次 append 重建。
// 为什么只留一份：这三份都是排查用的近期记录，不是台账；真要长期留存的是 work-hub / 会议 JSON。
const fs = require('fs');

const MAX = 10 * 1024 * 1024;
const lastCheck = new Map();   // 每行都 statSync 太浪费，按文件节流

function rotateIfBig(file, { max = MAX, everyMs = 60000, now = Date.now() } = {}) {
  if (!file) return false;
  const prev = lastCheck.get(file) || 0;
  if (now - prev < everyMs) return false;
  lastCheck.set(file, now);
  let size = 0;
  try { size = fs.statSync(file).size; } catch (e) { return false; }
  if (size <= max) return false;
  try { fs.renameSync(file, file + '.1'); return true; } catch (e) { return false; }
}

module.exports = { rotateIfBig, MAX };
