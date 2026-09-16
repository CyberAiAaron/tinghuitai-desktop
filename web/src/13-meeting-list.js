  // ===== 录音管理看板：一场一卡、按周分组、按来源/状态筛、打开/删除/失败重试 =====
  const board = { source: 'all', status: 'all', trash: false, list: [], trashList: [] };
  const bdDur = sec => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec/3600); return (h?h+':':'') + String(Math.floor(sec%3600/60)).padStart(2,'0') + ':' + String(sec%60).padStart(2,'0'); };
  function bdState(s){
    if (s.recording || (!s.end && s.id === (cur&&cur.id) && running)) return { k:'rec', t: ui==='en'?'Recording':'录音中' };
    const st = (s.archive && s.archive.status) || '';
    if (st === 'error') return { k:'err', t: ui==='en'?'Failed':'整理失败' };
    if (st === 'queued' || st === 'running') {
      const began = Date.parse(s.archive.startedAt || '') || 0;
      const mins = began ? Math.max(0, Math.round((Date.now()-began)/60000)) : 0;
      const base = s.archive.phase || (ui==='en'?'Processing':'整理中');
      // 长会的「整理智能总结」阶段会跑很久。有第 N/M 段就按比例估个剩余，
      // 没有就至少告诉人这一步通常要多久，别让人干等着猜。
      let tail = mins >= 1 ? (ui==='en' ? ' · '+mins+'m' : ' · 已 '+mins+' 分钟') : '';
      const seg = /(\d+)\s*\/\s*(\d+)/.exec(base);
      if (seg && mins >= 1) {
        const done = Number(seg[1]), total = Number(seg[2]);
        if (done > 0 && total >= done) {
          const left = Math.max(1, Math.round(mins / done * (total - done)));
          tail += ui==='en' ? ' · ~'+left+'m left' : ' · 约还要 '+left+' 分钟';
        }
      } else if (/整理智能总结|Summar/i.test(base) && mins >= 2) {
        tail += ui==='en' ? ' · long meetings take 5–15m' : ' · 长会通常 5–15 分钟';
      }
      return { k:'run', t: base + tail };
    }
    if (st === 'done' || st === 'partial') return { k:'done', t: ui==='en'?'Archived':'已归档' };
    if (!s.end) return { k:'', t: ui==='en'?'Not finished':'未结束' };
    return { k:'', t: ui==='en'?'Not processed':'未整理' };
  }
  // 整理是后台跑的，不轮询的话卡片会一直停在点下去那一刻的样子。
  // 只在「确实有东西在跑」且「看板开着」时轮询，跑完自动停，不留常驻定时器。
  let archivePoll = null;
  function anyArchiving(){ return (board.list||[]).some(s => ['queued','running'].includes((s.archive&&s.archive.status)||'')); }
  function startArchivePoll(){
    if (archivePoll) return;
    archivePoll = setInterval(async () => {
      const open = $('#sh-hist') && $('#sh-hist').classList.contains('open');
      if (!open || !anyArchiving()) { clearInterval(archivePoll); archivePoll = null; return; }
      try { await refreshBoard(); } catch(e) {}
    }, 6000);
  }
  const weekStart = ms => { const d = new Date(ms); d.setHours(0,0,0,0); d.setDate(d.getDate() - ((d.getDay()+6)%7)); return d.getTime(); };
  function weekLabel(ws){
    const now = weekStart(Date.now());
    if (ws === now) return ui==='en' ? 'This week' : '本周';
    if (ws === now - 7*86400000) return ui==='en' ? 'Last week' : '上周';
    const a = new Date(ws), b = new Date(ws + 6*86400000);
    const f = d => (d.getMonth()+1) + '/' + d.getDate();
    return f(a) + '–' + f(b);
  }
  // Mac 在线时以 /meeting-list 为准，本机独有的场次补进来标「仅本机」；Mac 离线时用本机缓存，删除按钮停用。
  function boardRows(){
    const macRows = board.list || [];
    const byId = new Map(macRows.map(x => [String(x.id), { ...x, onMac: true }]));
    for (const s of state.sessions) {
      const k = String(s.id);
      if (byId.has(k)) { const m = byId.get(k); m.topicTitle = m.topicTitle || s.topicTitle || ''; continue; }
      const last = s.transcript && s.transcript.length ? (s.transcript[s.transcript.length-1].at||0) : 0;
      byId.set(k, { id: s.id, title: s.title||'', topicTitle: s.topicTitle||'', start: s.start, end: s.end || (last>1e11?last:0),
        durationSec: Math.max(0, Math.round((((s.end|| (last>1e11?last:s.start))) - s.start)/1000)),
        transcriptCount: (s.transcript||[]).length, source: 'tinghuitai', archive: {}, onMac: false });
    }
    let rows = [...byId.values()];
    if (board.source !== 'all') rows = rows.filter(r => (r.source||'tinghuitai') === board.source);
    if (board.status !== 'all') rows = rows.filter(r => bdState(r).k === board.status);
    return rows.sort((a,b) => (b.start||0) - (a.start||0));
  }
  function renderFilters(){
    const f = $('#hist-filters'); if (!f) return;
    const srcs = [['all', ui==='en'?'All sources':'全部来源'], ['tinghuitai', ui==='en'?'LiveMate':'听会台'], ['yoooclaw', 'YoooClaw']];
    const sts  = [['all', ui==='en'?'All':'全部状态'], ['run', ui==='en'?'Processing':'整理中'], ['done', ui==='en'?'Archived':'已归档'], ['err', ui==='en'?'Failed':'失败']];
    f.innerHTML = srcs.map(([k,l])=>`<button type="button" class="bd-chip${board.source===k?' on':''}" data-src="${k}">${esc(l)}</button>`).join('')
      + '<span style="width:8px"></span>'
      + sts.map(([k,l])=>`<button type="button" class="bd-chip${board.status===k?' on':''}" data-st="${k}">${esc(l)}</button>`).join('');
    f.querySelectorAll('[data-src]').forEach(b => b.onclick = () => { board.source = b.dataset.src; renderHist(); });
    f.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { board.status = b.dataset.st; renderHist(); });
  }
  function renderHist(){
    renderFilters();
    const box = $('#hist-list'); if (!box) return;
    if (board.trash) return renderTrash();
    const rows = boardRows();
    if (!rows.length) { box.innerHTML = `<div class="empty">${T('e_hist')||'这台设备上还没有场次。点右上角「从 Mac 找回」。'}</div>`; return; }
    let html = '', lastWeek = null;
    for (const s of rows) {
      const ws = weekStart(s.start||Date.now());
      if (ws !== lastWeek) { lastWeek = ws; html += `<div class="bd-week">${esc(weekLabel(ws))}</div>`; }
      const st = bdState(s);
      const head = s.topicTitle || s.title || ((ui==='en'?'Meeting ':'会议 ') + hms(s.start).slice(0,5));
      const meta = [
        new Date(s.start).toLocaleString(ui==='en'?'en-US':'zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}),
        bdDur(s.durationSec||0),
        (s.source==='yoooclaw'?'YoooClaw':(ui==='en'?'LiveMate':'听会台')),
        `<span class="bd-state ${st.k}">${esc(st.t)}</span>`,
        s.onMac ? '' : (ui==='en'?'local only':'仅本机')
      ].filter(Boolean);
      // 每场花了多少：转写按时长、模型按 token（CLI 估算会标 ≈）。你要定收费档位，就从这个数开始
      if (s.durationSec) meta.push((ui==='en'?'ASR ':'转写 ') + Math.round(s.durationSec/60) + (ui==='en'?' min':' 分钟') + (s.usage && s.usage.tokens ? ' · ' + (ui==='en'?'model ':'模型 ') + (s.usage.estimated?'≈':'') + (s.usage.tokens>=1000 ? (s.usage.tokens/1000).toFixed(1)+'k' : s.usage.tokens) + ' tokens' : ''));
      const canOpen = !!s.end;
      html += `<div class="bd-card" data-id="${esc(s.id)}"><p class="t">${esc(head)}</p><div class="m">${meta.map(x=>`<span>${x}</span>`).join('')}</div><div class="ops">`
        + (canOpen ? `<button class="btn sm" data-act="open">${ui==='en'?'Open':'打开'}</button>` : `<button class="btn sm" data-act="resume">${ui==='en'?'Resume':'继续这场'}</button>`)
        + (['err','done'].includes(st.k) ? `<button class="btn sm" data-act="retry">${st.k==='err' ? (ui==='en'?'Retry':'重试整理') : (ui==='en'?'Re-process':'重新整理')}</button>` : '')
        + (s.onMac && macOnline ? `<button class="btn sm" data-act="del">${ui==='en'?'Delete':'删除'}</button>` : '')
        + `<span class="msg" style="font-size:12px;color:var(--muted)"></span></div></div>`;
    }
    box.innerHTML = html;
    box.querySelectorAll('.bd-card').forEach(card => {
      const id = card.dataset.id, msg = card.querySelector('.msg');
      card.querySelectorAll('button[data-act]').forEach(b => b.onclick = async () => {
        const act = b.dataset.act;
        if (act === 'open') return reviewSession(id);
        if (act === 'resume') return resumeSession(id);
        if (act === 'retry') {
          b.disabled = true; msg.textContent = ui==='en'?'Requeued…':'已重新排队…';
          // 点下去就当场变成「整理中」，别等服务端那一轮回来——中间这几秒看起来像没反应
          const row = board.list.find(x => String(x.id) === String(id));
          if (row) { row.archive = Object.assign({}, row.archive, { status:'queued', phase: ui==='en'?'Queued':'排队中', startedAt: new Date().toISOString() }); renderHist(); }
          try {
            const r = await fetch(relayBase()+'/meeting-retry?token='+encodeURIComponent(cfg.relayToken||''),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id}),signal:AbortSignal.timeout(15000)});
            if(!r.ok) throw new Error((await r.text()).slice(0,120));
            await refreshBoard();
            const m2 = boardMsg(id); if (m2) m2.textContent = ui==='en'?'Queued.':'已排进整理队列。';
            startArchivePoll();
          }
          catch(e){ const m2 = boardMsg(id) || msg; if (m2) m2.textContent = (ui==='en'?'Failed: ':'没成：') + (e.message||e); b.disabled = false; }
          return;
        }
        if (act === 'del') return deleteMeeting(id);
      });
    });
  }
  // 未结束的场次：真的接着录，不要在「查看」这个动作里把它标成已结束（那样就永远续不上了）
  // 回看一场历史会议：把它原样装回三栏主界面（转写 / 要点+总结 / 待核查），而不是跳到另一张长得不一样的页面。
  // 本机存过的场次用本机那份（带分组、总结、收敛结果，最完整）；只在 Mac 上的场次从 /meeting-result 取回。
  // 回看态只看不改（沿用 viewOnly 的所有守卫）；要改、要纪要、要下载分享，走「纪要 / 下载分享」进那一场自己的页面。
  let reviewBackup = null;   // 回看前的 cur，「回到当前」时放回去
  async function reviewSession(id){
    if (running) { note(ui==='en'?'A meeting is recording — finish it before reviewing another.':'正在录音，结束后再回看别的场次。', true); return; }
    let S = state.sessions.find(s => String(s.id) === String(id));
    if (!S) {
      try {
        const r = await fetch(relayBase()+'/meeting-result?id='+encodeURIComponent(id)+'&token='+encodeURIComponent(cfg.relayToken||''), {cache:'no-store', signal: AbortSignal.timeout(15000)});
        if (!r.ok) throw new Error('HTTP '+r.status);
        const j = await r.json(); S = normalizeSession(j.session || j);
        ['highlights','todos','factchecks'].forEach(k => { (S[k]||[]).forEach((x,i) => { if (!x.at) x.at = (S.start||Date.now()) + i*1000; }); });
        (S.transcript||[]).forEach((x,i) => { if (!x.at) x.at = (S.start||Date.now()) + (x.t||i)*1000; });
      } catch(e) { note(ui==='en'?'Could not load this meeting: '+e.message:'这场读不回来：'+e.message, true); return; }
    }
    if (!(cur && cur.viewOnly && cur.reviewing)) reviewBackup = cur;   // 连续回看多场时只记最初那个
    cur = Object.assign(newSession('view','view'), S, {viewOnly:true, reviewing:true});
    resetSigs(); resetPaint(); stickBottom = false; closeSheets(); render();
    const when = cur.start ? new Date(cur.start).toLocaleString(ui==='en'?'en-US':'zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
    $('#review-title').textContent = (cur.topicTitle || cur.title || (ui==='en'?'Untitled':'未命名会议')) + (when ? ' · ' + when : '');
    $('#review-bar').hidden = false;
    try { el.hl.scrollTop = 0; el.tr.scrollTop = 0; } catch(e){}
  }
  function exitReview(){
    if (!(cur && cur.reviewing)) return;
    $('#review-bar').hidden = true;
    cur = reviewBackup || state.sessions[state.sessions.length-1] || newSession(); reviewBackup = null;
    resetSigs(); resetPaint(); stickBottom = true; render();
  }
  $('#review-exit').onclick = exitReview;
  $('#review-note').onclick = () => { if (cur && cur.reviewing) openArchivePanel(cur.id); };
  function resumeSession(id){
    const picked = state.sessions.find(s => s.id === id);
    if (!picked) { note(ui==='en'?'This one only exists on the Mac.':'这场只在 Mac 上，先「从 Mac 找回」。', true); return; }
    if (running) { note(T('histRunning')||'这场进行中，结束后再看历史。', true); return; }
    cur = picked; resetSigs(); resetPaint(); stickBottom = true; render(); closeSheets();
    const go = confirm(ui==='en' ? 'Continue recording this meeting?' : '接着录这一场吗？\n\n「确定」继续录音；「取消」只是打开它看看，不会结束这场。');
    if (!go) return;
    if (el.lang) el.lang.value = ['auto','asr','asr-sys','asr-tab','asr-room','ime','browser'].includes(picked.lang) ? picked.lang : 'auto';
    try { updateModeChip(); } catch(e){}
    startAll(picked, el.lang ? el.lang.value : 'auto');
  }
  // 提示按 id 现取节点：看板可能在 confirm 期间被 refreshBoard 重绘，闭包里的旧节点已经脱离文档
  const boardMsg = id => $('#hist-list .bd-card[data-id="' + (window.CSS && CSS.escape ? CSS.escape(String(id)) : id) + '"] .msg');
  async function deleteMeeting(id){
    if (running && cur && String(cur.id) === String(id)) { note(ui==='en'?'This one is recording — stop it first.':'这场正在录，先结束再删。', true); return; }
    const msg0 = boardMsg(id); if (msg0) msg0.textContent = '';
    const row = boardRows().find(r => String(r.id) === String(id)) || {};
    const name = row.topicTitle || row.title || id;
    if (!confirm((ui==='en'
      ? 'Delete "'+name+'" from this Mac?\n\nRecording, transcript and processed files move to a recycle area and can be restored within 30 days. Feishu documents are not touched.'
      : '把「'+name+'」从这台 Mac 删掉？\n\n录音、转写、整理结果都进回收区，30 天内可以恢复。飞书文档不动。'))) return;
    { const m = boardMsg(id); if (m) m.textContent = ui==='en'?'Deleting…':'删除中…'; }
    try {
      const r = await fetch(relayBase()+'/meeting-delete?token='+encodeURIComponent(cfg.relayToken||''),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
      const j = await r.json().catch(()=>({}));
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP '+r.status));
      state.sessions = state.sessions.filter(s => String(s.id) !== String(id));
      state.deletedIds = [...new Set([...(state.deletedIds||[]), String(id)])];
      if (cur && String(cur.id) === String(id)) { cur = null; resetSigs(); render(); }
      persist();
      await refreshBoard();
      note((ui==='en'?'Deleted. Restore it from “Recently deleted”. ':'已删除，可在「最近删除」里恢复。'));
    } catch(e){ const m = boardMsg(id); if (m) m.textContent = (ui==='en'?'Failed: ':'没删成：') + (e.message||e); else note((ui==='en'?'Delete failed: ':'没删成：') + (e.message||e), true); }
  }
  function renderTrash(){
    const box = $('#hist-list');
    const rows = board.trashList || [];
    if (!rows.length) { box.innerHTML = `<div class="empty">${ui==='en'?'Nothing in the recycle area.':'回收区是空的。'}</div>`; return; }
    box.innerHTML = rows.map(x => {
      const name = x.title || ((ui==='en'?'Meeting ':'会议 ') + new Date(x.start||x.deletedAt).toLocaleDateString('zh-CN'));
      const bad = x.state === 'partial' ? (ui==='en'?' · delete unfinished':' · 删除未完成') : '';
      return `<div class="bd-card" data-id="${esc(x.id)}"><p class="t">${esc(name)}</p><div class="m"><span>${ui==='en'?'deleted ':'删除于 '}${new Date(x.deletedAt).toLocaleString(ui==='en'?'en-US':'zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</span><span>${ui==='en'?'':'还剩 '}${x.daysLeft}${ui==='en'?' days left':' 天'}${bad}</span></div><div class="ops"><button class="btn sm" data-act="restore">${ui==='en'?'Restore':'恢复'}</button><span class="msg" style="font-size:12px;color:var(--muted)"></span></div></div>`;
    }).join('');
    box.querySelectorAll('.bd-card').forEach(card => {
      const id = card.dataset.id, msg = card.querySelector('.msg');
      card.querySelector('button[data-act="restore"]').onclick = async () => {
        msg.textContent = ui==='en'?'Restoring…':'恢复中…';
        try {
          const r = await fetch(relayBase()+'/meeting-restore?token='+encodeURIComponent(cfg.relayToken||''),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
          const j = await r.json().catch(()=>({}));
          if (!r.ok) throw new Error(j.error || ('HTTP '+r.status));
          state.deletedIds = (state.deletedIds||[]).filter(x => String(x) !== String(id));
          persist();
          try {   // 服务端文件回来了，本机这份也要补回去，否则导出/助手/编辑都用不了
            const er = await fetch(relayBase()+'/export-state?token='+encodeURIComponent(cfg.relayToken||''), {cache:'no-store', signal: AbortSignal.timeout(8000)});
            if (er.ok) { const d = await er.json(); const back = (d.sessions||[]).find(x => String(x.id) === String(id));
              if (back && !state.sessions.some(s => String(s.id) === String(id))) { state.sessions.push(normalizeSession(back)); persist(); } }
          } catch(e){}
          if (j.warnings && j.warnings.length) note((ui==='en'?'Restored with notes: ':'已恢复，但有提示：') + j.warnings.join('；'), true);
          await refreshBoard();
        } catch(e){ msg.textContent = (ui==='en'?'Failed: ':'没恢复成：') + (e.message||e); }
      };
    });
  }
  async function refreshBoard(){
    if (!cfg.relayToken && !/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) { renderHist(); return; }
    try {
      const [lr, tr] = await Promise.all([
        fetch(relayBase()+'/meeting-list?token='+encodeURIComponent(cfg.relayToken||''), {cache:'no-store', signal: AbortSignal.timeout(6000)}),
        fetch(relayBase()+'/meeting-trash?token='+encodeURIComponent(cfg.relayToken||''), {cache:'no-store', signal: AbortSignal.timeout(6000)})
      ]);
      if (lr.ok) {
        const d = await lr.json();
        board.list = d.sessions || [];
        const gone = new Set((d.deletedIds||[]).map(String));
        if (gone.size) {   // 别把正在录的这场或本地 live 清掉
          const keep = new Set([cur && String(cur.id), state.live && String(state.live.id)].filter(Boolean));
          const before = state.sessions.length;
          state.sessions = state.sessions.filter(s => !gone.has(String(s.id)) || keep.has(String(s.id)));
          if (state.sessions.length !== before) persist();
        }
        const byId = new Map(board.list.map(x => [String(x.id), x]));
        let changed = false;
        for (const s of state.sessions) { const m = byId.get(String(s.id)); if (!m) continue;
          if (m.topicTitle && m.topicTitle !== s.topicTitle) { s.topicTitle = m.topicTitle; changed = true; }
          if (Array.isArray(m.participants) && JSON.stringify(m.participants) !== JSON.stringify(s.participants||[])) { s.participants = m.participants; changed = true; } }
        if (changed) persist();
      }
      if (tr.ok) { const d = await tr.json(); board.trashList = d.items || []; }
    } catch(e){ /* Mac 离线：用本机缓存渲染 */ }
    const tb = $('#hist-trash');
    if (tb) { tb.hidden = !(board.trashList||[]).length; tb.textContent = board.trash ? (ui==='en'?'← Back':'← 返回看板') : ((ui==='en'?'Recently deleted ':'最近删除 ')+'('+(board.trashList||[]).length+')'); }
    renderHist();
  }
  function updateStatusIdle(){ if (running) return; el.status.className = 'pill' + (viewLive ? ' view' : ''); el.status.textContent = viewLive ? (T('st_view')||'同屏中') : (macOnline ? (T('st_mac')||'Mac 在线') : (T('st_idle')||'待机')); }
