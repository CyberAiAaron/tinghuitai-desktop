  // ===== Mac 中转：探测 / 模式 / 回传 / 观众 =====
  let macOnline = null, viewWs = null, viewLive = false;
  const relayBase = () => `${location.protocol === 'http:' ? 'http' : 'https'}://${location.host}/asr-relay`;
  const wsBase = () => `${location.protocol === 'http:' ? 'ws' : 'wss'}://${location.host}/asr-relay`;
  let recoveryNotified=false;
  async function checkMac(){ if (!cfg.relayToken && !/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) { macOnline = false; try { updateModeChip(); } catch(e){} return false; } try { const r = await fetch(`${relayBase()}/health?token=${encodeURIComponent(cfg.relayToken)}`, {cache:'no-store', signal: AbortSignal.timeout(4000)}); macOnline = r.ok;if(r.ok){const h=await r.json();archiveAttention=h.archiveNeedsAttention||0;if(h.recoveryNeeded&&!recoveryNotified){recoveryNotified=true;note(ui==='en'?'An interrupted meeting is saved on your Mac. Open History → Recover from Mac.':'Mac 保存了未结束的会议。请打开「历史场次 → 从 Mac 找回」恢复。',true);}} } catch(e) { macOnline = false; } try { updateModeChip(); updateAssistantIdentity(); } catch(e){} return macOnline; }
  function resolveMode(){
    const v = el.lang && el.lang.value; if (v && v !== 'auto') return v;
    if (!macOnline) return 'ime';
    // 选了聚合设备 = 非飞书线上会（Teams/Meet/Zoom），走双轨（左=对方 右=我）
    if (cfg.micLabel && /聚合|aggregate|听会台线上会/i.test(cfg.micLabel)) return 'asr-sys';
    return 'asr';
  }
  const MODE_LABEL_ZH = {asr:'面对面', 'asr-sys':'线上会', ime:'输入法听写', browser:'浏览器识别', caption:'字幕', 'asr-tab':'线上会','asr-room':'线上+线下'};
  const MODE_LABEL_EN = {asr:'In person', 'asr-sys':'Online call', ime:'IME dictation', browser:'Browser ASR', caption:'Captions', 'asr-room':'Online + room','asr-tab':'Tab audio'};
  const modeLabel = m => (ui === 'en' ? MODE_LABEL_EN[m] : MODE_LABEL_ZH[m]) || MODE_LABEL_ZH[m] || m;
  function updateModeChip(){
    const b = document.querySelector('#mode-chip'); if (!b) return;
    const m=running&&startedMode?startedMode:resolveMode();
    const online=['asr-tab','asr-room','asr-sys'].includes(m);
    const pending=!running&&(!el.lang.value||el.lang.value==='auto');
    b.textContent=(ui==='en'?'Meeting mode · ':'会议模式 · ')+(pending?(ui==='en'?'Choose':'待选择'):(online?(ui==='en'?'Online':'线上会'):(ui==='en'?'In person':'线下会')));
    b.title=running?(ui==='en'?'Current recording mode. Change after this meeting.':'本场实际录音模式，结束后可更改。'):(ui==='en'?'Choose in-person or online meeting':'选择线上会或线下会');

  }