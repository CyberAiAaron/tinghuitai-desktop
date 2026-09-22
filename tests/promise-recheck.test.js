'use strict';
// 历史承诺回查（Aaron 2026-09-22「历史承诺回查，可以加一下吧」）：
// ① 会中提示词里的每条以往沉淀都带记录日期，模型才能说出「9 月 12 日已承诺过」；
// ② 分诊提示词有「承诺回查」这条规则，且构建产物 web/index.html 里也有（不是只改了源文件）。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const mem = require('../app/memory'), ops = require('../app/memory-ops');
test('以往沉淀每条带日期：两场会各承诺一次同一件事，检索后两条都在、日期各自正确', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livemate-promise-recheck-'));
  try {
    const db = mem.open(dir); if (!db) { t.skip('本机 node 没有 sqlite，记忆功能整体关闭'); return; }   // 明确报 skip，不算通过
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
    assert.ok(text.includes('已承诺过，记录里没看到落地'), name + '缺 claim 写法');
    assert.ok(!text.includes('至今未落地'), name + '不许断言「至今未落地」：沉淀里只有「没有完成记录」，不等于确认没做');
    assert.ok(text.includes('没带日期的，不做承诺回查'), name + '缺「没日期不回查」');
    assert.ok(text.includes('相近的事不要硬凑'), name + '缺保守条款');
    assert.ok(text.includes('截止未到'), name + '缺「截止未到不回查」（Codex 55ec859b：pending 不等于逾期）');
  }
});
test('toPromptBlock 不依赖 sqlite：日期按真实日历校验才带，缺失或非法不带，截止未到的承诺标出来', () => {
  const b = ops.toPromptBlock([
    { kind: 'promise', text: 'A', meeting_title: '会1', recorded_at: '2026-09-12T02:00:00.000Z' },
    { kind: 'promise', text: 'B', meeting_title: '会2' },
    { kind: 'promise', text: 'D', meeting_title: '会4', recorded_at: '2026-99-99T00:00:00.000Z' },
    { kind: 'promise', text: 'E', meeting_title: '会5', recorded_at: '2026-09-12T02:00:00.000Z', due: '2099-01-01' },
    { kind: 'promise', text: 'F', meeting_title: '会6', recorded_at: '2026-09-12T02:00:00.000Z', due: '2020-01-01' },
    { kind: 'promise', text: 'C', meeting_title: '会3', recorded_at: '昨天' },
  ]);
  assert.match(b, /- \[承诺\] A　来自《会1》 2026-09-12\n/, '合法日期要带：' + b);
  assert.match(b, /- \[承诺\] B　来自《会2》\n/, '缺日期就不带：' + b);
  assert.match(b, /- \[承诺\] D　来自《会4》\n/, '格式对但不是真实日历日期（99 月）也不带：' + b);
  assert.match(b, /- \[承诺\] E 截止 2099-01-01（截止未到）　来自《会5》 2026-09-12\n/, '截止日还没到要标出来：' + b);
  assert.match(b, /- \[承诺\] F 截止 2020-01-01　来自《会6》 2026-09-12\n/, '已过截止日不标：' + b);
  assert.match(b, /- \[承诺\] C　来自《会3》$/, '非法日期不带：' + b);
  assert.ok(!/undefined|昨天|99-99/.test(b), '不能把脏字符串当日期：' + b);
});
