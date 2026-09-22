'use strict';
// 回看页大改（REQ-004 + 09-22 拍板四条）的合成样例：一场 4 个声音（0 / 1 / 2 / 3）、两个议题、四条待办的小会。
// 只有 1 号认了名（Cary Luo），其余是「未认人」。测试和截图共用这一份；真实会议不进仓库（本地资料不上云）。
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const START = Date.parse('2026-09-22T06:23:16.507Z');
const rows = [
  ['0', 5, '我们今天先把任务表的逻辑对一下。'], ['1', 22, '项目设目标，任务达目标，完成后分决策、知识、归档三种去向。'],
  ['2', 48, '硬件的内容要不要单独拆一个工作区？'], ['1', 70, '暂时不拆，留在团队协作区，部分 agent 直接读那里。'],
  ['3', 96, '我的工作区权限还是不对，建不了文档。'], ['0', 120, '这个先找公司 AI 核实，会议继续。'],
  ['1', 150, '硬件项目改用 Linear 管理，加一道谁创建谁 check。'], ['2', 180, '同意，我来把现有材料录进任务表。'],
  ['0', 205, '那 CDCP 材料谁准备？'], ['3', 220, '我准备，下周前给一版。'],
];
const session = {
  id: 'review-redo-1', title: '对对硬件notion', topicTitle: 'AIOS 任务表与硬件工作区', start: new Date(START).toISOString(), end: START + 240e3,
  names: { 1: 'Cary Luo' }, uiLang: 'zh', source: 'tinghuitai', summary: '',
  transcript: rows.map(([spk, at, text], i) => ({ id: 's' + (i + 1), at: START + at * 1000, t: Math.floor(at / 60) + ':' + String(at % 60).padStart(2, '0'), speaker: spk, text })),
  highlights: [], todos: [], factchecks: [], notes: '', fixes: [],
  calendar: { checkedAt: START, event: { title: '对对硬件notion', start: '2026-09-22T14:15:00+08:00', end: '2026-09-22T15:00:00+08:00', organizer: 'Cary Luo', attendees: ['Cary Luo', 'Aaron Wang', '新宇', 'Abel Mei'], eventId: 'ev_fixture', confidence: 'high' } },
};
const brief = {
  at: '2026-09-22T07:10:00.000Z', duration: 240,
  meta: { scope: 'S0 和 S1 对齐任务表逻辑、硬件工作区去留与 CDCP 材料分工' },
  questions: [],
  overview: {
    topics: [{ n: 1, title: '任务表逻辑与硬件工作区', from: 5, to: 150 }, { n: 2, title: '任务管理工具与分工', from: 150, to: 230 }],
    conclusions: ['任务表以项目定目标、任务达目标，完成后分决策 / 知识 / 归档三种去向', '硬件内容暂不拆工作区，留在团队协作区', '硬件项目改用 Linear 管理，加「谁创建谁 check」'],
    todos: [
      { what: 'S3 准备 CDCP 相关材料', owner: 'S3', ownerSource: 'meeting', due: '', topic: 2 },
      { what: '找公司 AI 核实 S3 的工作区权限', owner: '', ownerSource: '', due: '', topic: 1 },
      { what: 'S2 把现有材料录进任务表', owner: 'S2', ownerSource: 'meeting', due: '', topic: 2 },
      { what: '在 Linear 里给硬件项目加 check 环节', owner: 'Cary Luo', ownerSource: 'suggested', due: '', topic: 2 },
    ],
  },
  topics: [
    { n: 1, conclusion: '任务表逻辑定了；硬件内容不拆工作区', decision: '已一致', points: [{ text: 'S1 讲了三种去向', at: 22, seg: 's2' }, { text: 'S2 问要不要拆硬件工作区', at: 48, seg: 's3' }, { text: 'S3 的权限问题没查清', at: 96, seg: 's5' }], open: ['S3 的工作区权限原因'] },
    { n: 2, conclusion: '硬件改用 Linear；S3 准备 CDCP 材料', decision: '已一致', points: [{ text: '加一道谁创建谁 check', at: 150, seg: 's7' }, { text: 'S3 下周前给一版材料', at: 220, seg: 's10' }], open: [] },
  ],
  review: { contextLoaded: true, errors: [], facts: [{ text: 'CDCP 已延期、新日期未定（Aaron 09-17 口述）', source: 'project-state.md' }], alignment: [{ goal: 'CDCP', status: '推进', note: '材料分工落到了人' }], advice: [], checked: [] },
};
const enhanced = { ...session, brief };
const actions = {
  sessionId: session.id, generatedAt: '2026-09-22T07:12:00.000Z', briefAt: brief.at, status: 'done', classifiedBy: 'model', thinking: { position: '卡在 CDCP 材料还没起草' }, risks: [], warnings: [],
  cards: [
    { id: 'c-' + 'a'.repeat(12), kind: 'self', text: 'S3 准备 CDCP 相关材料', owner: 'S3', due: '', reason: '会上 S3 自己认领', state: 'open' },
    { id: 'c-' + 'b'.repeat(12), kind: 'research', text: '找公司 AI 核实 S3 的工作区权限', owner: '', due: '', reason: '当场没查清', state: 'open', draft: { scope: '权限与空间归属', sources: ['飞书管理后台'], expected: '一句结论', refs: [] } },
    { id: 'c-' + 'c'.repeat(12), kind: 'self', text: 'S2 把现有材料录进任务表', owner: 'S2', due: '', reason: 'S2 会上认领', state: 'open' },
    { id: 'c-' + 'd'.repeat(12), kind: 'delegate', text: '在 Linear 里给硬件项目加 check 环节', owner: 'Cary Luo', due: '', reason: 'Cary 管 Linear', state: 'open', draft: { assignee: 'Cary Luo', due: '2026-09-25', dueDefault: true, description: '在 Linear 里给硬件项目加 check 环节', links: [] } },
  ],
};
// 把这一场摆进一个数据目录：pending 原始记录 + 归档结果 + 处理台卡片。服务端按这三份读，不用跑管线。
function install(dataDir, { withActions = true, withBrief = true } = {}) {
  const pipe = path.join(dataDir, 'state/meeting-pipeline'), pend = path.join(dataDir, 'pending');
  fs.mkdirSync(pipe, { recursive: true }); fs.mkdirSync(pend, { recursive: true });
  const key = crypto.createHash('sha256').update(session.id).digest('hex').slice(0, 16);
  fs.writeFileSync(path.join(pend, 'sess-' + session.id + '.json'), JSON.stringify(session));
  fs.writeFileSync(path.join(pipe, key + '.input.json'), JSON.stringify(session));
  fs.writeFileSync(path.join(pipe, key + '.job.json'), JSON.stringify({ schema: 2, key, sessionId: session.id, title: session.title, status: 'done', summaryGenerated: true, fullTextVerified: true, phase: '完成', created: '2026-09-22T07:05:00.000Z', updated: '2026-09-22T07:10:00.000Z', attempts: 1, input: path.join(pipe, key + '.input.json') }));
  fs.writeFileSync(path.join(pipe, key + '.job.enhanced.json'), JSON.stringify(withBrief ? enhanced : { ...session, brief: null }));
  if (withActions) fs.writeFileSync(path.join(pipe, key + '.actions.json'), JSON.stringify(actions));
  return { key, id: session.id };
}
module.exports = { session, brief, enhanced, actions, install };
