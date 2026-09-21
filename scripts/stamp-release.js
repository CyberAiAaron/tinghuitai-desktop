#!/usr/bin/env node
'use strict';
// 发版前把「真 zip 的校验值」盖进 version.json。
// updater.js 从审查 X4 起要求 sha256 必填（以前可选：manifest 里不写就整段跳过校验，
// 等于谁能往那个路径放一个 zip，装机端就装什么）。这一格原来靠人手填，
// 忘填或填成上一版的，装机端只会看到一句「更新包没有校验值」。
// 用法: node scripts/stamp-release.js <版本> <zip 路径> <version.json 路径> [--check]
//   默认写入（幂等：已经一致就什么都不改）；--check 只核对，不一致退出 1。
const fs = require('fs'), path = require('path'), crypto = require('crypto');

function stamp(version, zipPath, manifestPath) {
  const buf = fs.readFileSync(zipPath);
  const man = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const next = { ...man, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length };
  if (version) next.version = version;
  next.zip = path.basename(zipPath);
  const changed = ['version', 'zip', 'sha256', 'size'].filter(k => man[k] !== next[k]);
  return { man, next, changed };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const [version, zipPath, manifestPath] = args.filter(x => !x.startsWith('--'));
  if (!version || !zipPath || !manifestPath) {
    console.error('用法: node scripts/stamp-release.js <版本> <zip 路径> <version.json 路径> [--check]');
    process.exit(2);
  }
  let r;
  try { r = stamp(version, zipPath, manifestPath); }
  catch (e) { console.error('盖校验值失败：' + e.message); process.exit(2); }
  if (!r.changed.length) { console.log('version.json 和这个 zip 已经一致（sha ' + r.next.sha256.slice(0, 12) + '）'); return; }
  if (check) {
    console.error('version.json 和待发布的 zip 对不上：' + r.changed.map(k => k + ' ' + JSON.stringify(r.man[k]) + ' → ' + JSON.stringify(r.next[k])).join('，'));
    process.exit(1);
  }
  fs.writeFileSync(manifestPath, JSON.stringify(r.next, null, 2) + '\n');
  console.log('已按真 zip 更新 version.json：' + r.changed.join('、') + '（sha ' + r.next.sha256.slice(0, 12) + '，' + r.next.size + ' 字节）');
}

module.exports = { stamp };
if (require.main === module) main();
