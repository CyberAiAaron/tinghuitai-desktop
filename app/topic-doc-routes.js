'use strict';

function fail(message) {
  const error = Error(message);
  error.code = 500;
  return error;
}

function reply(res, code, body) {
  return res.status(code).json(body);
}

function mount(router, service) {
  if (!router || typeof router.get !== 'function' || typeof router.post !== 'function') throw fail('路由容器不支持 get/post');
  if (!service || typeof service.computeDiff !== 'function' || typeof service.read !== 'function' || typeof service.apply !== 'function') throw fail('主题文档服务不完整');
  router.post('/asr-relay/topic-diff/compute', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const diff = await service.computeDiff(body.enhanced, body.docMarkdown || '');
      return reply(res, 200, { ok: true, matched: !!diff, diff });
    } catch (error) { return reply(res, Number(error.code) || 500, { ok: false, error: error.message }); }
  });
  router.get('/asr-relay/topic-diff', async (req, res) => {
    try { return reply(res, 200, { ok: true, diff: service.read(req.query && req.query.id) }); }
    catch (error) { return reply(res, Number(error.code) || 500, { ok: false, error: error.message }); }
  });
  router.post('/asr-relay/topic-diff/apply', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (body.confirmed !== true) {
        const error = Error('请在界面点接受后再写入');
        error.code = 400;
        throw error;
      }
      return reply(res, 200, await service.apply(body.id, body.ids, body));
    } catch (error) { return reply(res, Number(error.code) || 500, { ok: false, error: error.message }); }
  });
  return router;
}

function create(service) { return { mount: router => mount(router, service) }; }

module.exports = { create, mount };
