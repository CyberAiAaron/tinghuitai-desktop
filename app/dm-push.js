'use strict';
// 会后自动私聊推送（Aaron 2026-09-24 13:20）：会后整理（brief）出来以后，把「军师怎么看」前 3 条想法的标题
// + 行动（一人一行）压成一张 ≤8 行的飞书卡片，只发 Aaron 本人私聊，按钮直达这场的回看页。
// 规矩：
//   1) 收件人写死 Aaron 本人，而且只在 飞书命令行登录的就是他本人时才发（= 「发给我自己」）。别人的机器、试用版一律跳过。
//   2) 没装 / 没登录飞书命令行：静默跳过，不报错、不打扰。
//   3) 每场只发一次：收据走 send-gate（state/send-receipts/meeting-dm/），重跑整理不重发；结果不确定时也不重发。
//   4) 开关 MEETING_DM_PUSH，默认 on；设 off 就不发。
const sendGate = require('./send-gate');
const archiveV2 = require('./archive-v2');

const AARON_OPEN_ID = 'ou_00c28e8ed0b15769a9a5f5e4ea36f7e8';
const KIND = 'meeting-dm';
const clip = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const strip = s => String(s || '').replace(/\*\*|__|`|^#+\s*/g, '').trim();

// 想法标题：insights_md 每段取标题（加粗行 / 小标题），没有就取段首句；@人名 的行不算想法
function ideaTitles(md, max = 3) {
  const out = [];
  for (const para of String(md || '').split(/\n\s*\n/)) {
    const lines = para.split('\n').map(l => l.trim()).filter(Boolean).filter(l => !/^(?:[-*+]\s*)?(?:\*\*)?@/.test(l));
    if (!lines.length) continue;
    const head = lines.find(l => /^#{1,6}\s/.test(l) || /^\*\*[^*]+\*\*[：:]?$/.test(l)) || lines[0];
    const t = clip(strip(head).split(/(?<=[。！？!?])/)[0], 36);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

// 行动一人一行：同一个人的多条合并，用「；」连
function actionLines(insights, max) {
  const by = new Map();
  for (const i of insights || []) { const who = i.owner || i.named || '待定'; if (!by.has(who)) by.set(who, []); by.get(who).push(i.action); }
  return [...by].slice(0, max).map(([who, acts]) => '@' + who + '：' + clip(acts.join('；'), 60));
}

// 卡片：标题 = 会名；正文 ≤7 行（想法 ≤3 + 行动补满）；1 个按钮。
function buildCard({ title, result, url }) {
  const view = archiveV2.buildView(result || {});
  // 老场次 / 军师没出正文：想法退到纪要结论，行动退到纪要待办（有负责人的）
  let ideas = ideaTitles(view.insightsMd, 3);
  if (!ideas.length) ideas = (view.minutes.conclusions || []).slice(0, 3).map(t => clip(t, 36));
  let src = view.insights;
  if (!src.length) src = (view.minutes.todos || []).map(t => ({ owner: t.owner || '待定', action: t.text }));
  const acts = actionLines(src, 7 - ideas.length);
  const lines = [...ideas.map(t => '• ' + t), ...acts];
  const card = {
    config: { wide_screen_mode: true },
    header: { template: 'grey', title: { tag: 'plain_text', content: clip(title || '会议', 40) } },
    elements: [
      ...(lines.length ? [{ tag: 'div', text: { tag: 'lark_md', content: lines.join('\n') } }] : []),
      { tag: 'action', actions: [{ tag: 'button', type: 'primary', text: { tag: 'plain_text', content: '打开回看页' }, url }] },
    ],
  };
  return { card, lines };
}

// 入口。返回 {skipped:原因} 或收据。不抛。
async function push({ sessionId, title, result, env = {}, dataDir, pageBase, lark, log = () => {} }) {
  const sid = String(sessionId || '');
  try {
    if (!sid) return { skipped: 'no-session' };
    if (String(env.MEETING_DM_PUSH || 'on').toLowerCase() === 'off') return { skipped: 'off' };
    if (!lark || !lark.larkAvailable().ok) return { skipped: 'no-lark' };
    if (!buildCard({ title, result, url: '' }).lines.length) return { skipped: 'no-content' };
    const self = await lark.selfOpenId();
    if (self !== AARON_OPEN_ID) return { skipped: self ? 'not-aaron' : 'no-lark' };
    const url = String(pageBase || 'http://127.0.0.1:47823').replace(/\/$/, '') + '/tinghuitai/archive.html?id=' + encodeURIComponent(sid);
    const { card, lines } = buildCard({ title, result, url });
    // 自动管线没有「界面上那一下」：Aaron 09-24 口头批准过这条只发给他自己的推送，confirmed 由这里代出。
    const r = await sendGate.send({ dataDir, kind: KIND, key: sid, body: { confirmed: true }, meta: { sessionId: sid, to: AARON_OPEN_ID },
      run: async () => {
        const s = await lark.cardSend({ openId: AARON_OPEN_ID, card, idem: 'tht-dm-' + sendGate.hash(sid).slice(0, 32) });
        if (!s.ok) { const e = Error(s.error || '发送失败'); e.definite = !s.uncertain; throw e; }
        return { messageId: s.messageId, lines: lines.length };
      } });
    log('会后私聊推送 ' + sid + (r.alreadySent ? ' 已发过' : ' 已发 ' + (r.messageId || '')));
    return r;
  } catch (e) {
    log('会后私聊推送没发 ' + sid + ' ' + e.message);
    return { skipped: e.uncertain || e.code === 409 ? 'uncertain' : 'error', error: e.message };
  }
}

module.exports = { push, buildCard, ideaTitles, actionLines, AARON_OPEN_ID, KIND };
