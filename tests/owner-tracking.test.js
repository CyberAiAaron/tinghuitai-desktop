'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const owner = require('../app/owner-tracking');

test('owner profile has a stable random id and private file permissions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-owner-'));
  try {
    const first = owner.loadOwnerProfile(dir), second = owner.loadOwnerProfile(dir);
    assert.match(first.id, /^owner-[0-9a-f-]{36}$/); assert.equal(second.id, first.id); assert.equal(first.displayName, '我');
    assert.equal(fs.statSync(path.join(dir, 'owner-profile.json')).mode & 0o777, 0o600);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('split-track attribution records candidate, source and bounded confidence', () => {
  assert.deepEqual(owner.signalAttribution('me', 1.8, 10), { candidate: true, source: 'split_track', confidence: 1, correctedByUser: false, updatedAt: 10 });
  assert.equal(owner.signalAttribution('unknown', 0.8), null);
});

test('manual correction changes only the selected meeting speaker group', () => {
  const rows = [{ id: 'a', speaker: '1', ownerAttribution: owner.signalAttribution('me', 0.7, 1) }, { id: 'b', speaker: '2' }, { id: 'c', speaker: '1' }];
  assert.equal(owner.applyManualAttribution(rows, '1', 'not_me', 20), 2);
  assert.deepEqual(rows[0].ownerAttribution, { candidate: false, source: 'manual', confidence: 1, correctedByUser: true, updatedAt: 20 });
  assert.equal(rows[1].ownerAttribution, undefined); assert.deepEqual(rows[2].ownerAttribution, rows[0].ownerAttribution);
});

test('owner questions keep evidence refs and support four explicit states', () => {
  const questions = [], row = { id: 'u-1', text: '这个问题什么时候解决？', ownerAttribution: owner.manualAttribution('me', 30) };
  const question = owner.addOwnerQuestion(questions, row, 40);
  assert.equal(question.status, 'open'); assert.deepEqual(question.sourceRefs, [{ type: 'utterance', id: 'u-1' }]); assert.equal(question.humanEdited, true);
  for (const status of ['partial', 'resolved', 'deferred', 'open']) {
    const updated = owner.updateOwnerQuestion(questions, { id: question.id, status, answerRefs: ['u-2', 'missing'] }, new Set(['u-1', 'u-2']), 50);
    assert.equal(updated.status, status); assert.deepEqual(updated.answerRefs, ['u-2']); assert.equal(updated.humanEdited, true);
  }
  assert.equal(owner.addOwnerQuestion(questions, row, 60), question, 'same evidence is idempotent');
});

test('speaker names are session-local in every frontend naming path', () => {
  const render = fs.readFileSync(path.join(__dirname, '../web/src/11-render.js'), 'utf8'), fix = fs.readFileSync(path.join(__dirname, '../web/src/19-one-line-fix.js'), 'utf8');
  assert.doesNotMatch(render, /state\.names\s*\[/); assert.doesNotMatch(fix, /state\.names/); assert.match(render, /cur\.names/);
});

test('manual owner correction and question status controls are reachable in the built UI', () => {
  const template = fs.readFileSync(path.join(__dirname, '../web/index.template.html'), 'utf8'), render = fs.readFileSync(path.join(__dirname, '../web/src/11-render.js'), 'utf8');
  for (const id of ['spk-owner-yes', 'spk-owner-no', 'spk-owner-unknown']) assert.match(template, new RegExp(`id="${id}"`));
  assert.match(render, /data-owner-question-status/); assert.match(render, /type:'owner_question'/); assert.match(render, /sourceRefs/);
});
