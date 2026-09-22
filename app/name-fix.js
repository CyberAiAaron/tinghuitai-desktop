'use strict';
// 静默纠名：转写里的人名听写错误（同音 / 近音 / 音译），按「本场参会人 + 团队名单」直接改，不弹卡片不打扰人。
// 只动名单里有的名字；别名 ≤1 字一律不收（会污染整场）；每条替换记 {seg, from, to}，页面一键撤销、撤销过的组合进 ignore 不再改。
// 别名三个来源：
//   ① 名单自动生成——拉丁名按读音键 + 编辑距离认近音（dearra→Daria）；中文名只认原样和去姓的名（中文同音要靠 ②③，这里没有拼音表）
//   ② state/name-aliases.json（人手维护：{"aliases":{"星宇":"新宇","露娜":"Luna"},"ignore":["星余→新宇"]}）
//   ③ 词表 lexicon 里 right 是名单名字的那些 wrong→right（服务端合并进来，这个文件不读库）
const fs = require('fs');

const CJK = /[㐀-鿿]/;
const isCjk = s => CJK.test(String(s || ''));
const chars = s => [...String(s || '')];
const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 会跟人名撞读音键的常用英文词：carry/Cary、cherry/Cherry、shown/Shawn……这些词不做近音替换（精确别名不受此限）
const COMMON_EN = new Set(('carry cherry shown shame share sharing lunch lunar learn line lean loan mark market marry merry many money'
  + ' dark dare dear deer door data date daily diary jane join june july jenny hand handy hannah harm hard hear here heard'
  + ' care car card cars case cash cause coil call cell cary carol color colour will well wall while bill bell ball'
  + ' sun sunny some same sam seem sure shore short sort store story star start state still steel style').split(' '));

function normName(s) { return String(s || '').replace(/（已拒绝）|\(declined\)/gi, '').replace(/\s+/g, ' ').trim(); }
// 拉丁名读音键：首字母 + 去元音 / h / y，再压掉重复字母（dearra→dr，Daria→dr，Luna→ln，Shawn→shwn）
function soundKey(w) {
  const s = String(w || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return '';
  return (s[0] + s.slice(1).replace(/[aeiouyh]/g, '')).replace(/(.)\1+/g, '$1');
}
function lev(a, b) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

// 名单 + 人手别名 → 匹配表。exact：整段精确替换（中文别名、人手写的任意别名，长的先替）；latin：按词近音匹配。
function buildTable(names, opts = {}) {
  const exact = new Map(), latin = [], seen = new Set();
  const nameSet = new Set();
  for (const raw of Array.isArray(names) ? names : []) {
    const n = normName(raw); if (!n) continue;
    if (isCjk(n)) {
      const full = n.replace(/\s/g, ''), len = chars(full).length;
      if (len < 2 || len > 6) continue;
      nameSet.add(full);
      // 三四字中文名去掉姓（复姓按两字算）也算一个可认的名：转写里「星宇说」比「刘星宇说」常见得多；输出仍是名本身，不扩写成全名
      if (len === 3 || len === 4) { const given = chars(full).slice(len === 4 ? 2 : 1).join(''); if (chars(given).length >= 2) nameSet.add(given); }
    } else {
      for (const t of n.split(' ')) {
        if (!/^[A-Za-z][A-Za-z'-]{1,}$/.test(t)) continue;
        const low = t.toLowerCase(); if (seen.has(low)) continue; seen.add(low);
        nameSet.add(t); if (t.length >= 3) latin.push({ name: t, low, key: soundKey(t) });
      }
    }
  }
  const aliases = opts.aliases && typeof opts.aliases === 'object' ? opts.aliases : {};
  for (const [w0, r0] of Object.entries(aliases)) {
    const w = normName(w0), r = normName(r0);
    if (!r || !w || w === r || chars(w).length < 2 || chars(w).length > 40) continue;
    exact.set(w, r);
  }
  const ignore = new Set((Array.isArray(opts.ignore) ? opts.ignore : []).map(String));
  return { exact, latin, ignore, names: nameSet };
}

// 对一段转写做替换。返回 {text, changes:[{from,to}]}；没动就 changes 为空、text 原样。
function fix(text, table) {
  let out = String(text || ''); const changes = [];
  if (!table || !out) return { text: out, changes };
  const skip = (f, t) => table.ignore.has(f + '→' + t) || table.ignore.has(String(f).toLowerCase() + '→' + t);
  // 精确别名：长的先替，免得「新宇」先吃掉「刘新宇」的一半
  const keys = [...table.exact.keys()].sort((a, b) => chars(b).length - chars(a).length);
  for (const k of keys) {
    const to = table.exact.get(k);
    if (k === to || !out.includes(k) && !(/^[A-Za-z]/.test(k) && out.toLowerCase().includes(k.toLowerCase())) || skip(k, to)) continue;
    const re = isCjk(k) ? new RegExp(escRe(k), 'g') : new RegExp('(?<![A-Za-z])' + escRe(k) + '(?![A-Za-z])', 'gi');
    const before = out; out = out.replace(re, () => to);
    if (out !== before) changes.push({ from: k, to });
  }
  // 拉丁近音：整词看。名单里已有的词（只是大小写不同）不算错；常用英文词不动；首字母要同、读音键要同、编辑距离 ≤1（长词 ≤2）
  if (table.latin.length) out = out.replace(/[A-Za-z][A-Za-z']{2,}/g, w => {
    const low = w.toLowerCase();
    if (table.latin.some(n => n.low === low) || COMMON_EN.has(low) || low.length < 4) return w;
    const key = soundKey(w);
    const hit = table.latin.find(n => n.key === key && n.low[0] === low[0] && lev(low, n.low) <= (low.length >= 6 ? 2 : 1));
    if (!hit || skip(w, hit.name)) return w;
    changes.push({ from: w, to: hit.name }); return hit.name;
  });
  return { text: out, changes };
}

// 人手别名文件：读不到就当空；写坏了不抛，日志一句就够（纠名只是锦上添花）
function readAliasFile(file) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return { aliases: j && typeof j.aliases === 'object' ? j.aliases : {}, ignore: Array.isArray(j && j.ignore) ? j.ignore.map(String) : [] }; }
  catch (e) { return { aliases: {}, ignore: [] }; }
}
function addIgnore(file, pairs) {
  const cur = readAliasFile(file);
  const set = new Set(cur.ignore);
  for (const p of pairs || []) { const k = p && p.from != null ? String(p.from) + '→' + String(p.to) : ''; if (k) set.add(k); }
  cur.ignore = [...set];
  try { fs.mkdirSync(require('path').dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(cur, null, 2)); fs.renameSync(tmp, file); } catch (e) {}
  return cur;
}

module.exports = { buildTable, fix, soundKey, lev, normName, readAliasFile, addIgnore };
