'use strict';
// 历史承诺回查（Aaron 2026-09-22「历史承诺回查，可以加一下吧」）：
// ① 会中提示词里的每条以往沉淀都带记录日期，模型才能说出「9 月 12 日已承诺过」；
// ② 分诊提示词有「承诺回查」这条规则，且构建产物 web/index.html 里也有（不是只改了源文件）。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const mem = require('../app/memory'), ops = require('../app/memory-ops');
test('以往沉淀每条带日期：两场会各承诺一次同一件事，检索后两条都在、日期各自正确', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemate-promise-recheck-'));
  try {
    const db = mem.open(dir); if (!db) return;   // 本机 node 没有 sqlite 时整个记忆功能关闭，不测
    mem.putCard(db, { kind: 'promise', topic: '供应商 demo', text: '向供应商索要 demo 录屏', owner: 'S1', meeting_id: 'm1', meeting_title: '硬件例会', recorded_at: '2026-09-12T02:00:00.000Z' });
    mem.putCard(db, { kind: 'promise', topic: '供应商 demo', text: '跟进供应商的 demo 反馈', owner: 'S1', meeting_id: 'm2', meeting_title: '硬件例会', recorded_at: '2026-09-17T02:00:00.000Z' });
    mem.putCard(db, { kind: 'promise', topic: '装宽带', text: '先装上宽带让团队用起来', owner: 'S0', meeting_id: 'm2', meeting_title: '硬件例会', recorded_at: '2026-09-17T02:00:00.000Z' });
    const cards = ops.retrieve(dir, '供应商那个 demo 我下周再去要一下');
    const block = ops.toPromptBlock(cards);
    assert.ok(block.includes('向供应商索要 demo 录屏') && block.includes('2026-09-12'), '09-12 那条承诺没带日期进提示词：' + block);
    assert.ok(block.includes('跟进供应商的 demo 反馈') && block.includes('2026-09-17'), '09-17 那条承诺没带日期进提示词：' + block);
    assert.ok(!block.includes('装宽带'), '没提到的承诺不该被拉进来：' + block);
    assert.match(block, /来自《硬件例会》 2026-09-12/, '日期要紧跟在会名后面，模型才知道哪条是哪天的');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('分诊提示词含「承诺回查」规则，源文件和构建产物都有', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', '22-analysis.js'), 'utf8');
  const built = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const m = built.match(/const\s+TRIAGE\s*=\s*([`"'])([\s\S]*?)\1/);
  assert.ok(m, '构建产物里找不到 TRIAGE');
  for (const [name, text] of [['源文件', src], ['构建产物 TRIAGE', m[2]]]) {
    assert.ok(text.includes('承诺回查'), name + '缺「承诺回查」');
    assert.ok(text.includes('已承诺过，至今未落地'), name + '缺 claim 写法');
    assert.ok(text.includes('相近的事不要硬凑'), name + '缺保守条款');
  }
});
