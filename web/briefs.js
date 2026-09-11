/* 日报看板 —— 读 briefs.json（由 ~/.claude-maint/hub/briefs-export.py 生成）。
   默认「今日」是一条信息流：每天各份日报的要点混在一起，一眼扫完决定点哪条。
   点某条 → 进该主题，要点在上、全文折叠在下。只读，不写任何状态。 */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = { data: null, view: 'today', date: null, expanded: false };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function inline(text) {
    let s = esc(text);
    s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
    s = s.replace(/(https?:\/\/[^\s<]+)/g, (u) =>
      /"|>/.test(u) ? u : `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return s;
  }

  function md(src) {
    const lines = String(src).replace(/\r/g, '').split('\n');
    const out = [];
    let list = null, inCode = false, para = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
    const openList = (tag) => { if (list !== tag) { flushList(); out.push(`<${tag}>`); list = tag; } };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^```/.test(line)) {
        flushPara(); flushList();
        if (!inCode) { out.push('<pre><code>'); inCode = true; } else { out.push('</code></pre>'); inCode = false; }
        continue;
      }
      if (inCode) { out.push(esc(line) + '\n'); continue; }
      if (!line.trim()) { flushPara(); flushList(); continue; }

      if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
        flushPara(); flushList();
        const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const head = cells(line);
        let body = '';
        i += 2;
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          body += '<tr>' + cells(lines[i]).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>';
          i++;
        }
        i--;
        out.push(`<div class="table-wrap"><table><thead><tr>${
          head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`);
        continue;
      }
      let m;
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        flushPara(); flushList();
        out.push(`<h${Math.min(m[1].length + 1, 6)}>${inline(m[2])}</h${Math.min(m[1].length + 1, 6)}>`);
        continue;
      }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }
      if ((m = line.match(/^\s*>\s?(.*)$/))) { flushPara(); flushList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
      if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) { flushPara(); openList('ul'); out.push(`<li>${inline(m[1])}</li>`); continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); openList('ol'); out.push(`<li>${inline(m[1])}</li>`); continue; }
      para.push(line.trim());
    }
    flushPara(); flushList();
    if (inCode) out.push('</code></pre>');
    return out.join('');
  }

  const daysAgo = (d) => {
    const t = new Date(d + 'T00:00:00+08:00');
    if (isNaN(t)) return null;
    return Math.floor((new Date() - t) / 86400000);
  };
  const when = (d) => {
    const n = daysAgo(d);
    return n === null ? d : n <= 0 ? '今天' : n === 1 ? '昨天' : `${n} 天前`;
  };
  const topicOf = (key) => state.data.topics.find((t) => t.key === key);

  function renderTabs() {
    const tabs = [`<button class="tab" data-view="today" aria-pressed="${state.view === 'today'}">今日</button>`]
      .concat(state.data.topics.map((t) => {
        const n = daysAgo(t.latest);
        return `<button class="tab" data-view="${esc(t.key)}" aria-pressed="${state.view === t.key}">${
          esc(t.icon)} ${esc(t.name)}${n !== null && n >= 2 ? `<span class="stale">${n}天前</span>` : ''}</button>`;
      }));
    $('topics').innerHTML = tabs.join('');
    $('topics').querySelectorAll('.tab').forEach((b) =>
      b.addEventListener('click', () => go(b.dataset.view)));
  }

  /* 今日：所有主题最新一期的要点混排成一条流 */
  function renderToday() {
    $('dates').innerHTML = '';
    const cards = [];
    state.data.topics.forEach((t) => {
      const e = t.entries[0];
      if (!e) return;
      const hs = e.highlights && e.highlights.length ? e.highlights : [{ title: t.summary || '（这期没抽到要点）', summary: '' }];
      hs.forEach((h, idx) => cards.push(`
        <button class="feed-item" data-key="${esc(t.key)}">
          <div class="feed-src">${esc(t.icon)} ${esc(t.name)}<span class="feed-when">${esc(when(e.date))}</span></div>
          <div class="feed-title">${esc(h.title)}</div>
          ${h.summary ? `<div class="feed-sum">${esc(h.summary)}</div>` : ''}
        </button>`));
    });
    $('content').innerHTML = cards.length
      ? `<div class="feed">${cards.join('')}</div>`
      : '<div class="blank">今天还没有内容。</div>';
    $('content').querySelectorAll('.feed-item').forEach((b) =>
      b.addEventListener('click', () => go(b.dataset.key)));
    $('heading').textContent = '今日';
    $('subtitle').textContent = '每天推给你的几份，要点都在这';
    $('foot').textContent = `${state.data.topics.length} 份 · 共 ${cards.length} 条要点`;
    $('lark-link').hidden = true;
  }

  /* 单主题：要点在上，全文折叠在下 */
  function renderTopic() {
    const t = topicOf(state.view);
    if (!t) return go('today');
    const e = t.entries.find((x) => x.date === state.date) || t.entries[0];
    state.date = e.date;

    $('dates').innerHTML = t.entries.length > 1
      ? '<span class="label">往期</span>' + t.entries.map((x) =>
        `<button data-date="${esc(x.date)}" aria-pressed="${x.date === e.date}">${esc(x.date.slice(5))}</button>`).join('')
      : '';
    $('dates').querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => { state.date = b.dataset.date; state.expanded = false; renderTopic(); }));

    const hs = e.highlights || [];
    const points = hs.length
      ? `<ol class="points">${hs.map((h) => `<li><div class="p-title">${esc(h.title)}</div>${
        h.summary ? `<div class="p-sum">${esc(h.summary)}</div>` : ''}</li>`).join('')}</ol>`
      : '<div class="blank">这期没抽到要点，直接看全文。</div>';

    $('content').innerHTML =
      `<div class="eyebrow">${esc(e.date)} · ${esc(t.name)}${e.kind === 'card' ? ' · 只有推送卡片正文' : ''}</div>
       ${points}
       <button class="expand" id="toggle">${state.expanded ? '收起全文 ▴' : '展开全文 ▾'}</button>
       <div class="full" id="full" ${state.expanded ? '' : 'hidden'}>${md(e.body)}${
        e.truncated ? '<div class="truncated">这期太长，只显示了前一部分，全文看飞书。</div>' : ''}</div>`;

    $('toggle').addEventListener('click', () => {
      state.expanded = !state.expanded;
      $('full').hidden = !state.expanded;
      $('toggle').textContent = state.expanded ? '收起全文 ▴' : '展开全文 ▾';
      if (state.expanded) $('full').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    $('heading').textContent = t.name;
    $('subtitle').textContent = `${when(e.date)}这期 · ${hs.length} 条要点`;
    $('foot').textContent = `${t.name} · 共 ${t.entries.length} 期`;
    const link = $('lark-link');
    if (t.larkUrl) { link.href = t.larkUrl; link.hidden = false; } else { link.hidden = true; }
  }

  function go(view) {
    state.view = view;
    state.expanded = false;
    if (view !== 'today') {
      const t = topicOf(view);
      state.date = t && t.entries[0] ? t.entries[0].date : null;
    }
    location.hash = view;
    renderTabs();
    view === 'today' ? renderToday() : renderTopic();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  fetch('briefs.json?t=' + Date.now(), {cache:'no-store'})
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((data) => {
      state.data = data;
      if (!data.topics || !data.topics.length) {
        $('content').innerHTML = '<div class="blank">还没有日报数据。</div>';
        return;
      }
      $('updated').textContent = '更新于 ' + String(data.updated).replace('T', ' ').slice(0, 16);
      const want = location.hash.replace('#', '');
      go(want && (want === 'today' || topicOf(want)) ? want : 'today');
    })
    .catch((err) => {
      $('content').innerHTML = `<div class="blank">读不到日报数据（${esc(err.message)}）。<br>
        在 Mac 上跑一次：<code>python3 ~/.claude-maint/hub/briefs-export.py</code></div>`;
    });
})();
