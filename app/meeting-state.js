'use strict';
// 一场会的状态，由服务端说了算。
// 2026-09-12 之前是前端 bdState() 自己从零散字段推，推错过好几次（点完不刷新、
// 归档失败和可用产物混在一个计数里）。现在契约下沉到这里，前端只负责显示。
//
// 核心：一场会有五个产物，各自独立。总体状态只是「最有用的那一层」的概括。

const PRODUCT_STATES = ['not_started', 'pending', 'ok', 'retryable', 'unavailable'];

// 每个产物看什么
function productsOf(sess, job, memCount) {
  const tr = (sess.transcript || []).filter(r => r && String(r.text || '').trim());
  const hasTranscript = tr.length > 0;
  const jobStatus = (job && job.status) || '';

  const transcript = hasTranscript ? 'ok' : (sess.end ? 'unavailable' : 'not_started');

  // 纪要 = 收敛结果。没有收敛但条目本来就少，也算可用（不需要收敛）
  const items = (sess.highlights || []).length + (sess.todos || []).length + (sess.factchecks || []).length;
  let note = 'not_started';
  if (sess.condensed) note = 'ok';
  else if (!hasTranscript) note = 'unavailable';
  else if (items && items < 20) note = 'ok';            // 小会不收敛，原始条目就是纪要
  else if (sess.end) note = 'retryable';                 // 该有而没有 → 可重试
  const noteConfirmed = !!(sess.review && (sess.review.decisions || []).length);

  let archive = 'not_started';
  if (jobStatus === 'done' || jobStatus === 'partial') archive = 'ok';
  else if (jobStatus === 'running' || jobStatus === 'queued') archive = 'pending';
  else if (jobStatus === 'error') archive = 'retryable';
  else if (jobStatus === 'empty') archive = 'unavailable';
  else if (sess.end && hasTranscript) archive = 'not_started';

  const memory = noteConfirmed ? (memCount > 0 ? 'ok' : 'retryable') : 'not_started';

  const audio = sess.audioSaveError ? 'retryable' : (sess.audioPath ? 'ok' : 'not_started');

  return {
    transcript: { state: transcript, count: tr.length },
    note: { state: note, confirmed: noteConfirmed,
            counts: sess.condensed ? {
              highlights: (sess.condensed.highlights || []).length,
              todos: (sess.condensed.todos || []).length,
              factchecks: (sess.condensed.factchecks || []).length,
            } : { highlights: (sess.highlights || []).length, todos: (sess.todos || []).length, factchecks: (sess.factchecks || []).length },
            rawCount: items },
    archive: { state: archive, phase: (job && job.phase) || '', startedAt: (job && job.created) || '',
               error: String((job && job.error) || '').slice(0, 200), url: (job && job.url) || '' },
    memory: { state: memory, count: memCount || 0 },
    audio: { state: audio, error: sess.audioSaveError || '' },
  };
}

// 总体状态：按优先级从上往下，命中即止。规则写死在这里，前端不再自己判断。
function overallOf(products, recording) {
  if (recording) return 'recording';
  if (products.transcript.state === 'unavailable') return 'empty';
  if (products.note.state === 'ok') return products.note.confirmed ? 'confirmed' : 'ready';
  if (products.note.state === 'pending' || products.archive.state === 'pending') return 'processing';
  if (products.note.state === 'retryable') return 'note_failed';
  return 'unprocessed';
}

const LABEL = {
  zh: { recording:'正在听', empty:'这场没有录到内容', ready:'可用', confirmed:'已确认',
        processing:'整理中', note_failed:'纪要没生成，逐字稿可看', unprocessed:'未整理' },
  en: { recording:'Listening', empty:'Nothing was captured', ready:'Ready', confirmed:'Confirmed',
        processing:'Processing', note_failed:'Note failed — transcript is there', unprocessed:'Not processed' },
};

function describe(sess, job, memCount, recording, lang) {
  const products = productsOf(sess, job, memCount);
  const overall = overallOf(products, !!recording);
  return { state: overall, label: (LABEL[lang === 'en' ? 'en' : 'zh'])[overall] || overall, products, updatedAt: new Date().toISOString() };
}

module.exports = { describe, productsOf, overallOf, PRODUCT_STATES, LABEL };
