  // ===== 会后卡片：整理好了要有个落点，不然人根本不知道它跑完了 =====
  // 触发时机：收敛完成（秒级到几分钟），不等归档那 5–30 分钟——先能用的先给。
  // 只在「有收敛结果且还没过一遍」时出现；归档失败不进这里，那是「会议档案」的事。
  // 两个出口：看纪要（主）、过一遍（次）。× 只收起卡片，不动任何数据，
  // 那一场在「历史会议」里照常能过一遍，所以发现路径没被破坏。
  const PC_MAX = 3, PC_DAYS = 7;
  let pcDismissed = [];
  try { pcDismissed = JSON.parse(localStorage.getItem('tht-pc-dismissed') || '[]'); } catch(e){}
  // 数据源是服务端，不是浏览器。收敛是服务端后台跑的，浏览器那份副本没有这个字段——
  // 2026-09-12 就是因为读了 localStorage，整理明明跑完了，卡片却一直不出现。
  let pcRows = [];
  async function pullPostCards(){
    if (!macOnline && !/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return;
    try {
      const r = await fetch(relayBase()+'/post-meeting?token='+encodeURIComponent(cfg.relayToken||''), {cache:'no-store', signal: AbortSignal.timeout(6000)});
      const j = await r.json();
      pcRows = (j.rows||[]).filter(x => !pcDismissed.includes(x.id));
    } catch(e) { pcRows = []; }
    renderPostCards();
  }
  function renderPostCards(){
    const box = $('#post-cards'); if (!box) return;
    const rows = pcRows.filter(x => !pcDismissed.includes(x.id));
    if (!rows.length) { box.hidden = true; box.innerHTML = ''; return; }
    const en = ui === 'en';
    box.hidden = false;
    box.innerHTML = rows.map(x => {
      const c = x.counts || {};
      const t = esc(x.title || (en?'Last meeting':'上一场会'));
      const n = (c.highlights||0)+(c.todos||0)+(c.factchecks||0);
      // 一个入口：进这一场。纪要是那一页的正文，确认是那一页里的动作。
      // 2026-09-12：这里原来并排放「看纪要」和「过一遍」，后者没人看得懂，前者还另弹一个窗。
      return `<div class="pc" data-pc="${esc(x.id)}">
        <div class="pc-main"><div class="pc-t">${t}</div>
        <div class="pc-s">${en?'Sorted: ':'已整理：'}${c.highlights||0}${en?' points · ':' 条结论 · '}${c.todos||0}${en?' to-dos · ':' 条待办 · '}${c.factchecks||0}${en?' views':' 条看法'}${n?(en?' · '+n+' to confirm':'　还有 '+n+' 条等你确认'):''}</div></div>
        <button type="button" class="primary" data-pc-open="${esc(x.id)}">${en?'Open':'打开这一场'}</button>
        <button type="button" class="x" data-pc-x="${esc(x.id)}" aria-label="${en?'Dismiss':'收起'}" title="${en?'Only hides this card':'只收起卡片，不影响这一场'}">×</button>
      </div>`;
    }).join('');
  }
  $('#post-cards') && $('#post-cards').addEventListener('click', e => {
    const open = e.target.dataset.pcOpen, x = e.target.dataset.pcX;
    if (x) {
      pcDismissed = [...new Set([...pcDismissed, x])].slice(-50);
      try { localStorage.setItem('tht-pc-dismissed', JSON.stringify(pcDismissed)); } catch(err){}
      renderPostCards(); return;
    }
    const id = open || (e.target.closest('.pc') && e.target.closest('.pc').dataset.pc);
    if (id) reviewSession(id);             // 整张卡都可点，回到那场会开完时的主界面
  });
  // 纪要就地看、一键复制。标清是自动整理版还是你确认过的版本。
  function showShareNote(text, confirmed){
    let d = $('#share-dlg');
    if (!d) {
      d = document.createElement('dialog'); d.id = 'share-dlg';
      d.innerHTML = '<h2 id="sn-title"></h2><p class="hint" id="sn-hint"></p><pre id="sn-body"></pre>'
        + '<div class="row"><button class="btn" id="sn-close">关闭</button><button class="btn primary" id="sn-copy">复制</button></div>';
      document.body.append(d);
      d.querySelector('#sn-close').onclick = () => d.close();
      d.querySelector('#sn-copy').onclick = async () => {
        try { await navigator.clipboard.writeText($('#sn-body').textContent); $('#sn-copy').textContent = ui==='en'?'Copied':'已复制'; }
        catch(e){ $('#sn-copy').textContent = ui==='en'?'Copy failed':'复制失败'; }
      };
    }
    $('#sn-title').textContent = ui==='en' ? 'Meeting note' : '会议纪要';
    $('#sn-hint').textContent = confirmed
      ? (ui==='en'?'You have been through this one — this is the confirmed version.':'这一场你过过一遍，这是确认过的版本。')
      : (ui==='en'?'Auto-sorted version. Going through it can change the wording, owners and dates.':'自动整理版。过一遍之后，措辞、负责人和日期可能会变。');
    $('#sn-body').textContent = text || '';
    $('#sn-copy').textContent = ui==='en'?'Copy':'复制';
    d.showModal();
  }
