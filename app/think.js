'use strict';
// THINK.md：会中会后每一次模型调用之前，先把这份「怎么想」拼在 system 最前面（Aaron 2026-09-24 原话：
// 「just like CLAUDE.md in Claude Code: a short markdown about Chansey and about thinking,
//   and whenever words come, it should go through this markdown」）。
//
// 优先级：<THT_DATA_DIR>/THINK.md（Aaron 自己改的那份）> app/THINK.md（随版本走的默认）。
// 按 mtime 缓存：他在会中途改一句，下一次调用就生效，不用重启。
// 拼接由 prefix() 负责，并且只拼一次——Python 那条路（meeting-pipeline.py）也会拼，
// 到了 app/llm.js 的 ask() 再拼一次就会翻倍，所以这里先看 system 里有没有它。
const fs = require('fs'), path = require('path');

const APP_FILE = path.join(__dirname, 'THINK.md');
const SEP = '\n\n---\n\n';
let cache = { file: '', mtime: -1, text: '' };

function file(dataDir) {
  const d = String(dataDir || '').trim();
  if (d) { const f = path.join(d, 'THINK.md'); try { if (fs.statSync(f).isFile()) return f; } catch (e) {} }
  return APP_FILE;
}

// 返回 THINK.md 正文；两份都读不到时返回空串（调用方照常发，不因为少了这份就整条链失败）
function load(dataDir) {
  const f = file(dataDir);
  let mtime = -1;
  try { mtime = fs.statSync(f).mtimeMs; } catch (e) { return ''; }
  if (cache.file === f && cache.mtime === mtime) return cache.text;
  let text = '';
  try { text = String(fs.readFileSync(f, 'utf8')).trim(); } catch (e) { return ''; }
  cache = { file: f, mtime, text };
  return text;
}

// system 前置。已经带过就原样返回（幂等）。
function prefix(system, dataDir) {
  const think = load(dataDir);
  const s = String(system == null ? '' : system);
  if (!think || s.includes(think)) return s;
  return think + (s ? SEP + s : '');
}

function reset() { cache = { file: '', mtime: -1, text: '' }; }

module.exports = { load, prefix, file, reset, APP_FILE, SEP };
