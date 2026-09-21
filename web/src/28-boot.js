  // ===== 启动 =====
  const liveSess = state.live && state.sessions.find(s=>s.id===state.live && !s.end);
  const last = [...state.sessions].sort((a,b)=>b.start-a.start)[0];
  if (liveSess) { cur = liveSess; render(); note('上一场没有正常结束（页面被刷新或关闭）。', true); }
  else if (last) { cur = last; render(); }
  if (!cfg.key && !cfg.relayToken && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) note(T('firstUse')||'第一次使用：点右上角 ⚙︎ 填 Mac 中转口令和 DeepSeek key（只存在这台设备）。');
  try { const t = localStorage.getItem('tht-tongue'); el.tongue.value = t || defaultTongueForUi(); } catch(e){}
  applyI18n();
  try { updateReadyBar(); } catch(e){}
  pullPostCards();
  checkMac().then(ok => {
    if (liveSess) {
      const rLast = liveSess.transcript.length ? liveSess.transcript[liveSess.transcript.length-1].at : liveSess.start;
      const rMin = Math.max(1, Math.round((Date.now()-rLast)/60000));
      $('#resume-info').textContent = ui==='en'?'Your unfinished meeting is saved. Continue recording in the same session. Audio while this page was closed was not captured.':'未结束的会议已保留，可继续这场。关闭页面期间没有录音；若会议已自动归档，会提示另开一场。';
      // L-11：恢复只留启动时这一个入口，并且直接给推荐——两个按钮一样显眼时，用户没有判断依据。
      // 判据就一条：离上一句话多久。半小时内多半是页面被刷掉了，那场会还在开；超过就当它已经散了。
      const stale = rMin > 30;
      $('#resume-rec').textContent = stale
        ? (ui==='en' ? ('Last speech was '+rMin+' min ago — recommended: end it and start a new one.') : ('上一句话是 '+rMin+' 分钟前，建议结束它、开新的一场。'))
        : (ui==='en' ? ('Last speech was '+rMin+' min ago — recommended: continue this meeting.') : ('上一句话是 '+rMin+' 分钟前，建议继续这场。'));
      $('#resume-go').className = stale ? 'btn' : 'btn primary';
      $('#resume-end').className = stale ? 'btn primary' : 'btn';
      $('#resume-go').onclick = () => { closeSheets(); if (el.lang) el.lang.value = ['auto','asr','asr-sys','asr-tab','asr-room','ime','browser'].includes(liveSess.lang) ? liveSess.lang : 'auto'; updateModeChip(); startAll(liveSess,el.lang.value); };
      $('#resume-end').onclick = () => { closeSheets(); liveSess.end = Date.now(); liveSess.title = liveSess.title || ('会议 ' + hms(liveSess.start).slice(0,5)); liveSess.pendingUpload = true; state.live = null; persist(); render(); note(T('resume_ended')||'上一场已结束。点「开始听会」开新的一场。'); setTimeout(()=>note(''),4000); };
      $('#resume-pull').hidden = true;
      openSheet('#sh-resume');
    } else if (ok && macRecoveryNeeded()) {
      // Mac 上留着一场没结束的：以前只发一句「请打开往期会议 → 从 Mac 找回」，是第四个入口。
      // 现在同一个面板直接给按钮。
      $('#resume-info').textContent = ui==='en'
        ? 'An interrupted meeting is still saved on your Mac. Pull it over to keep working on it.'
        : 'Mac 上留着一场没有正常结束的会。找回来就能接着处理。';
      $('#resume-rec').textContent = '';
      $('#resume-go').hidden = true; $('#resume-end').hidden = true;
      const pull = $('#resume-pull'); pull.hidden = false; pull.className = 'btn primary';
      pull.onclick = async () => { pull.disabled = true; try { await pullFromMac($('#resume-rec')); closeSheets(); await refreshBoard(); openSheet('#sh-hist'); } catch(e){} finally { pull.disabled = false; } };
      openSheet('#sh-resume');
    }
    updateStatusIdle(); uploadPending(); viewerConnect(); autoPickMic(); pullPostCards(); if(ok&&!cur)fetch(relayBase()+'/export-state?token='+encodeURIComponent(cfg.relayToken||'')).then(r=>r.ok?r.json():null).then(j=>{if(!cur&&j?.sessions?.length){cur=j.sessions.map(normalizeSession).sort((a,b)=>b.start-a.start)[0];state.sessions.push(cur);persist();resetSigs();render();try{renderPostCards();}catch(e){}}}).catch(()=>{});
  });
  setInterval(() => { if (!running) checkMac().then(()=>{ updateStatusIdle(); viewerConnect();uploadPending(); }); }, 60000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
