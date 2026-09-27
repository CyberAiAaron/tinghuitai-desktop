'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const QUESTION_STATES = new Set(['open', 'partial', 'resolved', 'deferred']);

function cleanDisplayName(value) {
  const name = String(value || '').trim().slice(0, 80);
  return name || '我';
}

function loadOwnerProfile(dataDir) {
  const file = path.join(dataDir, 'owner-profile.json');
  let profile = null;
  try { profile = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  if (!profile || !/^owner-[0-9a-f-]{36}$/.test(String(profile.id || ''))) {
    profile = { id: 'owner-' + crypto.randomUUID(), displayName: cleanDisplayName(profile && profile.displayName), createdAt: Date.now() };
    const temp = file + '.tmp-' + process.pid;
    fs.writeFileSync(temp, JSON.stringify(profile, null, 2), { mode: 0o600 });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, file);
  } else {
    profile = { ...profile, displayName: cleanDisplayName(profile.displayName) };
  }
  fs.chmodSync(file, 0o600);
  return profile;
}

function clampConfidence(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

function signalAttribution(who, confidence, now = Date.now()) {
  if (who !== 'me' && who !== 'them') return null;
  return { candidate: who === 'me', source: 'split_track', confidence: clampConfidence(confidence), correctedByUser: false, updatedAt: now };
}

function manualAttribution(verdict, now = Date.now()) {
  if (!['me', 'not_me', 'unknown'].includes(verdict)) return null;
  return { candidate: verdict === 'unknown' ? null : verdict === 'me', source: 'manual', confidence: verdict === 'unknown' ? 0 : 1, correctedByUser: true, updatedAt: now };
}

function applyManualAttribution(rows, speaker, verdict, now = Date.now()) {
  const attribution = manualAttribution(verdict, now);
  if (!attribution || !speaker || !Array.isArray(rows)) return 0;
  let changed = 0;
  for (const row of rows) {
    if (String(row.speaker || row.who || '') !== String(speaker)) continue;
    row.ownerAttribution = { ...attribution };
    changed++;
  }
  return changed;
}

function looksLikeQuestion(text) {
  const value = String(text || '').trim();
  return /[?？]\s*$/.test(value) || /(?:吗|呢|怎么|如何|为什么|是否|哪(?:个|些|里)|谁|什么|多少|多久)/u.test(value) || /\b(?:when|where|who|what|why|how)\b/iu.test(value);
}

function questionId(row) {
  return 'oq-' + crypto.createHash('sha256').update(String(row.id || row.seg || '') + '\n' + String(row.text || '')).digest('hex').slice(0, 16);
}

function addOwnerQuestion(questions, row, now = Date.now()) {
  if (!Array.isArray(questions) || !row || !row.ownerAttribution || row.ownerAttribution.candidate !== true || !looksLikeQuestion(row.text)) return null;
  const ref = String(row.id || row.seg || '').trim();
  if (!ref) return null;
  const id = questionId(row);
  const existing = questions.find(q => q && q.id === id);
  if (existing) return existing;
  const question = { id, text: String(row.text || '').trim().slice(0, 1000), status: 'open', sourceRefs: [{ type: 'utterance', id: ref }], answerRefs: [], confidence: clampConfidence(row.ownerAttribution.confidence), humanEdited: row.ownerAttribution.source === 'manual', createdAt: now, updatedAt: now };
  questions.push(question);
  return question;
}

function updateOwnerQuestion(questions, patch, validUtteranceIds, now = Date.now()) {
  if (!Array.isArray(questions) || !patch || !QUESTION_STATES.has(patch.status)) return null;
  const question = questions.find(q => q && q.id === patch.id);
  if (!question) return null;
  const valid = validUtteranceIds instanceof Set ? validUtteranceIds : new Set(validUtteranceIds || []);
  const refs = Array.isArray(patch.answerRefs) ? [...new Set(patch.answerRefs.map(String).filter(id => valid.has(id)))].slice(0, 50) : question.answerRefs;
  question.status = patch.status;
  question.answerRefs = refs;
  question.humanEdited = true;
  question.updatedAt = now;
  return question;
}

module.exports = { QUESTION_STATES, loadOwnerProfile, signalAttribution, manualAttribution, applyManualAttribution, addOwnerQuestion, updateOwnerQuestion, looksLikeQuestion };
