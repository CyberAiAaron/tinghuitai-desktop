'use strict';
// 会后私聊推送（app/dm-push.js）：只发一次、没飞书静默跳过、收件人只能是 Aaron 本人。全部用假 lark，绝不真外发。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const DM = require('../app/dm-push');

const result = { brief: { insights_md: '**Pin 先定主链路**\n先把拍照链路跑通再谈功耗。\n\n@Abel Mei：周五前给功耗曲线\n\n**价格没问过**\n用研 19 人里没人被问到价格。\n\n@Cary Luo：排下一轮用研\n\n**第三条想法**\n正文\n\n**第四条不该出现**\n正文' } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tht-dm-push-'));
function fakeLark({ self = DM.AARON_OPEN_ID, available = true, fail = false } = {}) {
  const sent = [];
  return { sent, larkAvailable: () => ({ ok: available }), selfOpenId: async () => self,
    cardSend: async a => { sent.push(a); return fail ? { ok: false, error: '飞书拒绝' } : { ok: true, messageId: 'om_' + sent.length }; } };
}
const run = (lark, dataDir, extra = {}) => DM.push({ sessionId: 's-1', title: '硬件周会', result, env: {}, dataDir, pageBase: 'http://127.0.0.1:47903', lark, ...extra });

test('卡片：标题=会名，3 条想法 + 行动一人一行，≤8 行，按钮直达回看页', () => {
  const { card, lines } = DM.buildCard({ title: '硬件周会', result, url: 'http://x/tinghuitai/archive.html?id=s-1' });
  assert.equal(card.header.title.content, '硬件周会');
  assert.deepEqual(lines.slice(0, 3), ['• Pin 先定主链路', '• 价格没问过', '• 第三条想法']);
  assert.ok(lines.some(l => /^@.+：周五前给功耗曲线/.test(l)));
  assert.ok(lines.length + 1 <= 8);
  const btn = card.elements.at(-1).actions[0];
  assert.equal(btn.text.content, '打开回看页');
  assert.equal(btn.url, 'http://x/tinghuitai/archive.html?id=s-1');
});

test('每场只发一次：重跑不重发，收据落盘', async () => {
  const dir = tmp(), lark = fakeLark();
  const a = await run(lark, dir);
  assert.equal(a.status, 'sent'); assert.equal(a.messageId, 'om_1');
  const b = await run(lark, dir);
  assert.equal(b.alreadySent, true);
  assert.equal(lark.sent.length, 1);
  assert.equal(fs.readdirSync(path.join(dir, 'state', 'send-receipts', DM.KIND)).length, 1);
  assert.match(lark.sent[0].card.elements.at(-1).actions[0].url, /127\.0\.0\.1:47903\/tinghuitai\/archive\.html\?id=s-1$/);
});

test('没飞书（试用版）：静默跳过，不抛、不发', async () => {
  const lark = fakeLark({ available: false });
  const r = await run(lark, tmp());
  assert.equal(r.skipped, 'no-lark'); assert.equal(lark.sent.length, 0);
  assert.equal((await run(null, tmp())).skipped, 'no-lark');
});

test('收件人只能是 Aaron 本人：登录的不是他就不发；发的时候 openId 恒为他', async () => {
  const other = fakeLark({ self: 'ou_someoneelse' });
  assert.equal((await run(other, tmp())).skipped, 'not-aaron'); assert.equal(other.sent.length, 0);
  const me = fakeLark(); await run(me, tmp());
  assert.deepEqual(me.sent.map(s => s.openId), [DM.AARON_OPEN_ID]);
});

test('开关 off 不发；发送失败不抛、明确失败可下次重来', async () => {
  const lark = fakeLark();
  assert.equal((await run(lark, tmp(), { env: { MEETING_DM_PUSH: 'off' } })).skipped, 'off');
  const dir = tmp(), bad = fakeLark({ fail: true });
  assert.equal((await run(bad, dir)).skipped, 'error');
  const ok = fakeLark(); assert.equal((await run(ok, dir)).status, 'sent');
});

test('老场次没有军师正文：想法退到纪要结论、行动退到待办，仍 ≤8 行', () => {
  const old = { brief: { overview: { conclusions: ['结论一', '结论二'], todos: [{ what: '给功耗曲线', owner: 'Abel Mei' }, { what: '排用研', owner: 'Cary Luo' }] } } };
  const { lines } = DM.buildCard({ title: '老会', result: old, url: 'u' });
  assert.deepEqual(lines, ['• 结论一', '• 结论二', '@Abel Mei：给功耗曲线', '@Cary Luo：排用研']);
});
