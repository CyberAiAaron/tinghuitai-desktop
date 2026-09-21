'use strict';
// S7：仓库里躺着四个被跟踪的 .bak（AGENTS.md.grok-…、web/setup.html.bak-…、web/setup.js.bak-…、开始用.md.bak-…）。
// 危害不是占地方，是 grep 会命中它们：照着 `grep -n xxx web/setup.js*` 的结果去改，改的是一份死文件，
// 界面上什么都不会变；deploy-beta.sh 还会把 web/ 下的它们 rsync 进安装目录。
// 要留旧版就翻 git 历史，别在工作树里留第二份。
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
// 只扫工作树里「人和 grep 会碰到」的地方：依赖、git 内部、临时目录、回滚快照不算。
const SKIP_DIR = new Set(['node_modules', '.git', '.tmp', '.prev', '__pycache__', '会议档案(整理结果)']);
const BACKUP_NAME = /\.(bak|orig|rej)\b|\.bak[-.]|~$|\.(copy|old)\.[a-z]+$/i;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(entry.name) || entry.name.startsWith('.replace-') || entry.name.startsWith('.update-')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(path.relative(root, full));
  }
  return out;
}

test('工作树里没有 .bak / .orig 这类备份副本（要旧版就翻 git 历史）', () => {
  const stray = walk(root).filter(f => BACKUP_NAME.test(path.basename(f)));
  assert.deepEqual(stray.sort(), [], '这些备份副本会被 grep 命中、被 rsync 带进安装目录：' + stray.join('、'));
});

test('文档里不再指向已经删掉的 .bak', () => {
  for (const doc of ['AGENTS.md', 'README.md', 'AI-SETUP.md']) {
    const p = path.join(root, doc);
    if (!fs.existsSync(p)) continue;
    const hits = fs.readFileSync(p, 'utf8').split('\n')
      .filter(l => /`[^`]*\.bak[^`]*`/.test(l) && !/git (log|show|history)/.test(l));
    assert.deepEqual(hits, [], doc + ' 还在把 .bak 当成能打开的文件指：' + hits.join(' / '));
  }
});
