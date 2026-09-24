'use strict';
// 开箱自动选模型（2026-09-25，Aaron：「一定要保证试用的是能用」）：
// 全新安装时降级链是空的——会中不出卡、会后没有想法，用户还得自己找到设置页点一下。
// 启动时如果一个模型都没配（没选命令行、没 DeepSeek Key、没 LLM_CHAIN），就按 Claude Code → Codex 的顺序
// 真跑一次 probe，第一个跑通（装了且已登录）的写进 LLM_PROVIDER。都不通就什么也不写，首页照旧提示去设置页。
// 已经配过的一律不碰（用户的选择优先）。
async function autopick({ settings, cli = require('./cli-llm'), log = () => {} }) {
  const c = settings.load();
  if (c.LLM_PROVIDER || c.DEEPSEEK_API_KEY || (Array.isArray(c.LLM_CHAIN) && c.LLM_CHAIN.length)) return { skipped: 'configured' };
  let found = {};
  try { found = cli.detect() || {}; } catch (e) { return { skipped: 'detect_failed' }; }
  for (const kind of ['claude', 'codex']) {
    if (!found[kind]) continue;
    let r = null;
    try { r = await cli.probe(kind, settings.dataDir); } catch (e) { r = { ok: false }; }
    if (r && r.ok) {
      const now = settings.load();
      if (now.LLM_PROVIDER) return { skipped: 'configured' };   // probe 期间用户自己选了
      now.LLM_PROVIDER = kind; settings.save(now); log(`开箱自动选模型：${kind}`);
      return { picked: kind };
    }
  }
  log('开箱自动选模型：本机没有已登录的 Claude Code / Codex');
  return { picked: '' };
}
module.exports = { autopick };
