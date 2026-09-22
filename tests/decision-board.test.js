'use strict';
// 决策板当前口径摘要（app/decision-board.js，主动智能批 2）：最新一份 kb_backup/决策板D1-D8_YYYY-MM-DD.md 抽 D1–D8 各一行 ≤1500 字，
// 版本 = mtime#hash 进用量账。样本按 2026-09-21 真实导出的结构缩写（表头九列、链接、加粗、分隔行、D1 前提子表、决策日志表）。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const db = require('../app/decision-board');
const pack = require('../app/context-pack');

const SAMPLE = `<title>AI Phone CDCP 决策板 D1–D8（唯一决策真源）</title>

v1.1 ｜ 2026-09-05（v1.0 2026-09-02）｜ 维护人：Aaron / Chansey 助理 ｜ 评审：2026-09-22 CDCP ｜ 立项：2026-11-17 PDT KO

# 一、已拍板的（有出处，别再讨论）

| 日期 | 决定 | 出处 |
|-|-|-|
| 2026-08-21 | 可靠性红线：100 次使用最多错 1 次 | 08-21 Pin 场景会 |

# 二、CDCP D1–D8（9/22 评审会）

| # | 决策 | 要回答的问题 | 选项 | 当前倾向 | Owner | 门 | 期限 | 状态 |
|-|-|-|-|-|-|-|-|-|
| D1 | Pin 与手机的绑定关系 | Pin 作为手机可拆卸模块成不成立 | A ｜ B ｜ C | B（09-05 Aaron 采纳建议版）：Pin 退出 KO 转预研，手机先行 | Aaron | 单向 | 09-22 | [倾向→定] |
| D2 | 整机形态与屏幕 | 5.4–5.5 寸阔屏直板定不定 | 屏短名单四款 | 阔屏直板 [倾向]；尺寸比例做多比例模型后锁 | Shawn Liu / ID | 单向 | 09-22 | [倾向] |
| D3 | 新品类定义与对外 message | 一句话 own 什么品类 | 候选语待 Shawn | 三候选（09-05）：①「不用喂的 AI」（推荐）②「给 AI 眼睛和耳朵」③「完整的手机 + 一点 AI」 | Shawn Liu | 单向 | 09-22 | [倾向] |
| D4 | 首发市场与商业目标 | 美国 / USD 500 / 10 万台能否同时成立 | 改量 ｜ 谈运营商 | 09-05 采纳：改量 + 耳机线创收；不押运营商渠道 | Aaron | 单向 | 09-22 | [倾向→定] |
| D5 | BOM 口径统一 | 以哪版为准 | One BOM of record | 指定 Cary 成本模型为唯一口径 | Cary Luo / Abel Mei | 单向 | 09-22 | [待定] |
| D6 | 无线充电规格 | 15W vs 25W | 三选一 | 15W 首发、预留 25W；结构优先内置磁吸 | Abel Mei | **双向** | 本周（09-05 前）会前拍掉 | [倾向] 自 08-21 挂起 |
| D7 | Trust 方案范围与 owner | 软硬边界 | 两条 | Trust 定义已定；硬件四个 Trust 时刻见[架构 七](https://example.invalid/docx/UifYd8eGCoxyyuxEIZjlzBHNgae)；Owner 待定 | ⚠️ 待 Aaron 定 | 单向 | 09-22 | [待定] |
| D8 | 资源与投入规模 | 量级 | 待 D3 | 一行：量级 + 与 AI SP「HARDWARE GATE」的关系 | Aaron | 单向 | 09-22 | [待定] |

**依赖**：D1 未定卡 D2 / D6 / D7；D3 未定卡 D4 / D8。

## D1 的三条前提（条件式写法，待 Aaron 确认）

| # | 前提 | 09-02 状态 | 谁去拿 |
|-|-|-|-|
| ① | SF 用研拿到至少 3 个正向行为证据 | 没有 | Aaron / Ran |

# 四、决策日志（新的在上）

| 日期 | 事件 |
|-|-|
| 2026-09-05 | 八小时深度推演交付 |
`;

function stage(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-decision-board-'));
  const kb = path.join(dir, 'kb_backup'); fs.mkdirSync(kb);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(kb, name), text);
  return { dir, kb, clean: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('抽 D1–D8 各一行：编号、决策名、当前倾向、期限、状态都在，链接 / 加粗被剥掉，别的表不混进来', () => {
  const rows = db.extractRows(SAMPLE);
  assert.deepEqual(rows.map(r => r.id), ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']);
  assert.equal(rows[0].name, 'Pin 与手机的绑定关系');
  assert.match(rows[0].lean, /^B（09-05 Aaron 采纳建议版）/);
  assert.equal(rows[0].due, '09-22'); assert.equal(rows[0].state, '[倾向→定]');
  assert.equal(rows[5].due, '本周（09-05 前）会前拍掉', '期限列按表头对位，不被「门」列（**双向**）顶掉');
  assert.ok(rows[6].lean.includes('架构 七') && !rows[6].lean.includes('http'), '链接只留文字');
  assert.ok(!rows.some(r => /可靠性红线|SF 用研|深度推演/.test(r.lean)), '「已拍板」「D1 前提」「决策日志」三张表不该被当成 D 行');
});

test('summarize：取文件名日期最新的一份，总长 ≤1500，抬头带导出日期和版本行，version = mtime#hash', () => {
  const h = stage({ '决策板D1-D8_2026-09-19.md': SAMPLE.replace('B（09-05', 'A（09-01'), '决策板D1-D8_2026-09-21.md': SAMPLE, '产品需求总纲_2026-09-21.md': '# 总纲\n', '决策板D1-D8_草稿.md': SAMPLE });
  try {
    const r = db.summarize({ DECISION_BOARD_DIR: h.kb });
    assert.ok(!r.missing, JSON.stringify(r));
    assert.equal(path.basename(r.source), '决策板D1-D8_2026-09-21.md');
    assert.ok(r.text.length <= 1500 && r.text.length > 300, '长度 ' + r.text.length);
    assert.match(r.text, /^决策板导出 2026-09-21（v1\.1 ｜ 2026-09-05/);
    assert.ok(r.text.includes('B（09-05 Aaron 采纳建议版）') && !r.text.includes('A（09-01'), '要最新那份');
    assert.match(r.text, /\nD3 新品类定义与对外 message：三候选（09-05）/);
    assert.match(r.text, /\nD8 资源与投入规模：.*｜期限 09-22｜状态 \[待定\]$/);
    assert.equal(r.text.split('\n').length, 9, '抬头 + 8 行');
    assert.match(r.version, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z#[0-9a-f]{8}$/);
    // 目录用 PROJECT_CONTEXT_DIR 兜底
    const r2 = db.summarize({ PROJECT_CONTEXT_DIR: h.dir });
    assert.equal(r2.source, r.source);
  } finally { h.clean(); }
});

test('超长的倾向列被均分预算截断，总长仍 ≤1500；8 行一行不少', () => {
  const long = SAMPLE.replace(/\| ([^|]{10,}) \| (Aaron|Shawn Liu|Shawn Liu \/ ID|Cary Luo \/ Abel Mei|Abel Mei|⚠️ 待 Aaron 定) \|/g, (m, lean, owner) => `| ${lean}${'，补充说明'.repeat(60)} | ${owner} |`);
  const h = stage({ '决策板D1-D8_2026-09-21.md': long });
  try {
    const r = db.summarize({ DECISION_BOARD_DIR: h.kb });
    assert.ok(!r.missing); assert.ok(r.text.length <= 1500, '长度 ' + r.text.length);
    assert.equal(r.text.split('\n').length, 9);
    for (const d of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']) assert.ok(r.text.includes('\n' + d + ' '), '缺 ' + d);
  } finally { h.clean(); }
});

test('没目录 / 目录里没有导出 / 文件里没有 D 表 → missing 带原因，不抛错', () => {
  assert.equal(db.summarize({}).missing, true);
  const h = stage({ '产品需求总纲_2026-09-21.md': 'x' });
  try {
    assert.match(db.summarize({ DECISION_BOARD_DIR: h.kb }).reason, /没有 决策板/);
    fs.writeFileSync(path.join(h.kb, '决策板D1-D8_2026-09-21.md'), '# 空\n');
    assert.match(db.summarize({ DECISION_BOARD_DIR: h.kb }).reason, /没找到 D1–D8/);
  } finally { h.clean(); }
});

test('进 live 资料包：有导出就多一块【决策板当前口径】且 parts 带版本；没有就一块不带、text 不变', () => {
  const h = stage({ '决策板D1-D8_2026-09-21.md': SAMPLE });
  const state = path.join(h.dir, 'project-state.md'); fs.writeFileSync(state, '【项目状态】卡 D1 D3\n');
  try {
    const withBoard = pack.build({ PROJECT_STATE_FILE: state, DECISION_BOARD_DIR: h.kb }, { purpose: 'live', dataDir: h.dir, memoryBlock: '' });
    assert.ok(withBoard.text.includes('【决策板当前口径（D1–D8 各一行'), withBoard.text);
    assert.ok(withBoard.text.indexOf('【项目状态') < withBoard.text.indexOf('【决策板当前口径'), '决策板排在项目状态后面');
    const part = withBoard.parts.find(p => p.key === 'decision-board');
    assert.ok(part && !part.missing && /#[0-9a-f]{8}$/.test(part.version), JSON.stringify(part));
    assert.ok(pack.stamp(withBoard).contextParts.some(p => p.key === 'decision-board' && p.version === part.version), '版本要进用量账');
    const without = pack.build({ PROJECT_STATE_FILE: state, DECISION_BOARD_DIR: path.join(h.dir, 'nope') }, { purpose: 'live', dataDir: h.dir, memoryBlock: '' });
    assert.ok(!without.text.includes('决策板当前口径'));
    assert.equal(without.parts.find(p => p.key === 'decision-board').missing, true);
    assert.equal(pack.stamp(without).contextParts.find(p => p.key === 'decision-board').version, 'missing');
  } finally { h.clean(); }
});
