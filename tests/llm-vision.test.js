'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const llm = require('../app/llm');

test('OpenAI compatible provider gets explicit multimodal content only when vision is enabled', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-llm-vision-'));
  const image = path.join(dataDir, 'photo.png'); fs.writeFileSync(image, Buffer.from([1, 2, 3]));
  let request;
  const fetchImpl = async (_url, options) => { request = JSON.parse(options.body); return { status: 200, json: async () => ({ model: 'vision-model', choices: [{ message: { content: '{"ok":true}' } }] }) }; };
  const env = { LLM_CHAIN: [{ type: 'openai', name: 'Vision API', baseUrl: 'https://example.test/v1', key: 'x', vision: true, models: { post: 'vision-model' } }] };
  const result = await llm.ask(env, { dataDir, user: 'inspect', images: [{ path: image, mime: 'image/png' }], fetchImpl });
  assert.equal(result.text, '{"ok":true}'); assert.equal(result.provider, 'Vision API');
  assert.equal(request.messages[1].content[0].type, 'text'); assert.match(request.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
});

test('image request skips providers without declared vision capability', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-llm-no-vision-'));
  const image = path.join(dataDir, 'photo.jpg'); fs.writeFileSync(image, Buffer.from([1]));
  const env = { LLM_CHAIN: [{ type: 'openai', name: 'Text API', baseUrl: 'https://example.test/v1', key: 'x', models: { post: 'text-model' } }] };
  const result = await llm.ask(env, { dataDir, user: 'inspect', images: [{ path: image, mime: 'image/jpeg' }], fetchImpl: async () => { throw new Error('must not call'); } });
  assert.equal(result.text, null); assert.equal(result.errorCode, 'vision_unsupported');
  assert.deepEqual(result.attempts, [{ provider: 'Text API', errorCode: 'vision_unsupported' }]);
});
