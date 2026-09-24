'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('代回落款：settings.json 有 REPLY_SIGN 用它，没有用中性默认', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const S = require('../app/tools/slack-cli');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sign-'));
  assert.strictEqual(S.signOf({ THT_DATA_DIR: d }), '— 由 Claude 代回');
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ REPLY_SIGN: '— 某某的助手代回' }));
  assert.strictEqual(S.signOf({ THT_DATA_DIR: d }), '— 某某的助手代回');
});
