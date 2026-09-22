'use strict';
// 第一个用上工具权限层的地方：会后处理台的「预研究」。
// 以前这一页全靠模型自己的印象写，没法验证。现在盯住三件事：
//   ① 引擎先替模型查了本机会议 / 记忆 / 项目资料，模型收到的是真资料
//   ② 草稿里带「依据」，每条能回到原处（会议 ref 带 meetingId，本机文件 ref 带路径和当时的修改时间）
//   ③ 这一问走 noFallback——本机文件的原文进了 prompt，就不能顺着降级链发给第二家
//   ④ 模型一条工具都没用上时不编依据，那一块干脆不出现
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const actions = require('../app/actions');
const llm = require('../app/llm');

const tmp = tag => fs.mkdtempSync(path.join(os.tmpdir(), 'tht-' + tag + '-'));
const write = (f, j) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof j === 'string' ? j : JSON.stringify(j)); };

const ENHANCED = {
  id: 'sess-ref-1', topicTitle: 'AI Phone 会议记录场景',
  brief: { overview: {
    topics: [{ n: 1, title: '白板内容理解' }],
    conclusions: ['白板内容理解这条要先做实验原型'],
    todos: [
      { what: '调研一下白板 OCR 全球做得最强的几家供应商', owner: '', due: '' },
      { what: '把 D1 结论写进决策板', owner: 'Aaron Wang', due: '2026-09-30' },
    ],
  }, review: { advice: [], errors: [], facts: [], alignment: [], checked: [], contextLoaded: true } },
};

function fixture() {
  const dir = tmp('refs');
  // 本机另一场会，正好谈过白板 OCR：预研究应该引用到它
  write(path.join(dir, 'state/meeting-pipeline/old.job.enhanced.json'), {
    id: 'sess-ref-old', topicTitle: '09-17 会议记录场景评审', start: '2026-09-17T09:58:17.476Z',
    brief: { overview: { conclusions: ['白板 OCR 要实测一遍，像素阈值倒推不一定能判断可用性'], todos: [], topics: [] } },
    transcript: [{ t: 1, text: '白板 OCR 的供应商名单要用 AI 检索一遍，避开中国厂商' }],
  });
  const ctxDir = path.join(dir, 'proj');
  write(path.join(ctxDir, 'kb_reorg/02_总纲.md'), '# 总纲\n\n## 白板\n\n白板内容理解定的指标取向是实时性低、组织性高。\n');
  return { dir, ctxDir };
}

const stub = (fn, run) => { const orig = llm.ask; llm.ask = fn; return Promise.resolve().then(run).finally(() => { llm.ask = orig; }); };

// 假模型：分类照规则来；预研究这一问要能看到引擎查回来的资料，并把其中一个 ref 抄进 refs
function fakeAsk(seen) {
  return async (env, opts) => {
    seen.push({ system: opts.system, user: opts.user, noFallback: !!opts.noFallback });
    const s = opts.system || '';
    const answer = j => ({ text: JSON.stringify(j), provider: 'stub', degraded: false, attempts: [] });
    if (/事项分类/.test(s)) return answer({ items: JSON.parse(opts.user).map(c => ({ i: c.i, kind: actions.classifyByRules({ text: c.text, owner: c.owner }), reason: '规则' })) });
    if (/预研究一页/.test(s)) {
      const idx = JSON.parse(opts.user.slice(opts.user.indexOf('要预研究的事项：') + 8));
      // 从工具结果块里挑一个真实 ref 抄回来，模拟「模型用了这条资料」
      const m = opts.user.match(/"ref":"(meeting:[^"]+)"/);
      return answer({ items: idx.map(x => ({ i: x.i, scope: '覆盖全球白板 OCR 供应商', sources: ['厂商官网'], expected: '一张对照表', refs: m ? [m[1]] : [] })) });
    }
    if (/整条项目线上处在什么位置/.test(s)) return answer({ position: '卡在实验原型没做' });
    if (/有没有硬冲突/.test(s)) return answer({ risks: [] });
    return answer({});
  };
}

test('预研究：引擎先查本机资料，草稿带能回到原处的依据，而且这一问不往降级链第二家发', async () => {
  const { dir, ctxDir } = fixture();
  const seen = [];
  const env = { PROJECT_CONTEXT_DIR: ctxDir, PROJECT_CONTEXT_FILES: ['kb_reorg/*.md'] };
  const out = await stub(fakeAsk(seen), () => actions.generate({
    dir: path.join(dir, 'actions'), sessionId: ENHANCED.id, enhanced: ENHANCED, attendees: [], env, dataDir: dir, log: () => {},
  }));

  const card = out.cards.find(c => c.kind === 'research');
  assert.ok(card, '有一张「让我做的研究」');
  assert.ok(card.draft, '草稿出来了');
  assert.ok(card.draft.refs.length > 0, '带了依据');

  const meetingRef = card.draft.refs.find(r => r.ref.startsWith('meeting:'));
  assert.ok(meetingRef, '引用到了本机那场谈过白板 OCR 的会');
  assert.equal(meetingRef.meetingId, 'sess-ref-old');
  assert.equal(meetingRef.source, 'local:meeting');
  assert.ok(meetingRef.title, '每条依据有句人话，不是光一个 ref');
  const fileRef = card.draft.refs.find(r => r.ref.startsWith('file:'));
  if (fileRef) assert.match(fileRef.ref, /@\d{4}-\d{2}-\d{2}T/, '本机文件的依据带当时的修改时间');

  const pre = seen.filter(x => /预研究一页/.test(x.system));
  assert.equal(pre.length, 1, '一场会只问一次预研究，不是一条卡片一次');
  assert.equal(pre[0].noFallback, true, '本机资料进了 prompt，就只许发给链上第一家');
  assert.match(pre[0].user, /【工具结果 · 第 1 批】/, '模型看到的是引擎查回来的真资料');
  assert.match(pre[0].user, /白板 OCR/);
  assert.match(pre[0].system, /【可用工具】/);
  assert.doesNotMatch(pre[0].system, /lark\.task\.create/, '写类工具名一个都不给它看');
});

test('预研究：本机什么都查不到时不编依据，那一块干脆不出现', async () => {
  const dir = tmp('refs-empty');
  const seen = [];
  const out = await stub(fakeAsk(seen), () => actions.generate({
    dir: path.join(dir, 'actions'), sessionId: ENHANCED.id, enhanced: ENHANCED, attendees: [], env: {}, dataDir: dir, log: () => {},
  }));
  const card = out.cards.find(c => c.kind === 'research');
  assert.ok(card.draft);
  assert.deepEqual(card.draft.refs, []);
  assert.ok(card.draft.scope, '正文照写，只是没有依据可挂');
});

test('页面上改过再存回来，依据不会被洗掉', () => {
  const kept = actions.sanitizeDraft('research', {
    scope: '改了一版', sources: ['厂商官网'], expected: '一张表',
    refs: [{ ref: 'meeting:sess-ref-old#结论', title: '白板 OCR 要实测一遍', source: 'local:meeting', at: '2026-09-17T09:58:17.476Z', meetingId: 'sess-ref-old', url: '/tinghuitai/archive.html?id=sess-ref-old' },
           { ref: '', title: '空的这条应该被丢掉' }],
  });
  assert.equal(kept.refs.length, 1);
  assert.equal(kept.refs[0].meetingId, 'sess-ref-old');
  assert.equal(kept.scope, '改了一版');
});

test('页面上的「依据」这一块：会议能点回那一场，没有依据就整块不出现', () => {
  const vm = require('vm');
  const src = fs.readFileSync(path.join(__dirname, '../web/archive.js'), 'utf8');
  const part = src.slice(src.indexOf('function draftHtml('), src.indexOf('function meetingForm('));
  const ctx = { T: (zh) => zh, esc: s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    meetingForm: () => '', delegateForm: () => '' };
  vm.createContext(ctx);
  vm.runInContext(part, ctx);

  const html = ctx.draftHtml({ kind: 'research', draft: {
    scope: '覆盖全球白板 OCR 供应商', sources: ['厂商官网'], expected: '一张对照表',
    refs: [
      { ref: 'meeting:sess-ref-old#79', title: '白板 OCR 的供应商名单要用 AI 检索一遍', source: 'local:meeting', at: '2026-09-17T09:58:17.476Z', meetingId: 'sess-ref-old' },
      { ref: 'lark:COqzdi', title: '产品需求总纲', source: 'lark:docs', at: '2026-09-20T09:00:00+08:00', url: 'https://x.feishu.cn/docx/COqzdi' },
      { ref: 'file:/tmp/a.md@2026-09-20T01:00:00.000Z', title: '白板内容理解的指标取向', source: 'local:file', at: '2026-09-20T01:00:00.000Z' },
    ],
  } });
  assert.match(html, /依据/);
  assert.match(html, /archive\.html\?id=sess-ref-old/, '会议那条点得回去');
  assert.match(html, /白板 OCR 的供应商名单要用 AI 检索一遍/, '写的是凭哪句话，不是光一个编号');
  assert.match(html, /href="https:\/\/x\.feishu\.cn\/docx\/COqzdi"/, '飞书文档点得开原文');
  assert.ok(!/href="file:/.test(html), '本机文件不做成链接，浏览器点不开');
  assert.match(html, /会议/, '来源标签写人话');
  assert.match(html, /飞书文档/);
  assert.match(html, /本机文件/);
  assert.doesNotMatch(html, /local:meeting|lark:docs/, '不把工具层的内部来源码摆到页面上');

  const bare = ctx.draftHtml({ kind: 'research', draft: { scope: 'x', expected: 'y', refs: [] } });
  assert.doesNotMatch(bare, /依据/, '没有依据就整块不出现，不写「无」');
});
