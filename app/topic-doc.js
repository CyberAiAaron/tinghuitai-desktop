'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const llm = require('./llm');
const defaultSendGate = require('./send-gate');
const defaultLark = require('./tools/lark');
const defaultTopics = require('./topics.json');

const topicDocRoutes = require('./topic-doc-routes');
const SECTIONS = ['未决问题', '讨论中', '最新进展', '下一步最重要的事'];
const MAX_TEXT = 60;

function bad(message, code = 400) {
  const error = Error(message);
  error.code = code;
  return error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function searchable(value) {
  const parts = [];
  const visit = current => {
    if (Array.isArray(current)) return current.forEach(visit);
    if (current && typeof current === 'object') return Object.keys(current).sort().forEach(key => visit(current[key]));
    if (current != null) parts.push(String(current));
  };
  visit(stable(value));
  return parts.join('\n').normalize('NFKC').toLocaleLowerCase();
}

function classifyWith(topics, enhanced) {
  if (!enhanced || typeof enhanced !== 'object') return null;
  const haystack = searchable(enhanced);
  if (!haystack) return null;
  for (const [name, config] of Object.entries(topics || {})) {
    if (!config || !Array.isArray(config.keywords)) continue;
    for (const keyword of config.keywords) {
      const needle = String(keyword || '').normalize('NFKC').toLocaleLowerCase();
      if (needle && haystack.includes(needle)) return name;
    }
  }
  return null;
}

function extractJson(raw) {
  const text = String(raw || '').trim();
  if (!text) throw bad('模型没有返回主题差异', 502);
  try { return JSON.parse(text); } catch (error) {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch (error) {}
  }
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (error) {}
  }
  throw bad('模型返回的主题差异不是合法 JSON', 502);
}

function evidenceIds(enhanced) {
  const ids = new Set();
  const visit = current => {
    if (Array.isArray(current)) return current.forEach(visit);
    if (!current || typeof current !== 'object') return;
    if (typeof current.seg === 'string' && current.seg.trim()) ids.add(current.seg.trim());
    for (const value of Object.values(current)) visit(value);
  };
  visit(enhanced);
  return ids;
}

function rawItems(parsed) {
  if (Array.isArray(parsed && parsed.items)) return parsed.items;
  if (!Array.isArray(parsed && parsed.sections)) return [];
  const out = [];
  for (const group of parsed.sections) {
    if (!group || typeof group !== 'object' || !Array.isArray(group.items)) continue;
    for (const item of group.items) out.push({ ...item, section: item.section || group.section });
  }
  return out;
}

function itemId(meetingId, topic, item) {
  const source = [meetingId, topic, item.section, item.text, ...item.evidence].join('\u001f');
  return 'td-' + crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
}

function validateDiff(parsed, enhanced, meetingId, topic) {
  if (!Array.isArray(parsed && parsed.sections) || parsed.sections.length !== SECTIONS.length) throw bad('主题差异必须完整包含四个章节', 502);
  const names = parsed.sections.map(group => String(group && group.section || '').trim());
  if (new Set(names).size !== SECTIONS.length || SECTIONS.some(section => !names.includes(section))) throw bad('主题差异必须完整包含四个章节', 502);
  const allowedEvidence = evidenceIds(enhanced);
  const items = rawItems(parsed).map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw bad('主题差异第 ' + (index + 1) + ' 条不是对象', 502);
    const section = String(raw.section || '').trim();
    if (!SECTIONS.includes(section)) throw bad('主题差异包含未知章节：' + section, 502);
    const text = String(raw.text || '').trim();
    if (!text) throw bad('主题差异第 ' + (index + 1) + ' 条没有内容', 502);
    if ([...text].length > MAX_TEXT) throw bad('主题差异第 ' + (index + 1) + ' 条超过 60 字', 502);
    if (!Array.isArray(raw.evidence) || !raw.evidence.length) throw bad('主题差异第 ' + (index + 1) + ' 条没有证据段', 502);
    const evidence = [...new Set(raw.evidence.map(value => String(value || '').trim()).filter(Boolean))];
    if (!evidence.length || evidence.some(id => !allowedEvidence.has(id))) throw bad('主题差异第 ' + (index + 1) + ' 条引用了不存在的证据段', 502);
    const item = { section, text, evidence, status: 'pending' };
    return { id: itemId(meetingId, topic, item), ...item };
  });
  return SECTIONS.map(section => ({ section, items: items.filter(item => item.section === section) }));
}

function meetingDate(enhanced) {
  const raw = Number(enhanced && (enhanced.start || enhanced.startedAt || enhanced.at));
  if (!Number.isFinite(raw) || raw <= 0) return new Date().toISOString().slice(0, 10);
  return new Date(raw + 8 * 3600e3).toISOString().slice(0, 10);
}

function promptFor(enhanced, docMarkdown, topic) {
  const system = [
    '你只输出 JSON，不写解释。',
    '从会议内容提取相对于主题文档的增量，固定分成四节：' + SECTIONS.join(' / ') + '。',
    '格式：{"sections":[{"section":"未决问题","items":[{"text":"不超过60字","evidence":["逐字稿seg"]}]}]}。',
    '四个 section 都必须出现；没有内容时 items 为空。每条必须引用真实 seg，不能推测决定。',
  ].join('\n');
  const user = [
    '主题：' + topic,
    '现有主题文档：\n' + (String(docMarkdown || '').trim() || '（空）'),
    '会议增强结果：\n' + JSON.stringify(stable(enhanced)),
  ].join('\n\n');
  return { system, user };
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function itemXml(item, record) {
  const source = '来源：会议 ' + record.meetingId + ' ' + record.date;
  return '<h2>' + escapeXml(item.section) + '</h2><p>' + escapeXml(item.text) + '<br/>' + escapeXml(source) + '</p>';
}

function create(options = {}) {
  const dataDir = options.dataDir || process.env.THT_DATA_DIR || process.cwd();
  const topics = options.topics || defaultTopics;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const ask = options.ask || (request => llm.ask(options.env || process.env, request));
  const lark = options.lark || defaultLark;
  const larkOptions = { log, ...(options.larkOptions || {}) };
  const sendGate = options.sendGate || defaultSendGate;

  const diffFile = meetingId => path.join(dataDir, 'state', 'topic-diff', meetingId + '.json');
  const classify = enhanced => classifyWith(topics, enhanced);

  async function computeDiff(enhanced, docMarkdown = '') {
    if (!enhanced || typeof enhanced !== 'object') throw bad('缺会议增强结果');
    const meetingId = String(enhanced.id || enhanced.meetingId || '').trim();
    if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(meetingId)) throw bad('会议编号不对');
    const topic = classify(enhanced);
    if (!topic) return null;
    // 调用方没给正文就自己读飞书那份当基线；读不到就不生成，免得拿空基线写出重复内容
    const docToken = topics[topic] && topics[topic].doc;
    if (!String(docMarkdown || '').trim() && docToken) {
      const fetched = typeof lark.docFetchMarkdown === 'function' ? await lark.docFetchMarkdown(docToken, larkOptions) : { ok: false, error: '缺读文档能力' };
      if (!fetched || !fetched.ok) throw bad('读不到主题文档正文：' + String(fetched && fetched.error || ''), 502);
      docMarkdown = fetched.markdown;
    }
    const prompts = promptFor(enhanced, docMarkdown, topic);
    const response = await ask({ kind: 'post', json: true, tools: false, dataDir, log, ...prompts });
    if (!response || !response.text) throw bad('主题差异生成失败：' + String(response && response.errorCode || '模型无响应'), 502);
    const sections = validateDiff(extractJson(response.text), enhanced, meetingId, topic);
    const record = {
      meetingId,
      meetingTitle: String(enhanced.title || '').trim().slice(0, 200),
      date: meetingDate(enhanced),
      topic,
      owner: topics[topic] && topics[topic].owner || '',
      status: 'pending',
      sections,
    };
    atomicWrite(diffFile(meetingId), record);
    return record;
  }

  function read(meetingId) {
    const id = String(meetingId || '').trim();
    if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(id)) throw bad('会议编号不对');
    try { return JSON.parse(fs.readFileSync(diffFile(id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw bad('还没有主题差异', 404); throw error; }
  }

  async function apply(meetingId, ids, body = {}) {
    // 确认门在服务层也守一道：任何调用路径不带 confirmed:true 都不写飞书
    if (!body || body.confirmed !== true) throw bad('写回飞书需要你在界面上点确认', 403);
    if (!Array.isArray(ids) || !ids.length) throw bad('没有选择要写入的条目');
    const record = read(meetingId);
    const config = topics[record.topic];
    if (!config) throw bad('主题配置不存在', 500);
    const all = (record.sections || []).flatMap(group => Array.isArray(group.items) ? group.items : []);
    const wanted = [...new Set(ids.map(value => String(value || '').trim()).filter(Boolean))];
    const selected = wanted.map(id => all.find(item => item.id === id));
    if (selected.some(item => !item)) throw bad('选择里有不存在的条目');
    if (config.doc == null) return { ok: true, skipped: 'no_document', topic: record.topic, applied: [] };
    const applied = [];
    for (const item of selected) {
      const xml = itemXml(item, record);
      const receipt = await sendGate.send({
        dataDir,
        kind: 'topic-doc',
        key: record.meetingId + ':' + item.id,
        body: { confirmed: true, retryConfirmed: body.retryConfirmed === true },
        meta: { meetingId: record.meetingId, itemId: item.id, topic: record.topic },
        run: async () => {
          const result = await lark.docValidateAppend({ token: config.doc, content: xml }, larkOptions);
          if (!result || result.ok === false) {
            const error = bad('主题文档写入失败：' + String(result && result.error || '未知错误'), 502);
            error.definite = !(result && result.uncertain);
            throw error;
          }
          return { revision: String(result.revision || '') };
        },
      });
      log('topic-doc ' + record.topic + ' ' + record.meetingId + ' ' + item.id + ' ' + (receipt.alreadySent ? 'already-sent' : 'sent'));
      applied.push({ id: item.id, alreadySent: !!receipt.alreadySent });
    }
    return { ok: true, topic: record.topic, applied };
  }

  const service = { classify, computeDiff, read, apply };
  service.routes = router => topicDocRoutes.mount(router, service);
  return service;
}

module.exports = { create, SECTIONS, MAX_TEXT, __test: { stable, searchable, classifyWith, extractJson, validateDiff, promptFor, itemXml } };
