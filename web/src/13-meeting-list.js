  // ===== 往期会议看板：一场一卡、按周分组、按来源/状态筛、打开/重新整理/删除 =====
  // L-11：这一块以前在三处叫三个名字（往期会议 / 录音管理 / 历史场次），统一成「往期会议」。
  const board = { source: 'all', status: 'all', showAll: false, trash: false, q: '', list: [], trashList: [] };
  const bdDur = sec => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec/3600); return (h?h+':':'') + String(Math.floor(sec%3600/60)).padStart(2,'0') + ':' + String(sec%60).padStart(2,'0'); };
  function bdState(s){
    if (s.recording || (!s.end && s.id === (cur&&cur.id) && running)) return { k:'rec', t: ui==='en'?'Recording':'录音中' };
    const st = (s.archive && s.archive.status) || '';
    const why = String((s.archive && s.archive.error) || s.summaryNote || '').replace(/\s+/g,' ').slice(0, 40);
    if (st === 'error') return { k:'err', t: (ui==='en'?'Failed':'整理失败') + (why ? ' · ' + why : '') };
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
    // P-03：归档做完但总结没出来的，以前也显示「已归档」，出了问题看不见。几句话的短录音不算失败。
    if ((st === 'done' || st === 'partial') && s.summaryStatus === 'failed') {
      if ((s.transcriptCount || 0) < 8) return { k:'done', t: ui==='en'?'Archived · too short to summarize':'已归档 · 太短没出总结' };
      const note = s.summaryNote && s.summaryNote !== '已归档，但总结没出来' ? ' · ' + String(s.summaryNote).slice(0, 40) : '';
      return { k:'err', t: (ui==='en'?'No summary':'总结没出来') + note };
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
    // L-07：70 条里 47 条是压测场和没录到内容的空会，真会议被淹掉。默认只显示真会议，
    // 「显示全部」把它们调回来。服务端已经算好 kind，本机独有的场次（onMac=false）按老规矩一律显示。
    if (!board.showAll) rows = rows.filter(r => !r.kind || r.kind === 'real');
    // U-04：搜会议名和日期。一场会你记得住的通常只有这两样，所以不去搜转写全文（那要另开接口）。
    const q = (board.q||'').trim().toLowerCase();
    if (q) rows = rows.filter(r => {
      const when = new Date(r.start||0);
      // 卡片上显示的那串日期也要能搜到：他照着屏幕敲「09/17」，不该搜不出来
      const shown = when.toLocaleString(ui==='en'?'en-US':'zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
      // 没名字的会卡片上写的是「会议 17:58」，搜「会议」也该搜得到——按卡片上看得见的那行算
      const head = r.topicTitle || r.title || ((ui==='en'?'Meeting ':'会议 ') + hms(r.start).slice(0,5));
      const hay = [head, r.topicTitle, r.title, shown, when.toLocaleString('zh-CN'), when.toLocaleString('en-US'),
                   when.toISOString().slice(0,10)].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
    if (board.source !== 'all') rows = rows.filter(r => (r.source||'tinghuitai') === board.source);
    if (board.status !== 'all') rows = rows.filter(r => bdState(r).k === board.status);
    return rows.sort((a,b) => (b.start||0) - (a.start||0));
  }
  function renderFilters(){
    const f = $('#hist-filters'); if (!f) return;
    // YoooClaw 是另一个录音来源（硬件/另一个 App），不是另一个 AI 助手——加个 title 说清楚
    const srcs = [['all', ui==='en'?'All sources':'全部来源'], ['tinghuitai', ui==='en'?'LiveMate':'听会台'], ['yoooclaw', 'YoooClaw']];
    const SRC_TIP = {yoooclaw: ui==='en'?'Recordings that came from the YoooClaw device':'从 YoooClaw 那边传过来的录音', tinghuitai: ui==='en'?'Recorded by Meeting LiveMate itself':'听会台自己录的'};
    const sts  = [['all', ui==='en'?'All':'全部状态'], ['run', ui==='en'?'Processing':'整理中'], ['done', ui==='en'?'Archived':'已归档'], ['err', ui==='en'?'Failed':'失败']];
    f.innerHTML = srcs.map(([k,l])=>`<button type="button" class="bd-chip${board.source===k?' on':''}" data-src="${k}"${SRC_TIP[k]?` title="${esc(SRC_TIP[k])}"`:''}>${esc(l)}</button>`).join('')
      + '<span style="width:8px"></span>'
      + sts.map(([k,l])=>`<button type="button" class="bd-chip${board.status===k?' on':''}" data-st="${k}">${esc(l)}</button>`).join('');
    const hidden = (board.list||[]).filter(r => r.kind && r.kind !== 'real').length;
    if (hidden) f.insertAdjacentHTML('beforeend', '<span style="width:8px"></span>'
      // 开着的时候按钮要显示「怎么退回去」，不然点完了文案没变，像是没生效
      + `<button type="button" class="bd-chip${board.showAll?' on':''}" data-all="1">${esc(board.showAll
          ? (ui==='en'?'Only real meetings':'只看真会议')
          : (ui==='en'?('Show all (+'+hidden+' test/empty)'):('显示全部（另有 '+hidden+' 条测试场和空会）')))}</button>`);
    f.querySelectorAll('[data-all]').forEach(b => b.onclick = () => { board.showAll = !board.showAll; renderHist(); });
    f.querySelectorAll('[data-src]').forEach(b => b.onclick = () => { board.source = b.dataset.src; renderHist(); });
    f.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { board.status = b.dataset.st; renderHist(); });
  }
  function renderHist(){
    renderFilters();
    const qi = $('#hist-q');
    if (qi) { if (qi.value !== board.q) qi.value = board.q;
      qi.oninput = () => { board.q = qi.value; renderHist(); qi.focus(); };
      qi.placeholder = ui==='en' ? 'Search by name or date' : '搜会议名、日期'; }
    const box = $('#hist-list'); if (!box) return;
    if (board.trash) return renderTrash();
    const rows = boardRows();
    if (!rows.length) { box.innerHTML = `<div class="empty">${board.q
      ? esc(ui==='en' ? ('No meeting matches “'+board.q+'”.') : ('没有匹配「'+board.q+'」的会议。'))
      : (T('e_hist')||'这台设备上还没有场次。点右上角「从 Mac 找回」。')}</div>`; return; }
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
        // U-04：删除以前和「打开」「重新整理」一样显眼，误点代价却完全不同——收进「⋯」里
        + (s.onMac && macOnline ? `<details class="bd-more"><summary aria-label="${ui==='en'?'More':'更多'}">⋯</summary><div class="menu"><button class="btn sm danger" data-act="del">${ui==='en'?'Delete':'删除'}</button></div></details>` : '')
        + `<span class="msg" style="font-size:12px;color:var(--muted)"></span></div></div>`;
    }
    box.innerHTML = html;
    box.querySelectorAll('.bd-card').forEach(card => {
      const id = card.dataset.id, msg = card.querySelector('.msg');
      card.querySelectorAll('button[data-act]').forEach(b => b.onclick = async () => {
        const act = b.dataset.act;
        if (act === 'open') return openArchivePanel(id);   // 09-22 Aaron 定：历史列表直达回看页，不再先装回三栏主界面
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
  // 回看一场历史会议：直达它自己的回看页 openArchivePanel(id)（09-22 Aaron 定）；「装回三栏主界面」那条路已删。
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
            const er = await fetch(relayBase()+'/export-state?ids='+encodeURIComponent(id)+'&token='+encodeURIComponent(cfg.relayToken||''), {cache:'no-store', signal: AbortSignal.timeout(8000)});
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
