'use strict';
// 决策板当前口径摘要（主动智能批 2，F2）：会中「对不上」（conflict）只对照资料里**有具体数字 / 日期**的记录，
// 所以把飞书夜间导出的决策板（kb_backup/决策板D1-D8_YYYY-MM-DD.md，取最新一份）抽成 D1–D8 各一行、总长 ≤1500 字，
// 作为 live 资料包的一块（app/context-pack.js 的 TABLE.live），版本 = mtime + 内容 hash，随用量账落盘。
// 只读、不改文件；目录不在 / 没有导出文件 → {missing:true}，会照常开，只是没有这一块。
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const FILE_RE = /^决策板D1-D8_(\d{4}-\d{2}-\d{2})\.md$/;
const MAX_CHARS = 1500;
const expand = p => path.resolve(String(p).replace(/^~(?=\/)/, process.env.HOME || '~'));

// 目录：设置 DECISION_BOARD_DIR；没配就用 <PROJECT_CONTEXT_DIR>/kb_backup（夜间导出就落在那里）。
function boardDir(env = {}) {
  const explicit = String(env.DECISION_BOARD_DIR || '').trim();
  if (explicit) return expand(explicit);
  const ctx = String(env.PROJECT_CONTEXT_DIR || '').trim();
  return ctx ? path.join(expand(ctx), 'kb_backup') : '';
}

// 最新一份：按文件名里的日期排序（不是 mtime——夜间同步可能重写旧文件的 mtime）。
function latestFile(dir) {
  if (!dir) return '';
  let names; try { names = fs.readdirSync(dir); } catch (e) { return ''; }
  const dated = names.map(n => { const m = n.match(FILE_RE); return m ? { n, d: m[1] } : null; }).filter(Boolean).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
  return dated.length ? path.join(dir, dated[0].n) : '';
}

const cell = s => String(s || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => { const a = [...String(s || '')]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };

// 从 markdown 全文抽 D1–D8：找表头含「# | 决策 | … | 当前倾向 | … | 期限 | 状态」的那张表，每行 D 编号 → 一行摘要。
// 表头列名有变就按位置退化（第 1 列编号、第 2 列决策名、其余找「倾向 / 期限 / 状态」列）。
function extractRows(md) {
  const lines = String(md || '').split('\n');
  let header = null, out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('|')) { if (out.length) break; header = null; continue; }
    const cells = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map(cell);
    if (!header) { if (cells.some(c => /决策/.test(c)) && cells.some(c => /倾向|结论|口径/.test(c))) header = cells; continue; }
    if (cells.every(c => /^-*$/.test(c))) continue;                       // 分隔行
    if (!/^D[1-9]$/.test(cells[0] || '')) continue;
    const col = re => header.findIndex(h => re.test(h));
    const pick = (re, fallback) => { const i = col(re); return i >= 0 ? (cells[i] || '') : (fallback != null ? (cells[fallback] || '') : ''); };
    out.push({ id: cells[0], name: pick(/^决策$/, 1), lean: pick(/倾向|结论|口径/), owner: pick(/owner|负责/i), due: pick(/期限|截止/), state: pick(/状态/) });
  }
  return out;
}

// 版本行：文件开头「v1.1 ｜ 2026-09-05 …」这种抬头，有就带（模型据此知道这份口径是哪天的）。
function versionLine(md) {
  const m = String(md || '').match(/^v\d[^\n]{0,80}/m);
  return m ? cell(m[0]).slice(0, 80) : '';
}

// 各行先均分预算，再把省下的字让给长的那几行，总长封顶 MAX_CHARS。
function renderRows(rows, budget) {
  if (!rows.length) return '';
  const fixed = r => `${r.id} ${clip(r.name, 24)}：`.length + (r.due ? `｜期限 ${clip(r.due, 30)}`.length : 0) + (r.state ? `｜状态 ${clip(r.state, 20)}`.length : 0) + 1;
  let left = budget - rows.reduce((a, r) => a + fixed(r), 0);
  const per = Math.max(20, Math.floor(left / rows.length));
  return rows.map(r => `${r.id} ${clip(r.name, 24)}：${clip(r.lean, per)}${r.due ? `｜期限 ${clip(r.due, 30)}` : ''}${r.state ? `｜状态 ${clip(r.state, 20)}` : ''}`).join('\n');
}

// summarize(env) -> { text, source, version, syncedAt, date, rows } 或 { missing:true, source, reason }
function summarize(env = {}, opts = {}) {
  const dir = boardDir(env);
  const file = opts.file || latestFile(dir);
  if (!file) return { missing: true, source: dir || '(未配置 DECISION_BOARD_DIR / PROJECT_CONTEXT_DIR)', reason: dir ? '目录里没有 决策板D1-D8_YYYY-MM-DD.md' : '没配决策板目录' };
  let raw, st;
  try { st = fs.statSync(file); raw = fs.readFileSync(file, 'utf8'); } catch (e) { return { missing: true, source: file, reason: '读取失败' }; }
  const rows = extractRows(raw);
  if (!rows.length) return { missing: true, source: file, reason: '文件里没找到 D1–D8 表' };
  const date = (path.basename(file).match(FILE_RE) || [])[1] || '';
  const head = `决策板导出 ${date}${versionLine(raw) ? '（' + versionLine(raw) + '）' : ''}`;
  const max = Number(opts.maxChars) > 0 ? Number(opts.maxChars) : MAX_CHARS;
  const body = renderRows(rows, max - head.length - 1);
  const text = clip(head + '\n' + body, max);
  return { text, rows, date, source: file, syncedAt: new Date(st.mtimeMs).toISOString(),
    version: new Date(st.mtimeMs).toISOString() + '#' + crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8) };
}

module.exports = { summarize, extractRows, latestFile, boardDir, renderRows, MAX_CHARS, FILE_RE };
