  // ===== 控制 =====
  el.tongue.onchange = () => {
    try { localStorage.setItem('tht-tongue', el.tongue.value); } catch(e){}
    const label = el.tongue.selectedOptions[0].text;
    if (!running) { note('语言：' + label); setTimeout(()=>note(''), 2000); return; }
    if (asrMode) { asrReopen(); note('语言切到「'+label+'」，同一场继续。'); }
    else if (!imeMode) { try { rec && rec.stop(); } catch(e){} rec = makeRec(); if (rec) { try { rec.start(); } catch(e){} } note('语言切到「'+label+'」。'); }
    else note(T('imeLang')||'输入法听写的语言在输入法里切。', true);
    setTimeout(()=>note(''), 3000);
  };
  el.lang.onchange = () => { updateModeChip(); if (running) { note('这场进行中，识别方式结束后再换；语言可以随时切。', true); el.lang.value = (cur && cur.lang) || 'auto'; updateModeChip(); } };
  el.start.onclick = async () => {
    if(!await checkMac()){note(ui==='en'?'Recording service unavailable. Reopen the installed app.':'录音服务未连接，请重新打开听会台；无需重复填写模型 Key。',true);return;}
    await loadServerSettings();
    if (!window.THT_BOOT) await refreshBoot();   // 远端窗口：boot 只能靠带口令的 /setup 拿，点开始前再确认一次（09-22）
    // 一把钥匙都没配的人，点开始时直接按本机转写起：不用注册、不用填任何东西。
    // 这一步也会顺带拉起系统的语音识别授权弹窗。这台机器用不了本机转写才去设置页。
    if (!boot.asrConfigured) {
      if (!boot.macAsrAvailable) {
        note(ui==='en'?'This Mac cannot transcribe on-device. Connect a transcription service first.':'这台机器用不了本机转写，先接一个转写服务。', true);
        openSettings('asr'); return;
      }
      el.start.disabled = true;
      try {
        const r = await fetch('/setup', {method:'POST', headers:{'content-type':'application/json','x-tht-token':cfg.relayToken||''}, body: JSON.stringify({ASR_PROVIDER:'mac'})});
        if (!r.ok) throw new Error(String(r.status));
        boot.asrConfigured = true; boot.asrProvider = 'mac'; updateReadyBar();
        note(ui==='en'?'Using on-device transcription. Approve the system prompt if it appears.':'这场用本机转写。系统弹出语音识别授权时点允许。');
        setTimeout(()=>note(''), 6000);
      } catch(e) {
        note(ui==='en'?'Could not switch to on-device transcription; open settings.':'切本机转写没成功，去设置页看看。', true);
        openSettings('asr'); el.start.disabled = false; return;
      }
      el.start.disabled = false;
    }
    const manual = el.lang && el.lang.value && el.lang.value !== 'auto';
    if (manual || !macOnline) { startAll(null); return; }
    $('#k-msg').textContent = ''; renderKindList(); openSheet('#sh-kind');
  };
  function renderKindList(){
    const box = $('#kind-list'); if (!box) return;
    box.innerHTML = MODE_OPTS_GET().slice(0,3)
      .map(([v,t,d]) => `<button type="button" class="mode-opt" data-v="${v}">${t}<small>${d}</small></button>`).join('');
    box.querySelectorAll('button').forEach(b => b.onclick = () => { closeSheets(); startAll(null, b.dataset.v); });
    box.addEventListener('contextmenu', e => { e.preventDefault(); selfTest(); });
  }
  $('#k-test').onclick = () => selfTest();
  async function startAll(resume, force){
    const mode = force && force!=='auto' ? force : resolveMode();
    imeMode = mode === 'ime'; asrMode = mode.startsWith('asr');
    // 本机口令由服务端随页面注入（THT_BOOT），点开始时直接拿，不要求用户先「保存设置」一次。
    // 以前要求 cfg.relayToken 非空，而它只有保存设置才写入、保存时又是从 THT_BOOT 抄的；
    // THT_BOOT 拿不到（页面被判成非本机）时保存也补不上，就成了「开始→弹设置→保存→再弹」的死循环。
    if (asrMode && !cfg.relayToken) {
      const t = window.THT_BOOT && window.THT_BOOT.relayToken;
      if (t) { cfg.relayToken = t; try { localStorage.setItem('tht-settings', JSON.stringify(cfg)); } catch(e){} }
      else {
        // bootstrap.js 被拒时页面拿不到任何信息；再问一次 /setup，它的 403 正文里写着是哪条没过
        let why = '';
        try { const r = await fetch('/setup', {cache:'no-store'}); if (!r.ok) { const j = await r.json().catch(()=>({})); if (j && j.error) why = '（' + String(j.error).replace(/^设置只能在本机打开：?/, '') + '）'; } } catch(e){}
        note((ui==='en'
          ? 'This window did not get the local token, so recording cannot start. Use the window that 启动.command opens (http://127.0.0.1:' + location.port + '/) and turn off any browser proxy.'
          : '这个窗口没拿到本机口令，开不了录音。请用「启动.command」打开的那个窗口（http://127.0.0.1:' + location.port + '/），并关掉浏览器代理再试。') + why, true);
        return;
      }
    }
    // Model credentials live on the server, not in cfg.key.
    if (!imeMode && !asrMode) { rec = makeRec(); if (!rec) return; }
    if (viewWs) { try { viewWs.close(); } catch(e){} viewWs = null; }
    if (resume) { cur = resume; cur.end = null;cur.fixes=parseFixes(briefFix); } else { cur = newSession(asrMode?'mac':(imeMode?'ime':'browser'), mode); state.sessions.push(cur); }
    startedMode = mode;
    state.live = cur.id; lastAnalyzedLen = cur.transcript.map(x=>x.text).join('\n').length; interim = ''; lastFinal = ''; stickBottom = true;
    if (imeMode) { const ta=$('#ime'); ta.hidden=false; ta.value=''; imeUsed=0; imeLastLen=0; imeLastChange=Date.now(); setTimeout(()=>ta.focus(),50); note('输入法听写：点文本框 → 输入法的麦克风 → 说。'); el.src.textContent = T('src_ime')||'输入法听写'; }
    else if (asrMode) { asrStart().catch(e => {stopAll(false);note('录音启动失败：'+(e.message||e)+'。请检查麦克风权限后重新开始。',true);}); }
    else { try { rec.start(); el.src.textContent = T('src_browser')||'浏览器识别'; } catch(e) { note('无法启动识别：' + e.message, true); return; } }
    running = true; updateModeChip(); el.start.hidden = true; el.stop.hidden = false; activeTab = 'tr'; applyTab();
    el.status.textContent = asrMode?(ui==='en'?'Starting audio…':'正在启动录音…'):(T('st_live')||'正在听'); el.status.className = asrMode?'pill':'pill live'; note(''); persist();
    resetSigs(); keepAwake(); render();
    stallWarned = false; stallTries = 0; fellBack = false;lastStallRetry=0;
    timer = setInterval(() => { const sec = Math.round((Date.now()-cur.start)/1000); el.clock.textContent = fmt(sec);
      if (asrMode && running) {
        const quiet = Date.now() - (lastFinalAt || cur.start);
        const wsBad = !asrWs || asrWs.readyState !== 1;
        const heardSound = Date.now() - lastLoudAt < 90000;   // 最近 90 秒房间里有人出过声
        // 90 秒一帧音频都没来 = 采音这条路断了（切了音频设备、系统收回麦克风权限、标签页被节流），
        // 这种要单独算一种断线：它连"安静"都算不上，lastLoudAt 会一直冻在那儿，只看 heardSound 反而更晚发现。
        const noPcm = asrMode && Date.now() - meterLast > 90000;
        if ((wsBad || noPcm || (quiet > 90000 && heardSound)) && sec > 30) {
          if (quiet > 30000 && Date.now()-lastStallRetry>(stallTries<2?30000:120000)) {                       // 先自己救两次，不打扰他
            stallTries++; lastStallRetry = Date.now();
            stallNoticeShown = true;
            note((T('stall_auto')||'转写断了，正在自动重连（第 ') + stallTries + (T('stall_auto2')||' 次）…'), true);
            asrReopen();
          } else if (!fellBack) {
            fellBack = true;cur.transcriptionInterrupted=true;stallNoticeShown=true;
            note(backupHealthy&&safetyRecording?(ui==='en'?'Transcription interrupted. Check Audio backups to recover missing content.':'转写暂时中断，请核对「录音备份」并补转缺失内容。'):(ui==='en'?'Transcription and browser backup are unavailable. Use another recorder now.':'转写中断且浏览器备份不可用，请立即改用其他录音方式。'),true);
          }
        }
        if (!wsBad && !noPcm && quiet < 90000) {
          stallTries = 0; stallWarned = false; fellBack=false;
          // 恢复了就把提示撤掉。只撤自己发的那条：notice 是全局唯一一行，
          // 直接 note('') 会顺手把"录音备份失败"之类别人的警告一起抹掉。
          if (stallNoticeShown) { stallNoticeShown = false; cur.transcriptionInterrupted = false; if (mine(el.notice && el.notice.textContent)) note(''); }
        }
      } if (imeMode) imeIngest(false); if (sec % 40 === 0 && macOnline && !asrMode) analyze(false); const lastAt = cur.transcript.length ? cur.transcript[cur.transcript.length-1].at : cur.start; if (!asrMode && sec > 120 && Date.now() - lastAt > (cfg.autoEndMin||12)*60000) { note(`超过 ${cfg.autoEndMin||12} 分钟没人说话，自动结束。`); stopAll(true); } }, 1000);
  }
  // 当前显示的这行提示是不是"转写断了"这一类（撤提示时只撤自己的）
  function mine(t){ return !t || /转写|Transcription|重连|reconnect/i.test(String(t)); }
  el.stop.onclick = () => stopAll(true);
  async function stopAll(summarize){
    if (!running) return;
    const endingSession=cur;
    if (imeMode) { imeIngest(true); $('#ime').hidden = true; }
    el.start.disabled=true;
    const endDelivered=asrMode?asrStop():false;
    running = false; updateModeChip(); state.live = null; try { rec && rec.stop(); } catch(e){}
    clearInterval(timer); try { wake && wake.release(); } catch(e){}
    el.stop.hidden = true; el.start.hidden = false;
    if (endingSession) { endingSession.end = Date.now(); endingSession.title = endingSession.title || (endingSession.transcript[0] && endingSession.transcript[0].text.slice(0,24)) || ('会议 ' + hms(endingSession.start).slice(0,5)); persist(); }
    if (asrMode && summarize) { endingSession.pendingUpload=true;endingSession.archiveAwaitingSince=Date.now();endingSession.archiveRetryCount=0;endingSession.uploadAfter=Date.now()+130000;persist();note(endDelivered?(ui==='en'?'Recording ended. Waiting for archive confirmation.':'录音已结束，等待归档确认。'):(ui==='en'?'Not delivered to Mac. Saved locally; will retry.':'尚未送达 Mac，已存本机，将自动重试。'),!endDelivered);checkMac().then(uploadPending);setTimeout(refreshArchive,2500); }
    else { if (summarize) await analyze(true); if (endingSession) { endingSession.pendingUpload = true; persist(); checkMac().then(uploadPending); } }
    el.start.disabled=asrStarting;
    el.status.textContent = T('st_ended')||'已结束'; el.status.className = 'pill'; el.src.textContent = '—';
    if(endingSession?.transcript.length)hubAPI('session',{session:endingSession}).catch(e=>note('工作台同步失败：'+e.message,true));
    if (endingSession && endingSession.summary) openSheet('#sh-sum');
    render(); setTimeout(()=>{ checkMac().then(()=>{ viewerConnect(); updateStatusIdle(); }); }, 3000);
  }
