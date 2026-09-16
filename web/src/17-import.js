  // ===== 导入现成转写 =====
  function parseTranscript(raw){
    const out = [];
    let txt = String(raw||'').replace(/\r/g,'');
    // WebVTT / SRT：去掉序号行和时间轴行
    if (/^WEBVTT/i.test(txt) || /\d\d:\d\d:\d\d[.,]\d{3}\s*-->/.test(txt)) {
      txt = txt.split('\n').filter(l => !/^WEBVTT/i.test(l) && !/-->/.test(l) && !/^\d+$/.test(l.trim())).join('\n');
    }
    const lines = txt.split('\n').map(l=>l.trim()).filter(Boolean);
    let pendingSpk = '';
    for (const line of lines) {
      let spk = '', t = line, sec = null;
      // 「00:12:34 张三：内容」/「00:12 张三  内容」/「张三：内容」/「[00:12] Name: text」
      let m = t.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(.*)$/);
      if (m) { const p = m[1].split(':').map(Number); sec = p.length===3 ? p[0]*3600+p[1]*60+p[2] : p[0]*60+p[1]; t = m[2]; }
      m = t.match(/^([^:：]{1,20})[:：]\s*(.+)$/);
      if (m && !/^https?$/i.test(m[1])) { spk = m[1].trim(); t = m[2].trim(); }
      if (!t) { if (spk) pendingSpk = spk; continue; }   // 只有名字单独一行
      if (!spk && pendingSpk) { spk = pendingSpk; }
      out.push({spk, text: t, sec});
    }
    return out;
  }
  const openImport = () => { $('#imp-msg').textContent = ''; openSheet('#sh-import'); };
  $('#b-import').onclick = openImport;
  let impAudio = null;
  $('#imp-file').onchange = e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    if (/\.(m4a|mp3|wav|aac|caf|ogg)$/i.test(f.name) || /^audio\//.test(f.type)) {
      impAudio = f;
      if (!$('#imp-title').value) $('#imp-title').value = f.name.replace(/\.[^.]+$/,'');
      $('#imp-msg').textContent = (T('imp_audio')||'录音文件：') + f.name + '（' + Math.round(f.size/1e6) + ' MB）' + (T('imp_audio2')||'，点「开始分析」交给 Mac 转写。');
      return;
    }
    impAudio = null;
    const r = new FileReader();
    r.onload = () => { $('#imp-text').value = String(r.result||''); if (!$('#imp-title').value) $('#imp-title').value = f.name.replace(/\.[^.]+$/,''); $('#imp-msg').textContent = (T('imp_read')||'读进来了，') + f.name; };
    r.readAsText(f, 'utf-8');
  };
  // 导入场次：分段跑一遍会中分诊，把要点/待办/待核查补上（会中那条没跑过）
  async function analyzeImported(msgEl){
    if (!cfg.key && !macOnline) return false;
    const lines = cur.transcript.map(x => (x.spk ? x.spk + '：' : '') + x.text);
    const chunks = []; let buf = '';
    for (const l of lines) { if ((buf + l).length > 1500 && buf) { chunks.push(buf); buf = ''; } buf += l + '\n'; }
    if (buf.trim()) chunks.push(buf);
    const CTX = ctx ? `【项目核心记忆（只读，用于判断冲突/相关性；不要复述）】\n${ctx.slice(0,6000)}\n\n` : '';
    const LANG = ui === 'en' ? 'Write every text / claim / note / how field in ENGLISH.\n' : '所有 text / claim / note 字段一律用中文。\n';
    for (let i = 0; i < chunks.length; i++) {
      if (msgEl) msgEl.textContent = (T('imp_an')||'本机分析中 ') + (i+1) + '/' + chunks.length + '…';
      const have = [...cur.highlights.map(x=>x.text), ...cur.todos.map(x=>x.text), ...cur.factchecks.map(x=>x.claim)].slice(-40).join('\n');
      try {
        const r = parseJSON(await llm(`${CTX}${briefBlock()}${LANG}${TRIAGE}\n\n【已有条目】\n${have}\n\n【最新转写】\n${chunks[i]}`, 'quick'));
        applyFeedback(r);
      } catch(e){ if (msgEl) msgEl.textContent = (T('imp_an_err')||'分析出错：') + (e.message||e); return false; }
    }
    persist(); render(); return true;
  }
  $('#imp-go').onclick = async () => {
    const m = $('#imp-msg');
    if (running) { m.textContent = T('imp_busy')||'正在开会，结束这场再导入。'; return; }
    if (impAudio) {
      if (!cfg.relayToken && !/^127\.0\.0\.1|^localhost/.test(location.hostname)) { m.textContent = T('imp_need_mac')||'录音要交给 Mac 转写，先在设置里填中转口令。'; return; }
      m.textContent = T('imp_up')||'上传录音给 Mac……';
      try {
        const fd = new FormData(); fd.append('title', ($('#imp-title').value||'').trim()); fd.append('engine',$('#imp-engine').value);fd.append('speakers',$('#imp-speakers').value);fd.append('language',tongue()==='mix'?'auto':tongue());fd.append('audio', impAudio, impAudio.name);
        const r = await fetch(`${relayBase()}/audio?token=${encodeURIComponent(cfg.relayToken||'')}`, {method:'POST', body: fd});
        const d = await r.json().catch(()=>({}));
        if (!r.ok || d.ok === false) throw new Error(d.error || ('HTTP ' + r.status));
        m.textContent = d.sessionId?(ui==='en'?'Queued locally. Open Meeting archive for progress and results.':'已加入本地整理队列，请到「会议档案」查看进度与结果。'):(ui==='en'?'Transcribing on this Mac. View progress and results in Workspace.':'正在 Mac 本地转写和区分说话人，请到工作台查看进度与结果。');
      } catch(e){ m.textContent = (T('imp_up_audio_fail')||'上传失败：') + (e.message||e) + (T('imp_up_audio_fail2')||'（Mac 在线吗？这条要中转支持，可能还没上线）'); }
      return;
    }
    const rows = parseTranscript($('#imp-text').value);
    if (!rows.length) { m.textContent = T('imp_empty')||'没读到内容，粘贴文字或选个文件。'; return; }
    const title = ($('#imp-title').value || '').trim() || (T('imp_untitled')||'导入的转写');
    const t0 = Date.now() - (rows[rows.length-1].sec ? rows[rows.length-1].sec*1000 : rows.length*4000);
    const sess = newSession('import', 'import');
    sess.title = title; sess.start = t0;
    rows.forEach((r, i) => {
      const at = t0 + (r.sec != null ? r.sec*1000 : i*4000);
      if (r.spk) sess.names[r.spk] = r.spk;
      sess.transcript.push({at, t: Math.round((at-t0)/1000), text: r.text, spk: r.spk||''});
    });
    sess.end = sess.transcript[sess.transcript.length-1].at;
    sess.pendingUpload = true;
    state.sessions.push(sess); cur = sess; persist(); resetSigs(); render();
    m.textContent = (T('imp_ok')||'已建成一场：') + rows.length + (T('imp_ok2')||' 句。正在交给 Mac 出要点、待办、待核查和深度纪要……');
    // 先在本机把要点/待办/待核查补出来（Mac 那条只出深度版）
    const did = await analyzeImported(m);
    if (did) { try { await analyze(true); } catch(e){} render(); }
    const ok = await checkMac();
    if (ok) {
      await uploadPending();
      m.textContent = cur.pendingUpload
        ? (T('imp_up_fail')||'要点已出，但上传中转失败，等会自动重试。')
        : ((did ? (T('imp_done_an')||'要点·待核查已出。') : '') + (T('imp_up_ok')||'已交给 Mac，深度纪要几分钟后进时光机群，并私聊你问要不要对外分享。'));
    } else if (did) { m.textContent = T('imp_local_ok')||'本机分析完成。Mac 上线后自动补交深度版。'; }
    else { m.textContent = T('imp_nokey')||'Mac 不在线、也没填分析用的 key，先只存下来了。'; }
    renderHist();
  };