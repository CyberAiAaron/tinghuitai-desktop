'use strict';
// X4：更新包的 sha256 原来是可选的——version.json 里不写，updater 就整段跳过校验，
// 谁能往那个路径放一个 zip，这台机器就装什么。现在必填。
// 必填就必须保证正常发版填得上，所以这里同时守住发版那一头：scripts/stamp-release.js 按真 zip 盖值。
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const { requiredSha } = require('../app/updater.js');
const { stamp } = require('../scripts/stamp-release.js');
const root = path.join(__dirname, '..');

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

test('manifest 缺 sha256 或写得不像校验值，一律拒装', () => {
  for (const man of [{}, { sha256: '' }, { sha256: null }, { sha256: 'abc' },
                     { sha256: 'z'.repeat(64) }, { sha256: '0'.repeat(63) }, { sha256: '0'.repeat(65) },
                     { sha256: 123 }, { sha256: { v: 1 } }])
    assert.throws(() => requiredSha(man), /没有校验值/, JSON.stringify(man) + ' 应当被拒');
  assert.throws(() => requiredSha(null), /没有校验值/);
});

test('像样的校验值照收，大小写和空格都归一', () => {
  const v = 'A'.repeat(64);
  assert.equal(requiredSha({ sha256: v }), 'a'.repeat(64));
  assert.equal(requiredSha({ sha256: '  ' + 'b1'.repeat(32) + ' ' }), 'b1'.repeat(32));
});

test('仓库里现在这份 version.json 自己过得了这条闸', () => {
  const man = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
  assert.equal(requiredSha(man).length, 64);
});

test('发版脚本按真 zip 盖值：算出来的 sha / size / zip 名和文件一致', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-rel-'));
  try {
    const zip = path.join(dir, 'tinghuitai-desktop-v9.9.9.zip');
    const bytes = Buffer.from('假装这是一个安装包');
    fs.writeFileSync(zip, bytes);
    const manifest = path.join(dir, 'version.json');
    fs.writeFileSync(manifest, JSON.stringify({ version: '0.0.1', zip: '旧名.zip', sha256: 'f'.repeat(64), size: 1, notes: '别动我' }, null, 2));

    const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'stamp-release.js'), '9.9.9', zip, manifest], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    assert.equal(out.sha256, sha(bytes));
    assert.equal(out.size, bytes.length);
    assert.equal(out.zip, 'tinghuitai-desktop-v9.9.9.zip');
    assert.equal(out.version, '9.9.9');
    assert.equal(out.notes, '别动我', '别的字段不许动');
    assert.equal(requiredSha(out).length, 64, '盖完就该能过更新端那条闸');

    const again = spawnSync(process.execPath, [path.join(root, 'scripts', 'stamp-release.js'), '9.9.9', zip, manifest], { encoding: 'utf8' });
    assert.equal(again.status, 0);
    assert.match(again.stdout, /已经一致/, '再跑一次应当什么都不改');
    assert.deepEqual(JSON.parse(fs.readFileSync(manifest, 'utf8')), out);

    // 包换了内容、version.json 没跟上：--check 要报出来并拦住
    fs.writeFileSync(zip, Buffer.from('换了一个包'));
    const check = spawnSync(process.execPath, [path.join(root, 'scripts', 'stamp-release.js'), '9.9.9', zip, manifest, '--check'], { encoding: 'utf8' });
    assert.equal(check.status, 1);
    assert.match(check.stderr, /对不上/);
    assert.deepEqual(JSON.parse(fs.readFileSync(manifest, 'utf8')), out, '--check 不许改文件');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('盖值函数不改原 manifest 对象，只给出下一版', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-rel-'));
  try {
    const zip = path.join(dir, 'p.zip'); fs.writeFileSync(zip, 'x');
    const manifest = path.join(dir, 'version.json');
    fs.writeFileSync(manifest, JSON.stringify({ version: '1.0.0', sha256: 'a'.repeat(64), size: 0, zip: 'p.zip' }));
    const r = stamp('1.0.0', zip, manifest);
    assert.equal(r.man.sha256, 'a'.repeat(64));
    assert.equal(r.next.sha256, sha(Buffer.from('x')));
    assert.deepEqual(r.changed.sort(), ['sha256', 'size']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('发版脚本真的会调这一步（否则必填反而把自己拦在门外）', () => {
  const sh = fs.readFileSync(path.join(root, 'scripts', 'release-publish.sh'), 'utf8');
  assert.match(sh, /stamp-release\.js/);
  assert.ok(sh.indexOf('stamp-release.js') < sh.indexOf('cp "$ZIP"'), '要在把 zip 和 version.json 拷进发行仓之前盖');
});
