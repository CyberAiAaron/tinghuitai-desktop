/* 动态页 —— 读 activity.json（由 ~/.claude-maint/activity-collect.py 生成）。
   只读，不发起任何动作；每 60 秒自己刷新一次。 */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 来源用固定的颜色标记，扫一眼就知道这条是谁发起的
  const SRC = {
    '听会台': 'a', '工作台': 'b', '飞书': 'c', '信箱': 'd',
    'Codex': 'e', '定时': 'f', '系统': 'g', 'App': 'h',
  };
  const tag = (s) => `<span class="src src-${SRC[s] || 'g'}">${esc(s)}</span>`;
  const token = () => { try { return JSON.parse(localStorage.getItem('tht-settings') || '{}').relayToken || ''; } catch { return ''; } };

  function render(d) {
    $('updated').textContent = '更新于 ' + String(d.updated).replace('T', ' ').slice(0, 16);

    $('summary').innerHTML = [
      ['在跑', d.running.length, 'ok'],
      ['报错', d.failed.length, d.failed.length ? 'bad' : 'ok'],
      ['待命', d.idle_count, 'mute'],
      ['排队', (d.queues || []).reduce((n, q) => n + q.count, 0), (d.queues || []).length ? 'warn' : 'mute'],
    ].map(([k, v, cls]) => `<div class="stat stat-${cls}"><span class="stat-n">${v}</span><span class="stat-k">${k}</span></div>`).join('');

    const blocks = [];

    if (d.failed.length) {
      // 每条报错配一个「问问」：把这条的日志原文丢给页面里的 Claude，不用自己去翻
      blocks.push(`<section class="act-block"><h2>要看一眼</h2><ul class="act-list">${
        d.failed.map((r) => {
          const last = (d.recent.find((x) => x.name === r.name) || {}).text || '';
          return `<li class="bad"><span class="a-name">${esc(r.name)}</span>${tag(r.source)}
            <button class="why" data-name="${esc(r.name)}" data-log="${esc(last)}">问问为什么</button>
            <span class="a-note">上次退出码 ${esc(String(r.exit))}</span></li>`;
        }).join('')}</ul></section>`);
    }

    (d.queues || []).forEach((q) => {
      blocks.push(`<section class="act-block"><h2>${esc(q.kind)}<span class="h-n">${q.count}</span></h2>
        <ul class="act-list">${q.items.map((t) => `<li><span class="a-name">${esc(t)}</span>${tag(q.source)}</li>`).join('')}
        ${q.count > q.items.length ? `<li class="more">还有 ${q.count - q.items.length} 条</li>` : ''}</ul></section>`);
    });

    blocks.push(`<details class="act-block"><summary>运行详情</summary><section><h2>常驻进程<span class="h-n">${d.running.length}</span></h2>
      <ul class="act-list">${d.running.map((r) => `<li><span class="dot-live"></span>
        <span class="a-name">${esc(r.name)}</span>${tag(r.source)}
        <span class="a-note">pid ${esc(r.pid)}</span></li>`).join('')}</ul></section>`);

    if (d.sessions && d.sessions.length) {
      blocks.push(`<section class="act-block"><h2>Claude App 会话<span class="h-n">${d.sessions.length}</span></h2>
        <ul class="act-list">${d.sessions.map((s) => `<li>
          <span class="a-name">${esc(s.title)}</span>${tag('App')}
          <span class="a-note">${s.hours < 1 ? '刚刚' : s.hours < 24 ? Math.round(s.hours) + ' 小时前' : Math.round(s.hours / 24) + ' 天前'}</span>
        </li>`).join('')}</ul></section>`);
    }

    if (d.codex) {
      const c = d.codex;
      const pend = c.inbox_claude + c.inbox_codex;
      blocks.push(`<section class="act-block"><h2>和 Codex${pend ? `<span class="h-n">${pend} 封在途</span>` : ''}</h2>
        <ul class="act-list">
          <li><span class="a-name">待我处理的来信</span>${tag('Codex')}<span class="a-note">${c.inbox_claude} 封</span></li>
          <li><span class="a-name">等它处理的去信</span>${tag('Codex')}<span class="a-note">${c.inbox_codex} 封</span></li>
          <li><span class="a-name">累计交叉审核</span>${tag('Codex')}<span class="a-note">${c.reviews} 次</span></li>
          ${c.last_claim ? `<li><span class="a-name">最近一次认领</span><div class="a-text">${esc(c.last_claim)}</div></li>` : ''}
        </ul></section>`);
    }

    if (d.jobs && d.jobs.length) {
      const byState = { running: 0, failed: 1, idle: 2 };
      const jobs = [...d.jobs].sort((a, b) => (byState[a.state] ?? 3) - (byState[b.state] ?? 3));
      blocks.push(`<section class="act-block"><h2>全部任务<span class="h-n">${jobs.length}</span></h2>
        <ul class="act-list job-list">${jobs.map((j, i) => {
          const last = j.last || {};
          const badge = j.state === 'running' ? '<span class="dot-live"></span>'
            : j.state === 'failed' ? '<span class="dot-bad"></span>' : '<span class="dot-idle"></span>';
          return `<li class="job ${j.state}">
            <div class="job-head">
              ${badge}<span class="a-name">${esc(j.name)}</span>${tag(j.source)}
              <span class="a-note">${last.at ? esc(last.at.slice(5)) : '没有日志'}</span>
              <button class="job-log" data-i="${i}">日志</button>
              <button class="job-run" data-key="${esc(j.key)}" data-name="${esc(j.name)}">请求重跑</button>
            </div>
            <pre class="job-tail" id="tail-${i}" hidden>${esc((last.tail || ['（这个任务没有留日志）']).join('\n'))}</pre>
          </li>`;
        }).join('')}</ul></section>`);
      window.__jobs = jobs;
    }

    blocks.push('</details>');
    blocks.push(`<section class="act-block"><h2>刚发生的<span class="h-n">${d.recent.length}</span></h2>
      <ul class="act-list act-recent">${d.recent.map((r) => `<li class="${r.ok ? '' : 'bad'}">
        <span class="a-time">${esc(r.at.slice(5))}</span>
        <span class="a-name">${esc(r.name)}</span>${tag(r.source)}
        <div class="a-text">${esc(r.text)}</div></li>`).join('')}</ul></section>`);

    $('content').innerHTML = blocks.join('');
    if(!window.workspaceCapabilities?.handoff)$('content').querySelectorAll('.job-run').forEach(b=>b.hidden=true);
    // 「问问为什么」：直接把任务名和最后一条日志喂给划词助手，省掉复制粘贴
    // 展开某个任务的日志
    $('content').querySelectorAll('.job-log').forEach((b) => b.addEventListener('click', () => {
      const el = document.getElementById('tail-' + b.dataset.i);
      el.hidden = !el.hidden;
      b.textContent = el.hidden ? '日志' : '收起';
    }));

    // 重跑：走已验证的「建待办 → 认领脚本 → 执行体」链路，不新增后端接口
    $('content').querySelectorAll('.job-run').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`请求 Claude 重跑「${b.dataset.name}」？\n会建一条待办，等待认领后执行，可在待办查看结果。`)) return;
      b.disabled = true; b.textContent = '排队中…';
      try {
        const r = await fetch(`/asr-relay/hub/create${location.hostname.match(/^(127|localhost|::1)/) ? '' : '?token=' + encodeURIComponent(token())}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'tasks', owner: 'Claude',
            text: `[划词交办] 重跑定时任务「${b.dataset.name}」（任务标识: ${b.dataset.key}）。先检查任务是否适合重跑；不要中断正在进行的会议或重启常驻服务。安全执行后把结果写回此待办；失败也写明原因。\n来源：工作台 · 动态页\n原文：（无）` }),
        });
        const j = await r.json().catch(() => ({}));
        b.textContent = r.ok&&j.id ? '已排队 · 在待办查看' : '没排上'; if(r.ok&&j.id)b.dataset.taskId=j.id;else b.disabled=false;
      } catch { b.textContent = '没排上，点击重试'; b.disabled=false; }
    }));

    $('content').querySelectorAll('.why').forEach((b) => b.addEventListener('click', () => {
      window.claudeAssistantAsk && window.claudeAssistantAsk(
        `${b.dataset.name} 最后一条日志：${b.dataset.log}`,
        `${b.dataset.name} 为什么失败？要不要紧？我该做什么？`);
    }));
    $('foot').textContent = `共 ${d.total} 个任务 · 待命 ${d.idle_count}`;
  }

  function load() {
    fetch('activity.json?t=' + Date.now())
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(render)
      .catch((e) => {
        $('content').innerHTML = `<div class="blank">读不到动态数据（${esc(e.message)}）。<br>
          请稍后刷新，或在助手中询问如何恢复数据源。</div>`;
      });
  }

  window.claudeAssistantContext = () => ({ source: '工作台 · 动态', detail: 'Claude 这边的进程与最近活动' });
  $('refresh').addEventListener('click', load);
  window.addEventListener('workspace-ready',()=>document.querySelectorAll('.job-run').forEach(b=>b.hidden=!window.workspaceCapabilities?.handoff));
  load();
  setInterval(load, 60000);
})();
