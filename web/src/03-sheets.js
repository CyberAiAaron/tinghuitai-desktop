  // ===== 抽屉 =====
  const scrim = $('#scrim');
  function openSheet(id){ closeSheets(); $(id).classList.add('open'); scrim.hidden = false; }
  // 同一个按钮按第二次就关掉（Apple HIG：取消 = 撤回，一个动作一个入口）
  function toggleSheet(id, before){ const el = $(id); if (el && el.classList.contains('open')) { closeSheets(); return false; } if (before) before(); openSheet(id); return true; }
  function toggleDialog(id, before){ const d = $(id); if (d && d.open) { d.close(); return false; } if (before) before(); return true; }
  function closeSheets(){ document.querySelectorAll('.sheet').forEach(s=>s.classList.remove('open')); scrim.hidden = true; }
  scrim.onclick = closeSheets;
  // 抽屉（.sheet）不是 <dialog>，拿不到浏览器自带的 Esc。不补这一下，
  // 「所有弹窗关闭方式统一」就只统一了一半：会议列表和开会方式按 Esc 没反应。
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;          // 弹窗自己会处理
    if (!document.querySelector('.sheet.open')) return;
    e.preventDefault(); closeSheets();
  });
  document.querySelectorAll('.sheet [data-close]').forEach(b => b.onclick = closeSheets);
  $('#b-sum').onclick = () => toggleSheet('#sh-sum');
  $('#b-hist').onclick = () => { if (!toggleSheet('#sh-hist', () => { board.trash = false; renderHist(); })) return; refreshBoard().then(()=>{ if (anyArchiving()) startArchivePoll(); }).catch(()=>{}); };
  $('#hist-trash').onclick = () => { board.trash = !board.trash; const tb = $('#hist-trash'); tb.textContent = board.trash ? (ui==='en'?'← Back':'← 返回看板') : ((ui==='en'?'Recently deleted ':'最近删除 ')+'('+(board.trashList||[]).length+')'); renderHist(); };
  const MODE_OPTS_ZH = [
    ['asr','线下会','使用手机或电脑收录现场声音。'],
    ['asr-tab','线上会（我一个人）','只收会议窗口的声音和你自己说话。麦克风开降噪，旁边同事的闲聊不会被记进去。开始时选会议窗口并勾选共享音频。'],
    ['asr-room','线上 + 线下（会议室）','会议窗口的声音，加上整个房间的讨论。关掉降噪，屋里谁说话都收；会议软件里闭麦不影响。开始时选会议窗口并勾选共享音频。'],
    ['asr-sys','线上会 · 用虚拟声卡收音','装过 BlackHole / Loopback 这类虚拟声卡、不想每次去选标签页的人用这个。效果和上面的线上会一样。'],
    ['ime','备用 · Mac 自带听写','火山连不上时临时用，只认你对着麦克风说的话。'],
    ['browser','备用 · 浏览器识别','火山连不上时临时用，准确率看浏览器，一般比火山差不少。'],
  ];
  const MODE_OPTS_EN = [
    ['asr','In person','Capture the room with your phone or computer.'],
    ['asr-tab','Online (just me)','Captures the meeting audio and your own voice, with noise suppression so nearby chatter is not recorded.'],
    ['asr-room','Online + room','Meeting audio plus everyone in the room. Noise suppression off. Muting yourself in the meeting app does not affect it.'],
    ['asr-sys','Online · via virtual audio device','For people who set up BlackHole / Loopback and do not want to pick a tab each time. Same result as Online above.'],
    ['ime','Backup · macOS dictation','Temporary fallback when the transcription service is unreachable.'],
    ['browser','Backup · browser recognition','Temporary fallback; accuracy depends on the browser and is usually worse.'],
  ];
  const MODE_OPTS_GET = () => (ui === 'en' ? MODE_OPTS_EN : MODE_OPTS_ZH);
  function renderModeList(){
    // 录音中以实际在跑的那个为准：会中换过之后，高亮要跟着走
    const cur0 = (running && startedMode) ? startedMode : ((el.lang && el.lang.value) || 'auto');
    const rows=MODE_OPTS_GET().map(([v,t,d])=>`<button type="button" class="mode-opt" data-v="${v}" aria-selected="${v===cur0}">${t}<small>${d}</small></button>`);
    const liveHint = (running && ['asr-tab','asr-room'].includes(startedMode))
      ? `<p class="hint" style="margin:0 0 10px">${ui==='en'?'Recording — you can switch between the two online options right now; the meeting keeps running.':'录音中——上面两个线上选项可以现在就换，这一场不会断。'}</p>` : '';
    $('#mode-list').innerHTML=liveHint+rows.slice(0,3).join('')+`<details style="margin-top:16px"><summary>${ui==='en'?'Fallbacks and advanced':'收音方式不行时的备用 / 进阶'}</summary>${rows.slice(3).join('')}</details>`;
    $('#mode-list').querySelectorAll('button').forEach(b => b.onclick = async () => {
      const v = b.dataset.v;
      if (running) {
        // 线上会和「线上+线下」之间可以会中直接换：只换麦克风那一路，不打断这一场。
        // 其余方式改的是整条采音链路，还是得结束后再换。
        if (['asr-tab','asr-room'].includes(v) && ['asr-tab','asr-room'].includes(startedMode)) {
          closeSheets();
          const ok = await switchRoomMode(v === 'asr-room');
          if (ok && el.lang) el.lang.value = v;
          try { updateModeChip(); renderModeList(); } catch(e){}
          return;
        }
        note(T('modeLocked')||'这场进行中，开会方式结束后再换。', true); setTimeout(()=>note(''),3000); return;
      }
      if (el.lang) el.lang.value = v;
      updateModeChip(); renderModeList(); closeSheets();
    });
  }
  // 工作台原来是普通链接，点一下会把当前页面整个换掉——开会中点一下录音就没了。
  // 工作台是另一个去处（总待办池、知识条目），不是一个设置项——放在导航行里。
  // 2026-09-12 我一度把它藏进设置，等于弄丢了一个入口。
  const openWorkHub = e => { if (e) e.preventDefault(); window.open('work.html','tinghuitai-workhub','popup,width=1200,height=900'); };
  $('#work-link').onclick = openWorkHub;
  $('#b-work-top') && ($('#b-work-top').onclick = openWorkHub);
  $('#b-memory').onclick = () => { const d=$('#memory-dialog'); const f=d.querySelector('iframe'); if(!f.src)f.src='memory.html'; d.showModal(); };
  $('#mode-chip').onclick = () => { toggleSheet('#sh-mode', renderModeList); };
  $('#hist-pull').onclick = async () => {
    const m = $('#hist-msg'); if (m) m.textContent = T('pull_wait')||'从 Mac 找回中……';
    try {
      const r = await fetch(relayBase()+'/export-state?token='+encodeURIComponent(cfg.relayToken||''), {cache:'no-store'});
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const have = new Set(state.sessions.map(x=>x.id));
      let n = 0;
      (d.sessions||[]).forEach(x => { if (x && x.id && !have.has(x.id)) { state.sessions.push(normalizeSession(x)); n++; } });
      if (n) persist();
      await refreshBoard();
      const m2 = $('#hist-msg'); if (m2) m2.textContent = n ? ((T('pull_ok')||'找回 ') + n + (T('pull_ok2')||' 场。')) : (T('pull_none')||'Mac 上没有这台设备缺的场次。');
    } catch(e){ const m2 = $('#hist-msg'); if (m2) m2.textContent = (T('pull_fail')||'找不回：') + (e.message||e) + (T('pull_fail2')||'（Mac 在线吗？）'); }
  };
