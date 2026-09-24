'use strict';
// 凭据闸门（scripts/check-package.sh）是「私有 key 不外流」这条线上唯一的自动拦截器。
// 它过去只在发布时手动跑过一次，负例全靠人记得去造。这里把负例固化下来：
// 闸门被改坏时，`npm test` 当场红，而不是等到包已经推上 GitHub 才发现。
// 每个用例都拿真实的包结构跑真实的脚本，不 mock。
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const GATE = path.join(root, 'scripts', 'check-package.sh');
// 测试不碰本机真凭据：造一个假 HOME，放一套合成的私有 / 试用凭据。缺了什么就当场失败，不 skip。
const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-home-'));
const PRIV_DIR = path.join(FAKE_HOME, '.claude-maint', 'tinghuitai-private');
fs.mkdirSync(PRIV_DIR, { recursive: true });
const PRIVATE = { VOLC_APP_KEY: 'PRIVATEAPP1234', VOLC_ACCESS_KEY: 'PRIVATE-ACCESS-abcdefgh', DEEPSEEK_API_KEY: 'sk-private-deepseek-0000',
  LLM_BASE_URL: 'https://api.deepseek.com', LLM_MODEL: 'deepseek-chat', JEV_GATE: 'on', JEV_THRESHOLD: 0.5, JEV_MIN_GAP_MS: '2000' };
const TRIAL = '{\n  "VOLC_APP_KEY": "TRIALAPP5678",\n  "VOLC_ACCESS_KEY": "TRIAL-ACCESS-zyxwvuts",\n  "VOLC_RESOURCE_ID": "volc.seedasr.sauc.duration",\n  "PRESET_VERSION": "trial-test"\n}\n';
function writeFixtures(priv = PRIVATE) {
  fs.writeFileSync(path.join(PRIV_DIR, 'preset.json'), JSON.stringify(priv));
  fs.writeFileSync(path.join(PRIV_DIR, 'trial-preset.json'), TRIAL);
}
writeFixtures();

function runGate(dir, trial) {
  const args = [GATE, dir]; if (trial) args.push('--trial');
  const r = spawnSync('bash', args, { encoding: 'utf8', env: { ...process.env, HOME: FAKE_HOME } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
// 造一个最小的「包」：闸门只关心文件内容，不需要真的 .app
function mkPkg(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return dir;
}
const PRESET_PATH = 'Contents/Resources/program/preset.json';
const trialBytes = Buffer.from(TRIAL);

test('标准版：包里出现 preset.json 一律拒', () => {
  const dir = mkPkg({ [PRESET_PATH]: '{"VOLC_APP_KEY":"x"}' });
  const r = runGate(dir, false);
  assert.notEqual(r.code, 0, '标准版不该放行带 preset.json 的包');
  assert.match(r.out, /preset\.json/);
});

test('标准版：干净的包放行', () => {
  const r = runGate(mkPkg({ 'Contents/Resources/program/app/server.js': '// 没有凭据\n' }), false);
  assert.equal(r.code, 0, r.out);
});

test('试用版：包里没有 preset.json 要拒', () => {
  const r = runGate(mkPkg({ 'Contents/Resources/program/app/server.js': '//\n' }), true);
  assert.notEqual(r.code, 0);
});

test('试用版：与 trial-preset.json 逐字相同才放行', () => {
  const r = runGate(mkPkg({ [PRESET_PATH]: trialBytes }), true);
  assert.equal(r.code, 0, r.out);
});

test('试用版：同值但换了格式也要拒（逐字 = 字节级）', () => {
  const obj = JSON.parse(trialBytes.toString('utf8'));
  const reformatted = JSON.stringify(Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]])), null, 4);
  assert.notEqual(reformatted, trialBytes.toString('utf8'), '这个用例要求重排后与原文不同');
  const r = runGate(mkPkg({ [PRESET_PATH]: reformatted }), true);
  assert.notEqual(r.code, 0, '语义相同但字节不同，不算逐字一致');
});

test('试用版：多于一份 preset.json 要拒，哪怕内容一样', () => {
  const r = runGate(mkPkg({ [PRESET_PATH]: trialBytes, 'Contents/Resources/program/app/preset.json': trialBytes }), true);
  assert.notEqual(r.code, 0, '多一份就是多一个凭据入口');
});

test('试用版：preset.json 放在预期之外的位置要拒', () => {
  const r = runGate(mkPkg({ 'Contents/Resources/program/web/preset.json': trialBytes }), true);
  assert.notEqual(r.code, 0);
});

test('试用版：带了转写以外的字段要拒', () => {
  const obj = JSON.parse(trialBytes.toString('utf8'));
  obj.DEEPSEEK_API_KEY = 'sk-should-never-ship';
  const dir = mkPkg({ [PRESET_PATH]: JSON.stringify(obj) });
  const r = runGate(dir, true);
  assert.notEqual(r.code, 0, '试用包只许带火山转写那几个字段');
});

test('包里出现私有密钥（哪怕藏在普通源码里）要拒', () => {
  const r = runGate(mkPkg({ [PRESET_PATH]: trialBytes, 'Contents/Resources/program/app/x.js': 'const k="sk-private-deepseek-0000";' }), true);
  assert.notEqual(r.code, 0); assert.match(r.out, /DEEPSEEK_API_KEY|私有/);
});

test('私有文件多了一个没归类的短字段，默认拒发', () => {
  writeFixtures({ ...PRIVATE, NEW_PIN: '1234' });
  try {
    const r = runGate(mkPkg({ [PRESET_PATH]: trialBytes }), true);
    assert.notEqual(r.code, 0); assert.match(r.out, /NEW_PIN/);
  } finally { writeFixtures(); }
});

test('试用凭据和私有凭据是同一套，要拒', () => {
  writeFixtures({ ...PRIVATE, VOLC_APP_KEY: 'TRIALAPP5678', VOLC_ACCESS_KEY: 'TRIAL-ACCESS-zyxwvuts' });
  try { assert.notEqual(runGate(mkPkg({ [PRESET_PATH]: trialBytes }), true).code, 0); }
  finally { writeFixtures(); }
});

const zlib = require('zlib');
const SECRET = PRIVATE.DEEPSEEK_API_KEY;
for (const [name, body] of [
  ['base64', Buffer.from('x=' + Buffer.from('ab' + SECRET + 'cd').toString('base64'))],
  ['hex', Buffer.from(Buffer.from(SECRET).toString('hex'))],
  ['URL 编码', Buffer.from(encodeURIComponent('k=' + SECRET + '/'))],
  ['UTF-16', Buffer.from(SECRET, 'utf16le')],
  ['gzip', zlib.gzipSync(Buffer.from('key=' + SECRET))],
]) {
  test(`标准版：私有凭据以 ${name} 形式藏在包里也要拒`, () => {
    const r = runGate(mkPkg({ 'Contents/Resources/program/app/blob.bin': body }), false);
    assert.notEqual(r.code, 0, `${name} 变形没被拦住`);
    assert.match(r.out, /DEEPSEEK_API_KEY/);
  });
}

test('试用版：trial-preset 缺字段也要拒（字段必须恰好四个且非空）', () => {
  const short = '{\n  "VOLC_APP_KEY": "TRIALAPP5678",\n  "PRESET_VERSION": "trial-test"\n}\n';
  fs.writeFileSync(path.join(PRIV_DIR, 'trial-preset.json'), short);
  try {
    const r = runGate(mkPkg({ [PRESET_PATH]: Buffer.from(short) }), true);
    assert.notEqual(r.code, 0, '缺字段的试用 preset 不该放行');
    assert.match(r.out, /字段必须恰好/);
  } finally { writeFixtures(); }
});

test('标准版：私有值嵌在任意长前后缀里再整体 base64，所有对齐都拦得住', () => {
  const files = {};
  for (let pre = 0; pre < 9; pre++) for (let post = 0; post < 4; post++) {
    const whole = Buffer.concat([Buffer.alloc(pre, 0x41 + pre), Buffer.from(SECRET), Buffer.alloc(post, 0x7a)]);
    files[`Contents/Resources/program/app/b64_${pre}_${post}.txt`] = Buffer.from(whole.toString('base64'));
    files[`Contents/Resources/program/app/b64url_${pre}_${post}.txt`] = Buffer.from(whole.toString('base64url'));
  }
  const r = runGate(mkPkg(files), false);
  assert.notEqual(r.code, 0);
  for (const name of Object.keys(files)) assert.ok(r.out.includes(path.basename(name)), `${name} 漏检`);
});
