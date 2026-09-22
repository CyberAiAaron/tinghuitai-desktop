'use strict';
// 尾沿节流（R9）：窗口内多次 call() 只在窗口末尾真跑一次，跑的时候拿的是那一刻的最新状态；
// 第一次 call 立刻跑。flush() 立刻把欠着的那次跑掉；stop() 把欠着的丢掉（收尾时由调用方自己强制写一次）。
// 会中每条 final 都整场重写 journal（fsync + rename），两小时的会一句几十 KB × 每秒几条，这里把它并成最多每 ms 毫秒一次。
function trailing(fn, ms) {
  let last = 0, timer = null, pending = false;
  const run = () => { if (timer) { clearTimeout(timer); timer = null; } pending = false; last = Date.now(); fn(); };
  return {
    call() {
      const wait = ms - (Date.now() - last);
      if (wait <= 0) return run();
      pending = true;
      if (!timer) { timer = setTimeout(() => { timer = null; if (pending) run(); }, wait); if (timer.unref) timer.unref(); }
    },
    flush() { if (pending) run(); },
    stop() { if (timer) clearTimeout(timer); timer = null; pending = false; },
    get pending() { return pending; },
  };
}
module.exports = { trailing };
