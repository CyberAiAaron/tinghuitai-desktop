'use strict';
// 语气词判定的唯一真源是 app/shared/filler.json：Python（meeting-pipeline.py 的 FILLER / is_filler）
// 和 Node（server.js 的 fillerASR）都从它读正则，改一处两边同时生效（审查 S8 ③）。
// 纯语气词的一行（嗯 / 啊 / 哦 / um…）不发给模型；「对 / 好 / 是 / 行」是表态，不算。归档原文不受影响。
const spec = require('./shared/filler.json');
const RE = new RegExp(spec.pattern, 'i'), STRIP = new RegExp(spec.strip, 'g');
function isFiller(text) { return typeof text === 'string' && RE.test(text.replace(STRIP, '')); }
module.exports = { isFiller, pattern: spec.pattern, strip: spec.strip };
