'use strict';
// 实现在适配层 cli-llm.js（厂商名只许出现在适配层，见 tests/llm-everywhere.test.js）
module.exports = { autopick: (...a) => require('./cli-llm').autopick(...a) };
