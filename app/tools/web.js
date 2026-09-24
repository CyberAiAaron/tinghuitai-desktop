'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const TIMEOUT_MS = 10_000;

function settingsFile(env = process.env) {
  const dataDir = env.THT_DATA_DIR || path.join(os.homedir(), 'Library/Application Support/Tinghuitai');
  return path.join(dataDir, 'settings.json');
}
function braveKey(env = process.env) {
  try {
    const value = JSON.parse(fs.readFileSync(settingsFile(env), 'utf8')).BRAVE_API_KEY;
    return typeof value === 'string' ? value.trim() : '';
  } catch (_) { return ''; }
}
function clean(value, max = 500) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function decodeHtml(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function resultUrl(raw) {
  const decoded = decodeHtml(raw);
  try {
    const url = new URL(decoded, 'https://duckduckgo.com');
    return url.searchParams.get('uddg') || url.href;
  } catch (_) { return decoded; }
}
function parseDuckDuckGo(html, n) {
  const blocks = String(html || '').split(/class=["'][^"']*result(?:\s|__body)/i).slice(1), rows = [];
  for (const block of blocks) {
    const link = block.match(/class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const snippet = block.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);
    const url = resultUrl(link[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    rows.push({ title: clean(decodeHtml(link[2]), 300), url, snippet: clean(decodeHtml(snippet && snippet[1]), 500) });
    if (rows.length >= n) break;
  }
  return rows;
}
async function search(query, n = 5, options = {}) {
  const q = String(query || '').trim(), limit = Math.max(1, Math.min(10, Number(n) || 5));
  if (!q) return [];
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return [];
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), options.timeoutMs || TIMEOUT_MS);
  try {
    const key = options.braveApiKey === undefined ? braveKey(options.env) : String(options.braveApiKey || '');
    if (key) {
      const url = 'https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(q) + '&count=' + limit;
      const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json', 'X-Subscription-Token': key } });
      if (!response.ok) return [];
      const json = await response.json();
      return ((json.web && json.web.results) || []).slice(0, limit).map(row => ({
        title: clean(row.title, 300), url: String(row.url || ''), snippet: clean(row.description, 500),
      })).filter(row => /^https?:\/\//i.test(row.url));
    }
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
    const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 Tinghuitai/1.0' } });
    if (!response.ok) return [];
    return parseDuckDuckGo(await response.text(), limit);
  } catch (_) { return []; } finally { clearTimeout(timer); }
}
module.exports = { search };
