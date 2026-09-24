'use strict';
// 会后页 v2 的默认负责人（Aaron 2026-09-24 拍板）：洞察 / 下一步按主题关键词打标，标不出就是 Aaron 自己。
// 真源是 app/owners.json（名字），open_id 由 person-handoff 那边用 lark.resolveIds 解析，这里不管。
const fs = require('fs'), path = require('path');
let cache = null;
function table() {
  if (cache) return cache;
  // 个人版放数据目录（含同事名字，不随包公开）；包里那份只是空默认
  const mine = process.env.THT_OWNERS_FILE || (process.env.THT_DATA_DIR ? path.join(process.env.THT_DATA_DIR, 'owners.json') : '');
  for (const f of [mine, path.join(__dirname, 'owners.json')].filter(Boolean)) {
    try { cache = JSON.parse(fs.readFileSync(f, 'utf8')); break; } catch (e) {}
  }
  if (!cache) cache = { 默认: '' };
  return cache;
}
// 顺序即优先级：一段文字同时提到 Pin 和 UI 时算硬件（硬件问题通常卡在前面）。
const RULES = [
  ['硬件', /摄像头|相机|Pin\b|sensor|传感器|ISP|功耗|电池|像素|MP\b|手板|结构|ID\b|屏幕/i],
  ['高通路标', /高通|Qualcomm|SM7750|路标|roadmap|芯片平台|SoC/i],
  ['软件', /\bOS\b|AIOS|\bapp\b|应用|交互|UI\b|界面|软件|Agent|模型/i],
];
function classify(text) {
  const s = String(text || '');
  for (const [topic, re] of RULES) if (re.test(s)) return { topic, owner: table()[topic] || table()['默认'] || 'Aaron Wang' };
  return { topic: '默认', owner: table()['默认'] || 'Aaron Wang' };
}
module.exports = { classify, table };
