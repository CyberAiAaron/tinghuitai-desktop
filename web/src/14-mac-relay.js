  // ===== Mac 中转：探测 / 模式 / 回传 / 观众 =====
  let macOnline = null, viewWs = null, viewLive = false;
  const relayBase = () => `${location.protocol === 'http:' ? 'http' : 'https'}://${location.host}/asr-relay`;
  const wsBase = () => `${location.protocol === 'http:' ? 'ws' : 'wss'}://${location.host}/asr-relay`;

  // L-11：Mac 上有没有没结束的会。以前在这里直接发一句提示让他自己去「往期会议」里翻，
  // 那是第四个恢复入口；现在只记状态，由启动时那一个恢复面板统一处理。
  let macRecovery=false;
  const macRecoveryNeeded=()=>macRecovery;
  async function checkMac(){ if (!cfg.relayToken && !/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) { macOnline = false; try { updateModeChip(); } catch(e){} return false; } try { const r = await fetch(`${relayBase()}/health?token=${encodeURIComponent(cfg.relayToken)}`, {cache:'no-store', signal: AbortSignal.timeout(4000)}); macOnline = r.ok;if(r.ok){const h=await r.json();archiveAttention=h.archiveNeedsAttention||0;if(!!h.llmDown!==llmDownNow)setLlmDown(!!h.llmDown,h.llmReason?('原因 '+h.llmReason+'。要点和总结已暂停；录音和转写不受影响，会后可以补跑。'):'');try{setLlmDegraded(!!h.llmDegraded,h.llmDegradedReason?('首选模型没回应（'+h.llmDegradedReason+'），已临时改用备用模型；要点和总结照常出。'):'');}catch(e){}macRecovery=!!h.recoveryNeeded;try{setAttention(h.attention);}catch(e){}} } catch(e) { macOnline = false; } try { updateModeChip(); updateAssistantIdentity(); } catch(e){} return macOnline; }
  function resolveMode(){
    const v = el.lang && el.lang.value; if (v && v !== 'auto') return v;
    if (!macOnline) return 'ime';
    // 选了聚合设备 = 非飞书线上会（Teams/Meet/Zoom），走双轨（左=对方 右=我）
    if (cfg.micLabel && /聚合|aggregate|听会台线上会/i.test(cfg.micLabel)) return 'asr-sys';
    return 'asr';
  }
  function updateModeChip(){
    const b = document.querySelector('#mode-chip'); if (!b) return;
    const m=running&&startedMode?startedMode:resolveMode();
    const online=['asr-tab','asr-room','asr-sys'].includes(m);
    const pending=!running&&(!el.lang.value||el.lang.value==='auto');
    b.textContent=(ui==='en'?'Meeting mode · ':'会议模式 · ')+(pending?(ui==='en'?'Choose':'待选择'):(online?(ui==='en'?'Online':'线上会'):(ui==='en'?'In person':'线下会')));
    b.title=running?(ui==='en'?'Current recording mode. Change after this meeting.':'本场实际录音模式，结束后可更改。'):(ui==='en'?'Choose in-person or online meeting':'选择线上会或线下会');

  }