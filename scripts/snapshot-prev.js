#!/usr/bin/env node
'use strict';
// P-20：0.6.13 之后的几版是直接拷文件装上去的，没走 app 内的「检查更新」，
// 所以回退快照 .prev 一直停在 0.6.12——用户点「回到上一版」其实会退掉四个版本。
// 拷贝安装前先跑这个脚本，把当前这一版整份存进 .prev，回退按钮才指向真正的上一版。
// 用法（在被覆盖的那个安装目录里跑）：node scripts/snapshot-prev.js
const path = require('path');
try {
  const u = require(path.join(__dirname, '..', 'app', 'updater.js'));
  const r = u.snapshotCurrent();
  console.log('已备份当前版本 ' + r.version + '（' + r.files + ' 个条目）到 .prev');
} catch (e) {
  console.error('备份失败：' + (e && e.message || e));
  process.exit(1);
}
