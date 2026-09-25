// deploy-beta.sh 不能在测试里真跑（会重启本机服务），这里锁住两条不变量：根目录版本文件要同步、重启后要核 /health 版本。
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const P = path.join(__dirname, '..', 'scripts', 'deploy-beta.sh'); const s = fs.readFileSync(P, 'utf8');
test('deploy-beta: 同步 version.json 和 package.json 到 $PROG', () => {
  assert.match(s, /rsync -a version\.json package\.json "\$PROG\/"/);
  assert.ok(s.indexOf('version.json package.json') < s.indexOf('launchctl kickstart -k "gui'), '要在重启前同步');
});
test('deploy-beta: 重启后 /health version 必须等于 version.json，否则 exit 1', () => {
  const i = s.indexOf('WANT=$(field version < version.json)'); assert.ok(i > s.indexOf('launchctl kickstart -k "gui'));
  const line = s.slice(i).split('\n')[1]; assert.match(line, /"\$GOT" = "\$WANT"/); assert.match(line, /exit 1/);
});
test('deploy-beta: bash 语法通过', () => { execFileSync('bash', ['-n', P]); });
