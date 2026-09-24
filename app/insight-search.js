'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const web = require('./tools/web');
const FIXED_BLOCKLIST = ['chansey', '26191', 'nothing'];
const NAME_STOPWORDS = new Set(['AI', 'Phone', 'Project', 'Brain', 'Product', 'Owner', 'Context', 'Trust', 'Mac', 'Codex', 'Claude', 'Lark', 'Slack',
  'Meeting', 'Review', 'Daily', 'Sync', 'User', 'Trial', 'One', 'Pager', 'Remote', 'Control', 'Device', 'Model', 'Design', 'System',
  'Development', 'Cloud', 'Edge', 'Layer', 'Bridge', 'Agent', 'Workshop', 'Weekly', 'Catch', 'OpenAI', 'Apple', 'Microsoft']);

function projectDir(options = {}) {
  const env = options.env || process.env;
  return options.projectDir || env.PROJECT_CONTEXT_DIR || env.THT_PROJECT_CONTEXT_DIR || path.join(os.homedir(), 'This is my Chansey');
}
function latestDecisionBoard(root) {
  try { return fs.readdirSync(path.join(root, 'kb_backup')).filter(name => /^决策板D1-D8_.*\.md$/.test(name)).sort().at(-1) || ''; }
  catch (_) { return ''; }
}
function extractNames(text) {
  const names = new Set(), source = String(text || '');
  const addLatin = fragment => {
    for (const match of String(fragment || '').matchAll(/\b[A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20}){0,2}\b/g)) {
      const name = match[0].trim(), words = name.split(/\s+/);
      if (!NAME_STOPWORDS.has(name) && !words.some(word => NAME_STOPWORDS.has(word))) names.add(name);
    }
  };
  const addChinese = fragment => {
    for (const match of String(fragment || '').matchAll(/(?<![\u4e00-\u9fff])[\u4e00-\u9fff]{2,4}(?![\u4e00-\u9fff])/g)) names.add(match[0]);
  };
  for (const match of source.matchAll(/\*\*([^*]+)\*\*/g)) {
    addLatin(match[1]);
    if (/^[\u4e00-\u9fff]{2,4}$/.test(match[1].trim())) addChinese(match[1]);
  }
  let nameColumn = -1;
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*#{2,6}\s/.test(line)) addLatin(line.replace(/^\s*#{2,6}\s+(?:[A-Z]\.|\d+\.)?\s*/, ''));
    if (/人名|转写名|对应谁|参会人/.test(line)) { addLatin(line); addChinese(line); }
    if (!/^\s*\|/.test(line)) { nameColumn = -1; continue; }
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    const headerName = cells.findIndex(cell => /^(?:owner|姓名|名字|name)$/i.test(cell));
    if (headerName >= 0) { nameColumn = headerName; continue; }
    if (nameColumn >= 0 && cells[nameColumn] && !/^[-:]+$/.test(cells[nameColumn])) {
      addLatin(cells[nameColumn]); addChinese(cells[nameColumn]);
    }
  }
  return [...names];
}
function loadSensitiveNames(options = {}) {
  const root = projectDir(options), files = [path.join(root, '.memory', 'ledger_people_org.md')];
  const latest = latestDecisionBoard(root);
  if (latest) files.push(path.join(root, 'kb_backup', latest));
  const names = new Set(options.sensitiveNames || []);
  for (const file of files) { try { for (const name of extractNames(fs.readFileSync(file, 'utf8'))) names.add(name); } catch (_) {} }
  return [...names].filter(Boolean);
}
function isSafeQuery(query, sensitiveNames = []) {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!q || (q.match(/[\u4e00-\u9fff]/g) || []).length > 12) return false;
  const lower = q.toLowerCase();
  if (FIXED_BLOCKLIST.some(term => lower.includes(term))) return false;
  return !sensitiveNames.some(name => {
    const value = String(name || '').trim();
    if (value.length < 2) return false;
    if (/[\u4e00-\u9fff]/.test(value)) return lower.includes(value.toLowerCase());
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(?:^|[^A-Za-z0-9])' + escaped + '(?:$|[^A-Za-z0-9])', 'i').test(q);
  });
}
function pickQueries(industryQueries, options = {}) {
  const input = Array.isArray(industryQueries) ? industryQueries : [], names = loadSensitiveNames(options), seen = new Set(), output = [];
  for (const value of input) {
    const query = typeof value === 'string' ? value.trim() : String((value && (value.query || value.term)) || '').trim(), key = query.toLowerCase();
    if (!seen.has(key) && isSafeQuery(query, names)) { seen.add(key); output.push(query); }
  }
  return output;
}
function auditFile(dataDir) { return path.join(dataDir, 'state', 'insight-search-log.jsonl'); }
function appendAudit(dataDir, entry) {
  const file = auditFile(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch (_) {}
  return file;
}
async function collectIndustryReferences({ insightsMeta = {}, dataDir, meetingId = '', searchImpl = web.search, now = () => new Date(), options = {} } = {}) {
  if (!dataDir) throw new TypeError('dataDir is required');
  const output = [];
  for (const query of pickQueries(insightsMeta.industryQueries, options)) {
    let results = [];
    try { results = await searchImpl(query, 5); } catch (_) {}
    results = (Array.isArray(results) ? results : []).map(row => ({
      title: String(row.title || '').slice(0, 300), url: String(row.url || ''), snippet: String(row.snippet || '').slice(0, 300),
    })).filter(row => /^https?:\/\//i.test(row.url));
    appendAudit(dataDir, { at: now().toISOString(), meetingId: String(meetingId || ''), query, urls: results.map(row => row.url) });
    output.push({ query, results });
  }
  return output;
}
module.exports = { pickQueries, isSafeQuery, loadSensitiveNames, extractNames, collectIndustryReferences, appendAudit, auditFile };
