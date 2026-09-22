'use strict';
// L-07 / P-13：往期会议 70 条里 47 条是测试场和空会，真会议被淹掉；测试场还跟着同步进了项目记忆目录。
// 判据只有两条，写在这一个地方，服务端、会议列表、记忆投影、索引共用：
//   test  = 脚本造的场次，靠会议 id 前缀认（bench-/smoke-/mactest-/rc-/legacy/probe-，以及 mt+纯时间戳这种压测 id）
//   empty = 真录过但什么都没录到（转写不足 3 段且不到 60 秒）
// 其余都是 real。只影响默认显示和投影，不删任何数据——「显示全部」能把它们都调出来。
const TEST_ID = /^(bench|smoke|test|mactest|rc|legacy|probe|dev)[-_0-9]|^(bench|smoke|test|mactest|rc|legacy|probe|dev)\d|^mt\d{11,}$|^legacy\d*$/i;

function kindOf(s) {
  const id = String((s && s.id) || '');
  if (!id) return 'empty';
  if (TEST_ID.test(id)) return 'test';
  const n = ((s && s.transcript) || []).filter(r => r && String(r.text || '').trim()).length;
  const dur = durationSec(s);
  if (n < 3 && dur < 60) return 'empty';
  return 'real';
}

function durationSec(s) {
  const start = typeof s.start === 'number' ? s.start : Date.parse(s.start) || 0;
  let end = s.end ? (typeof s.end === 'number' ? s.end : Date.parse(s.end) || 0) : 0;
  if (!end) { const tr = s.transcript || []; const last = tr.length ? (tr[tr.length - 1].at || 0) : 0; end = last > 1e11 ? last : (last ? start + last * 1000 : 0); }
  return end && start ? Math.max(0, Math.round((end - start) / 1000)) : 0;
}

const isReal = s => kindOf(s) === 'real';

module.exports = { kindOf, isReal, TEST_ID };
