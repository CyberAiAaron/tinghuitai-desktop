'use strict';
// 飞书工具。读类两条（搜文档、取文档），写类两条（建日历、建任务）。
// 写类只有界面点「发出 / 派发」那条路能执行（登记表里的 confirmedByUser 门禁），模型和 MCP 永远拿不到。
//
// 真实命令形状（2026-09-22 用 --as user 只读实测）：
//   lark-cli docs +search --query <词> --as user --page-size 15 --format json
//     → { ok, data:{ has_more, page_token, total, results:[{ entity_type, title_highlighted, summary_highlighted,
//          result_meta:{ token, url, doc_types, owner_name, edit_user_name, create_time_iso, update_time_iso, last_open_time_iso } }] } }
//     标题和摘要里命中的词被 <h></h> 包着，要剥掉再给人看。
//   lark-cli docs +fetch --doc <token|url> --as user --doc-format markdown --format json [--scope outline|keyword --keyword <词>]
//     → { ok, data:{ document:{ content, document_id, revision_id } } }
const reg = require('./index');
const { runCli, larkAvailable, resolveIds, clip } = require('./lark-cli');

const unTag = s => String(s || '').replace(/<\/?h>/g, '');
const dig = (o, ...ks) => { for (const k of ks) { const v = k.split('.').reduce((x, p) => (x == null ? x : x[p]), o); if (typeof v === 'string' && v) return v; } return ''; };

reg.register({
  name: 'lark.docs.search', title: '搜飞书文档', level: 'read', source: 'lark',
  description: '按关键词搜飞书云文档和知识库（Search v2）。返回标题、摘要、文档 token 和链接；要正文再用 lark.docs.fetch。',
  input: { type: 'object', required: ['query'], properties: {
    query: { type: 'string', minLength: 1, maxLength: 200 },
    limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
  } },
  available: () => larkAvailable(),
  async run(args, ctx) {
    const r = await runCli(['docs', '+search', '--query', args.query, '--as', 'user',
      '--page-size', String(Math.min(20, args.limit || 8)), '--format', 'json'],
      { execImpl: ctx.execImpl, log: ctx.log, timeout: 30000 });
    if (!r.ok) return { ok: false, error: r.error };
    const results = ((r.json || {}).data || {}).results || [];
    return { ok: true, items: results.slice(0, args.limit).map(x => {
      const m = x.result_meta || {};
      return {
        title: clip(unTag(x.title_highlighted), 200),
        text: clip(unTag(x.summary_highlighted), 400),
        docType: x.entity_type || '', token: m.token || '', url: m.url || '',
        owner: m.owner_name || '', lastEditedBy: m.edit_user_name || '',
        ref: m.token ? 'lark:' + m.token : 'lark:' + clip(unTag(x.title_highlighted), 40),
        source: 'lark:docs', at: m.update_time_iso || m.create_time_iso || '',
      };
    }) };
  },
});

reg.register({
  name: 'lark.docs.fetch', title: '取飞书文档正文', level: 'read', source: 'lark',
  description: '按文档 token 或链接取正文（Markdown）。scope=outline 只取目录，scope=keyword 配 keyword 只取命中的那几段——整份很长时先用这两种。',
  input: { type: 'object', required: ['doc'], properties: {
    doc: { type: 'string', minLength: 6, maxLength: 400, description: '文档 token 或飞书链接' },
    scope: { type: 'string', enum: ['full', 'outline', 'keyword'], default: 'outline' },
    keyword: { type: 'string', maxLength: 120, description: 'scope=keyword 时要找的词，支持 a|b 这种或关系' },
  } },
  available: () => larkAvailable(),
  async run(args, ctx) {
    const doc = String(args.doc).trim();
    if (!/^https?:\/\//.test(doc) && !/^[A-Za-z0-9]{8,64}$/.test(doc)) return { ok: false, error: 'doc 要是飞书链接或文档 token' };
    if (/^https?:\/\//.test(doc)) {
      let host = ''; try { host = new URL(doc).hostname; } catch (e) {}
      if (!/(^|\.)(larksuite\.com|feishu\.cn|doubao\.com)$/.test(host)) return { ok: false, error: '这不是飞书文档链接' };
    }
    const a = ['docs', '+fetch', '--doc', doc, '--as', 'user', '--doc-format', 'markdown', '--format', 'json'];
    if (args.scope === 'outline') a.push('--scope', 'outline');
    if (args.scope === 'keyword') {
      if (!args.keyword) return { ok: false, error: 'scope=keyword 要同时给 keyword' };
      a.push('--scope', 'keyword', '--keyword', args.keyword, '--context-before', '1', '--context-after', '2');
    }
    const r = await runCli(a, { execImpl: ctx.execImpl, log: ctx.log, timeout: 60000 });
    if (!r.ok) return { ok: false, error: r.error };
    const d = ((r.json || {}).data || {}).document || {};
    const content = String(d.content || '');
    if (!content) return { ok: false, error: '这份文档没读到正文（可能没权限，或这一段是空的）' };
    return { ok: true, data: {
      text: content, docId: d.document_id || '', revision: d.revision_id || 0, scope: args.scope || 'outline',
      ref: 'lark:' + (d.document_id || doc), source: 'lark:docs', at: String(d.revision_id || ''),
      url: /^https?:\/\//.test(doc) ? doc : '',
    } };
  },
});

// ===== 写类：只有界面点击那条路能走到 =====
reg.register({
  name: 'lark.calendar.create', title: '建飞书日历', level: 'write', source: 'lark',
  description: '按草稿建一场飞书日历。只有你在界面上点「发出会议邀请」才会执行。',
  input: { type: 'object', required: ['title', 'start', 'end'], properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    start: { type: 'string', minLength: 10, maxLength: 40, description: '本机时区的 ISO 串' },
    end: { type: 'string', minLength: 10, maxLength: 40 },
    note: { type: 'string', maxLength: 400, default: '' },
    agenda: { type: 'array', maxItems: 10, default: [], items: { type: 'string', maxLength: 200 } },
    attendees: { type: 'array', maxItems: 20, default: [], items: { type: 'string', maxLength: 40 } },
  } },
  available: () => larkAvailable(),
  async run(args, ctx) {
    const opts = { execImpl: ctx.execImpl, log: ctx.log };
    const got = args.attendees.length ? await resolveIds(args.attendees, opts) : { ok: true, ids: [], missing: [] };
    const ids = got.ids || [], missing = got.missing || [];
    const desc = [args.note, args.agenda.length ? '议程：\n' + args.agenda.map((x, i) => (i + 1) + '. ' + x).join('\n') : '',
      missing.length ? '（还没解析到飞书账号的人：' + missing.join('、') + '）' : ''].filter(Boolean).join('\n\n');
    const a = ['calendar', '+create', '--as', 'user', '--summary', args.title, '--start', args.start, '--end', args.end, '--format', 'json'];
    if (desc) a.push('--description', desc);
    if (ids.length) a.push('--attendee-ids', ids.join(','));
    const r = await runCli(a, opts);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, data: {
      url: dig(r.json, 'data.event.app_link', 'data.event.url', 'data.app_link', 'data.url'),
      id: dig(r.json, 'data.event.event_id', 'data.event_id'), missing,
      ref: 'lark:calendar:' + (dig(r.json, 'data.event.event_id', 'data.event_id') || ''), source: 'lark:calendar', at: args.start,
    } };
  },
});

reg.register({
  name: 'lark.task.create', title: '建飞书任务', level: 'write', source: 'lark',
  description: '按草稿建一条飞书任务并派给人。只有你在界面上点「派发」才会执行。',
  input: { type: 'object', properties: {
    description: { type: 'string', maxLength: 2000, default: '' },
    assignee: { type: 'string', maxLength: 60, default: '' },
    assigneeId: { type: 'string', maxLength: 80, default: '' },
    due: { type: 'string', maxLength: 10, default: '', description: 'YYYY-MM-DD' },
    links: { type: 'array', maxItems: 6, default: [], items: { type: 'string', maxLength: 400 } },
  } },
  available: () => larkAvailable(),
  async run(args, ctx) {
    const opts = { execImpl: ctx.execImpl, log: ctx.log };
    const summary = args.description.split('\n')[0].slice(0, 120) || args.assignee;
    if (!summary) return { ok: false, error: '草稿是空的' };
    const a = ['task', '+create', '--as', 'user', '--summary', summary, '--format', 'json'];
    const body = [args.description, args.links.length ? '相关链接：\n' + args.links.join('\n') : ''].filter(Boolean).join('\n\n');
    if (body) a.push('--description', body);
    if (/^\d{4}-\d{2}-\d{2}$/.test(args.due)) a.push('--due', 'date:' + args.due);
    let assigneeId = /^(?:ou_|cli_)[A-Za-z0-9]{1,64}$/.test(args.assigneeId) ? args.assigneeId : '';
    let miss = '';
    if (!assigneeId && args.assignee) { const got = await resolveIds([args.assignee], opts); assigneeId = (got.ids || [])[0] || ''; }
    // 解析不到账号就不硬派：任务照建，把人名写进说明，并在卡片上说清「没派到人」，不让它悄悄丢。
    if (assigneeId) a.push('--assignee', assigneeId);
    else if (args.assignee) {
      miss = args.assignee;
      const add = '（没解析到 ' + miss + ' 的飞书账号，这条先挂在我名下）', i = a.indexOf('--description');
      if (i >= 0) a[i + 1] += '\n\n' + add; else a.push('--description', add);
    }
    const r = await runCli(a, opts);
    if (!r.ok) return { ok: false, error: r.error };
    const id = dig(r.json, 'data.task.guid', 'data.task.task_id', 'data.guid');
    return { ok: true, data: {
      url: dig(r.json, 'data.task.url', 'data.url'), id,
      note: miss ? '没解析到 ' + miss + ' 的飞书账号，任务建了但没派到人' : '',
      ref: 'lark:task:' + id, source: 'lark:task', at: args.due || '',
    } };
  },
});
