'use strict';
// 会后一屏认人：清单是数出来的，不问模型。
// 谁还没名字、他说了哪几句、候选人是谁——都能从转写和日历里直接算，交给模型只会多一次等待和一次瞎猜。

const SPK_KEY = /^[A-Za-z0-9_]{1,12}$/;          // 说话人编号：聚类号（0、1、8…）或双路模式的 me / them
const MAX_NAME = 40;
const SAMPLES = 3;                                // 一个人给几段声音：2–3 段够认人，再多就变成听会了
const MIN_CLIP = 3, MAX_CLIP = 12;                // 一段试听的秒数上下限

const spkOf = row => String(row.speaker || row.spk || row.who || '');

// 转写里的 at 两种口径：pending 是相对秒，归档后的 enhanced 是绝对毫秒。按量级认，别按字段名认。
function secOf(at, start) {
  at = Number(at || 0); if (!at) return null;
  return at > 1e11 ? Math.round((at - start) / 1000) : Math.round(at);
}

// 一段试听多长：优先用下一句的开始时间，没有下一句就按字数估（中文约 4.5 字/秒），再夹到 3–12 秒
function clipLen(sec, nextSec, text) {
  let d = nextSec != null && nextSec > sec ? nextSec - sec : Math.round(String(text || '').length / 4.5);
  return Math.max(MIN_CLIP, Math.min(MAX_CLIP, d || MIN_CLIP));
}

// 团队名单从 app/context-pack.js 的 roster() 来：认人的候选名和处理台拟日历用的必须是同一份名单、
// 同一套解析，否则「名单里有这个人」在两个页面会给出两种答案。这里不再自己读文件。
// 候选人名：这场日历的参会人排前面（最可能），团队名单补后面；已经用掉的名字不再出现。
function candidatesFor({ attendees = [], team = [], used = [] }, max = 6) {
  const seen = new Set(used.map(x => String(x || '').trim()).filter(Boolean)), out = [];
  for (const raw of [...attendees, ...team]) {
    const n = String(raw || '').trim();
    if (!n || n.length > MAX_NAME || seen.has(n)) continue;
    seen.add(n); out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

// 一场会的认人清单。未命名的排前面（那是要你动手的），同组按说得多少排。
// opts.team：团队名单里的名字（contextPack.roster(env).names），调用方给；不给就只用日历参会人。
function list(session, opts = {}) {
  const s = session || {}, names = s.names || {};
  // start 两种写法：pending 存 ISO 字符串，归档结果存毫秒数。按类型认，认错了整列时间戳会差 55 年。
  const start = typeof s.start === 'number' ? s.start : (Date.parse(s.start) || 0);
  const tr = Array.isArray(s.transcript) ? s.transcript : [];
  const secs = tr.map(r => secOf(r.at, start));
  const by = new Map();
  tr.forEach((r, i) => {
    const k = spkOf(r); if (!k || !SPK_KEY.test(k)) return;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push({ i, sec: secs[i], text: String(r.text || '') });
  });
  const team = Array.isArray(opts.team) ? opts.team : [];
  const rows = [...by.entries()].map(([spk, lines]) => {
    const isSelf = spk === 'me';                          // 双路模式下麦克风那一路就是本人，这是会中就定死的，不是猜的
    const named = typeof names[spk] === 'string' && names[spk].trim() ? names[spk].trim() : '';
    const samples = lines.filter(x => x.sec != null && x.text.length >= 8)
      .sort((a, b) => b.text.length - a.text.length).slice(0, SAMPLES)
      .sort((a, b) => a.sec - b.sec)
      .map(x => ({ start: x.sec, dur: clipLen(x.sec, secs[x.i + 1] != null ? secs[x.i + 1] : null, x.text), text: x.text.slice(0, 40) }));
    return { spk, name: named || (isSelf ? '本人' : ''), confirmed: !!named, isSelf, lines: lines.length, samples, candidates: [] };
  });
  const used = rows.map(r => r.confirmed ? r.name : '').filter(Boolean);
  const pool = candidatesFor({ attendees: opts.attendees || [], team, used }, 6);
  for (const r of rows) r.candidates = r.confirmed ? [] : pool.slice();
  rows.sort((a, b) => (a.name ? 1 : 0) - (b.name ? 1 : 0) || b.lines - a.lines || String(a.spk).localeCompare(String(b.spk)));
  return rows;
}

// 校验要写盘的名字。空串是「清掉这个名字」，合法。
function clean(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('names 要是对象');
  const entries = Object.entries(raw);
  if (entries.length > 40) throw Error('一次最多改 40 个说话人');
  const out = {};
  for (const [k, v] of entries) {
    if (!SPK_KEY.test(k)) throw Error('说话人编号不对：' + String(k).slice(0, 12));
    if (typeof v !== 'string') throw Error('名字要是文字');
    const n = [...v].filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join('').trim();   // 控制字符剔掉
    if (n.length > MAX_NAME) throw Error('名字最多 ' + MAX_NAME + ' 个字');
    out[k] = n;
  }
  return out;
}

module.exports = { list, clean, candidatesFor, secOf, clipLen, SPK_KEY, MAX_NAME };
