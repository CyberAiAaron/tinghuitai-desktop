  // ===== 火山 ASR（经 Mac 中转）=====
  let safetyRecording = null, backupHealthy = false, asrStarting = false;
  let audioQueue = [], audioQueueBytes = 0;
  let asrWs = null, asrCtx = null, asrNode = null, asrStream = null, asrRetry = 0;
  // —— 两路声源能量对比：对方（系统声/标签页）vs 我（麦克风）——
  let spkTrack = null, lastFinalAt = 0;
  let asrMix = null, asrThemNode = null, asrMicNode = null, asrMicStream = null;
  // 线上会开着开着，旁边的人凑过来一起聊了——这时候要的是整个房间，不该让人停掉这场重开。
  // 只重新拿一次麦克风（换掉降噪那组参数），会议窗口的声音和这条连接都不断。
  async function switchRoomMode(room){
    if (!running || !asrCtx || !asrMix) { note(ui==='en'?'Only while a meeting is recording.':'录音中才能换收音方式。', true); return false; }
    if (!['asr-tab','asr-room'].includes(startedMode)) { note(ui==='en'?'This meeting type has no room option.':'这种开会方式没有这个切换。', true); return false; }
    if (room === (startedMode === 'asr-room')) return true;
    const micCon = room
      ? {channelCount:1, echoCancellation:false, noiseSuppression:false, autoGainControl:false}
      : {channelCount:1, echoCancellation:true, noiseSuppression:true, autoGainControl:true};
    let mic;
    try {
      mic = await navigator.mediaDevices.getUserMedia({audio: Object.assign(micCon, cfg.micId ? {deviceId:{exact: cfg.micId}} : {})});
    } catch(e) {
      note((ui==='en'?'Could not switch: ':'换不了：')+(e.message||e), true); return false;
    }
    try { if (asrMicNode) asrMicNode.disconnect(); } catch(e){}
    try { if (asrMicStream) asrMicStream.getTracks().forEach(t=>t.stop()); } catch(e){}
    const nMe = asrCtx.createMediaStreamSource(mic); nMe.connect(asrMix);
    asrMicNode = nMe; asrMicStream = mic;
    startSpkTrack(asrCtx, asrThemNode, nMe);     // 说话人判别要跟着新的这一路重建
    if (asrStream) asrStream._extra = (asrStream._extra||[]).filter(x=>x && x!==mic).concat([mic]);
    startedMode = room ? 'asr-room' : 'asr-tab';
    if (cur) { cur.lang = startedMode; cur.mode = startedMode; }
    window.__roomMode = room;
    el.src.textContent = room ? '会议窗口声音 + 整个房间 → 分「线上」和「在场」两路' : '会议窗口声音 + 你的麦克风（已降噪）→ 分「线上」和「我」两路';
    try { updateModeChip(); renderModeList(); } catch(e){}
    persist();
    note(room ? (ui==='en'?'Now picking up the whole room. The online side is unchanged.':'现在连整个房间一起收了，线上那一路没断。')
              : (ui==='en'?'Back to just you, with noise suppression on.':'切回只收你自己，降噪已打开。'));
    setTimeout(()=>note(''), 4000);
    return true;
  }
  function startSpkTrack(ctx, nThem, nMe){
    stopSpkTrack();
    const mk = n => { if (!n) return null; const an = ctx.createAnalyser(); an.fftSize = 512; n.connect(an); return an; };
    const A = mk(nThem), B = mk(nMe); if (!A || !B) return;
    const ba = new Float32Array(512), bb = new Float32Array(512);
    const rms = (an, b) => { an.getFloatTimeDomainData(b); let x=0; for (let i=0;i<b.length;i++) x += b[i]*b[i]; return Math.sqrt(x/b.length); };
    const log = [];
    const timer = setInterval(() => { const t = Date.now(); log.push({t, a: rms(A,ba), b: rms(B,bb)}); while (log.length && t - log[0].t > 180000) log.shift(); }, 80);
    spkTrack = {log, timer};
  }
  function stopSpkTrack(){ if (spkTrack) { clearInterval(spkTrack.timer); spkTrack = null; } }
  function whoSpoke(from, to){
    if (!spkTrack) return '';
    let a = 0, b = 0, n = 0;
    for (const e of spkTrack.log) if (e.t >= from && e.t <= to) { a += e.a; b += e.b; n++; }
    if (n < 3) return '';
    const q = 0.004 * n;
    if (a < q && b < q) return '';
    if (a > b * 1.5) return 'them';
    if (b > a * 1.5) return 'me';
    return '';
  }
  async function asrAudioUp(){
    if (asrStream) return;
    const __m = (startedMode || el.lang.value);
    if (__m === 'asr-tab' || __m === 'asr-room') {
      const roomMode = (__m === 'asr-room');
      const ds = await navigator.mediaDevices.getDisplayMedia({video:true, audio:{echoCancellation:false, noiseSuppression:false}});
      if (!ds.getAudioTracks().length) { ds.getTracks().forEach(t=>t.stop()); throw new Error('没有勾选「分享音频」。选会议所在的标签页或整个屏幕时，勾上音频再确认。'); }
      ds.getVideoTracks().forEach(t=>t.stop());
      // 一个人在工位：开降噪和回声消除，只收自己，旁边同事的闲聊别进来。
      // 会议室里还有人：全关，要的就是整个房间。
      const micCon = roomMode
        ? {channelCount:1, echoCancellation:false, noiseSuppression:false, autoGainControl:false}
        : {channelCount:1, echoCancellation:true, noiseSuppression:true, autoGainControl:true};
      const mic = await navigator.mediaDevices.getUserMedia({audio: Object.assign(micCon, cfg.micId ? {deviceId:{exact: cfg.micId}} : {})}).catch(e=>{ds.getTracks().forEach(t=>t.stop());throw new Error('麦克风不可用，无法完整记录你的发言：'+e.message);});
      asrCtx = new (window.AudioContext||window.webkitAudioContext)();
      const mix = asrCtx.createMediaStreamDestination();
      const nThem = asrCtx.createMediaStreamSource(ds); nThem.connect(mix);
      const nMe = mic ? asrCtx.createMediaStreamSource(mic) : null; if (nMe) nMe.connect(mix);
      startSpkTrack(asrCtx, nThem, nMe);
      // 会中要换收音方式：只换麦克风这一路，会议窗口那一路和这条会议连接都不动
      asrMix = mix; asrThemNode = nThem; asrMicNode = nMe; asrMicStream = mic;
      asrStream = mix.stream; asrStream._extra = [ds, mic].filter(Boolean);
      el.src.textContent = roomMode ? '会议窗口声音 + 整个房间 → 分「线上」和「在场」两路' : '会议窗口声音 + 你的麦克风（已降噪）→ 分「线上」和「我」两路';
      window.__roomMode = roomMode;
    } else if ((startedMode || el.lang.value) === 'asr-sys') {
      const con = {audio: Object.assign({channelCount:2, echoCancellation:false, noiseSuppression:false, autoGainControl:false}, cfg.micId ? {deviceId:{exact: cfg.micId}} : {})};
      const st = await navigator.mediaDevices.getUserMedia(con);
      asrCtx = new (window.AudioContext||window.webkitAudioContext)();
      const src0 = asrCtx.createMediaStreamSource(st);
      const mix = asrCtx.createMediaStreamDestination();
      const chs = (st.getAudioTracks()[0].getSettings().channelCount) || 1;
      if (chs >= 2) {
        const sp = asrCtx.createChannelSplitter(2);
        src0.connect(sp);
        const gT = asrCtx.createGain(), gM = asrCtx.createGain();
        sp.connect(gT, 0); sp.connect(gM, 1);
        gT.connect(mix); gM.connect(mix);
        startSpkTrack(asrCtx, gT, gM);
        el.src.textContent = T('src_sys2')||'聚合设备双轨 → 火山（左=对方，右=我）';
      } else {
        src0.connect(mix);
        el.src.textContent = T('src_sys1')||'聚合设备单轨 → 火山（分不出说话人）';
      }
      asrStream = mix.stream; asrStream._extra = [st];
    } else {
      asrStream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1, echoCancellation:true, noiseSuppression:true, autoGainControl:true}});
      asrCtx = new (window.AudioContext||window.webkitAudioContext)();
      el.src.textContent = T('src_mic')||'本机麦克风 → 火山 ASR';
    }
    await asrCtx.resume();
    backupHealthy=true;
    try { safetyRecording = await RecordingSafety.start(asrStream,cur.id,(status,data)=>{
      $('#recording-safety-status').textContent=status==='saved'?(cur.transcriptionInterrupted?(ui==='en'?'Transcription interrupted; browser audio backup is saving.':'转写仍中断；浏览器正在保存音频备份。'):cur.untranscribedSeconds?(ui==='en'?'Some audio needs recovery from this browser backup':'部分音频需从本浏览器备份恢复'):(ui==='en'?'Audio saved in this browser':'原始录音已存本浏览器')):(ui==='en'?'Audio backup failed — export available recording now':'录音备份失败，请立即导出已有录音');
      if(status==='error'){backupHealthy=false;}
      if(status==='error')note((ui==='en'?'Audio backup error: ':'录音备份异常：')+(data.message||data),true);
    });
    } catch(e){safetyRecording=null;backupHealthy=false;$('#recording-safety-status').textContent=ui==='en'?'Browser backup unavailable; live transcription continues. Keep this page open.':'浏览器备份不可用，实时转写继续。请保持页面打开并检查 Mac 保存状态。';note((ui==='en'?'Local storage error: ':'本机存储异常：')+e.message,true);}
    for(const stream of [asrStream,...(asrStream._extra||[])])for(const track of stream.getAudioTracks())track.addEventListener('ended',()=>{if(running)note(ui==='en'?'Audio input ended. Reconnect the microphone or shared audio.':'音频输入已停止，请重新连接麦克风或共享音频。已录部分保留。',true);});
    const src = asrCtx.createMediaStreamSource(asrStream);
    asrNode = asrCtx.createScriptProcessor(4096, 1, 1);
    asrNode.onaudioprocess = e => { const f = e.inputBuffer.getChannelData(0); updateAudioMeter(f); const b = new Int16Array(f.length); for (let i=0;i<f.length;i++){ const v = Math.max(-1, Math.min(1, f[i])); b[i] = v < 0 ? v*0x8000 : v*0x7FFF; } if(!asrWs || asrWs.readyState!==1 || asrWs.bufferedAmount>1024*1024){audioQueue.push(b.buffer);audioQueueBytes+=b.byteLength;while(audioQueueBytes>asrCtx.sampleRate*2*30){const dropped=audioQueue.shift().byteLength;audioQueueBytes-=dropped;cur.untranscribedSeconds=(cur.untranscribedSeconds||0)+dropped/(asrCtx.sampleRate*2);$('#recording-safety-status').textContent=backupHealthy&&safetyRecording?(ui==='en'?'Connection interrupted: check this browser backup for missing audio.':'断网超过30秒，请核对本浏览器备份并补转。'):(ui==='en'?'Audio has been lost: connection and backup unavailable. Use another recorder now.':'音频已丢失：连接中断且备份不可用，请立即改用其他录音方式。');}return;}for(const chunk of audioQueue)asrWs.send(chunk);audioQueue=[];audioQueueBytes=0;asrWs.send(b.buffer); };
    src.connect(asrNode); asrNode.connect(asrCtx.destination);
  }
  function asrReopen(){
    const w = asrWs; asrWs = null;
    if (w) { try { w.onclose = null; w.onmessage = null; w.onerror = null; w.onopen = null; } catch(e){} try { w.close(); } catch(e){} }
    asrOpen();
  }
  let asrGen = 0;                      // 连接代号：只认最新一条连接的消息
  const seenFinals = [];               // 最近的 final 指纹，跨连接去重
  // 同一句在 20 秒内又来一次，多半是转写重发。但「嗯」「对」「hmm」这种短应答
  // 人真的会连说几次——2026-09-12 在一场真实会议上数过：195 条重复里 188 条是短应答，
  // 只有 7 条够长。所以只挡长句，短的一律放行。
  const DUP_MIN = 12;
  function isDup(text){
    const now = Date.now(), key = String(text).replace(/\s+/g,'');
    if (key.length < DUP_MIN) return false;
    while (seenFinals.length && now - seenFinals[0].t > 20000) seenFinals.shift();
    if (seenFinals.some(x => x.k === key)) return true;
    seenFinals.push({k:key, t:now});
    if (seenFinals.length > 60) seenFinals.shift();
    return false;
  }
  function asrOpen(){
    if (asrWs) { try { asrWs.onopen = asrWs.onmessage = asrWs.onclose = asrWs.onerror = null; asrWs.close(); } catch(e){} asrWs = null; }
    if (!cfg.relayToken) { note('火山 ASR 需要「Mac 中转口令」，去 ⚙︎ 填。', true); return; }
    const recordingSession = cur;
    const gen = ++asrGen;
    const ws = new WebSocket(`${wsBase()}?token=${encodeURIComponent(cfg.relayToken)}`);
    ws.binaryType = 'arraybuffer';
    asrWs = ws;
    const mine = () => (gen === asrGen && asrWs === ws);
    ws.onopen = () => { if (!mine()) { try { ws.close(); } catch(e){} return; }
      asrRetry = 0; note('');
      ws.send(JSON.stringify({type:'start', sessionId: cur.id, title: cur.title||'', source: /Mobile|Android|iPhone/.test(navigator.userAgent)?'手机':'电脑', lang: relayLang(), uiLang: ui, rate: asrCtx ? asrCtx.sampleRate : 16000, hotwords: allHotwords(), brief: effectiveBrief(cur), fixes: parseFixes(briefFix), transcriptEdits:cur.transcriptEdits||[], names: cur.names||{}}));
    };
    ws.onmessage = ev => {
      const cur = recordingSession;
      if (!mine()) return;                                  // 旧连接的消息一律丢弃
      let m; try { m = JSON.parse(ev.data); } catch(e) { return; }
      if (m.type === 'partial') { interim = m.text || ''; render(); }
      else if (m.type === 'final' && m.text) { cur.transcriptionInterrupted=false;
        interim = '';
        // Relay deduplicates utterance IDs/timestamps; repeated spoken words are valid.                          // 20 秒内同一句只收一次
        const now = Date.now();
        if (isDup(m.text)) return;                       // 长句在 20 秒内重发，丢掉
        const spk = m.speaker ? String(m.speaker) : whoSpoke(lastFinalAt || (now - 8000), now);
        lastFinalAt = now;
        cur.transcript.push({at: now, t: Math.round((now-cur.start)/1000), text: m.text, spk});
        // 识别语言选「自动」时，攒够几句就去认一次是中文还是英文。
        // 这一行以前漏了，于是「自动」这个选项从来没真正生效过（2026-09-12 补）。
        try { maybeDetectTongue(); } catch(e){}
        if(spk && !m.speaker && asrWs?.readyState===1) asrWs.send(JSON.stringify({type:'spk',who:spk,at:now}));
        persist(); render();
      }
      else if (m.type === 'speaker_update' && cur.transcript[m.index]) {cur.transcript[m.index].spk=m.speaker;resetSigs();render();}
        else if (m.type === 'revise') applyRevise(m);
        else if (m.type === 'recomputed') applyRecomputed(m);
        else if (m.type === 'condensed') applyCondensed(m);
        else if (m.type === 'stale') markStale(m);
        else if (m.type === 'feedback') applyFeedback(m);
      else if (m.type === 'summary' && m.text) { cur.summary = m.text; cur.relayHandled = true; persist(); render(); }
      // R1：中转 12 分钟收不到音频就自己把这场收尾，然后发这条。页面原来只记一笔就接着录——
      // 手机锁屏再解锁那种场合，后半场其实一个字都没进库，人却毫无察觉。服务端那边已经结束了，
      // 本机再录也没有去处：直接停下，并且用红条把「后面的没录上」说明白。
      else if (m.type === 'ended') { cur.relayHandled=true;persist();refreshArchive();
        if(running){ stopAll(false);
          note(ui==='en'?'The Mac ended this meeting; anything spoken after that was not recorded. Please start a new meeting.'
                        :'服务端已经结束了这场会，后面的内容没有被记录。请重新开始一场。','danger'); } }
      else if (m.type === 'stall') note(m.message || (T('stall_relay')||'中转报告采音异常。'), true);
      else if (m.type === 'llm_down') setLlmDown(true, m.message||'');
      else if (m.type === 'llm_degraded') setLlmDegraded(!!m.on, m.message||'');
      else if (m.type === 'llm_up') { setLlmDown(false); note(ui==='en'?'Model is back; analysis resumes.':'模型已恢复，分析继续'); }
      else if (m.type === 'error') note('中转报错：' + (m.message||''), true);
    };
    ws.onclose = (ev) => {
      if (!mine()) return;                                   // 旧连接关掉不触发重连
      asrWs = null;
      if(ev.code===4409){if(running)stopAll(false);note(ui==='en'?'This meeting has already ended. Start a new meeting to continue.':'上一场已结束并保留，请点开始听会新建一场。',true);return;}
      if (!(running && asrMode)) return;
      asrRetry++;
      const why = ev && ev.code===4401 ? '口令不对（⚙︎ 里核对）' : ev && ev.code===1006 ? '连接被中断（网络/funnel）' : (ev && ev.reason) || ('code '+(ev&&ev.code));
      note(`中转断开：${why}；第 ${asrRetry} 次重连…`, true);
      setTimeout(() => { if (running && asrMode && gen === asrGen) asrOpen(); }, Math.min(15000, 2000*asrRetry));
    };
  }
  window.addEventListener('beforeunload',e=>{if(running){e.preventDefault();e.returnValue='';}});
  $('#recording-recovery').onclick=async()=>{
    const box=$('#recording-recovery-list');box.textContent='读取中…';$('#recording-recovery-dialog').showModal();
    try{const rows=await RecordingSafety.list();box.textContent=rows.length?(ui==='en'?'Total: ':'总占用：')+(rows.reduce((n,r)=>n+r.bytes,0)/1048576).toFixed(1)+' MB':'本浏览器暂无录音 / No local recordings';
      for(const r of rows.sort((a,b)=>b.started-a.started)){const p=document.createElement('p'),btn=document.createElement('button');btn.className='btn';btn.textContent=new Date(r.started).toLocaleString()+' · '+(r.bytes/1048576).toFixed(1)+' MB · '+(r.state==='error'?'保存出错 / Save error':!r.ended?'未正常收尾 / Not finalized':!r.chunks?'无音频片段 / No chunks':'已收尾 / Finalized')+' · 导出 / Export';btn.onclick=async()=>{try{const b=await RecordingSafety.blob(r.id),url=URL.createObjectURL(b),a=document.createElement('a');a.href=url;a.download=r.id+(r.mime.includes('mp4')?'.m4a':'.webm');a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(e){note(e.message,true);}};p.append(btn);if(!(running&&r.sessionId===cur?.id)){const del=document.createElement('button');del.className='btn sm';del.textContent=ui==='en'?'Delete backup':'删除备份';del.onclick=async()=>{if(!confirm(ui==='en'?'Delete this local audio backup permanently? Export it first if needed.':'永久删除这份本机录音备份？需要保留请先导出。'))return;try{await RecordingSafety.remove(r.id);p.remove();}catch(e){note(e.message,true);}};p.append(del);}box.append(p);}
    }catch(e){box.textContent='读取失败：'+e.message;}
  };