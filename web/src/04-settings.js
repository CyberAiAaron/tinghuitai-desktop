  // ===== 设置 =====
  const DEF = {provider:'deepseek', key:'', base:'', quick:'deepseek-chat', model:'deepseek-chat', relayToken:window.THT_BOOT?.relayToken||'', micId:'', micLabel:'', hotwords:'', autoEndMin:12};
  const PRESET = {deepseek:{base:'https://api.deepseek.com', quick:'deepseek-chat', model:'deepseek-chat'}, anthropic:{base:'', quick:'claude-haiku-4-5', model:'claude-sonnet-4-5'}, openai:{base:'', quick:'', model:''}};
  let ctx = ''; try { ctx = localStorage.getItem('tht-ctx') || ''; } catch(e){}
  let cfg = Object.assign({}, DEF); try { Object.assign(cfg, JSON.parse(localStorage.getItem('tht-settings')||'{}')); } catch(e){}
  const ctxHint = () => { $('#s-ctx-hint').textContent = ctx ? `已加载 ${ctx.length} 字。` : '未填：Mac 离线时会中分析只能靠转写本身。'; };
  const dlg = $('#dlg');
  function openSettings(){ loadServerSettings(); $('#s-provider').value = cfg.provider; $('#s-key').value = cfg.key; $('#s-base').value = cfg.base; $('#s-quick').value = cfg.quick; $('#s-model').value = cfg.model; $('#s-relay').value = cfg.relayToken||''; $('#s-hot').value = cfg.hotwords||''; fillMics(); $('#s-auto').value = cfg.autoEndMin||12; $('#f-base').hidden = cfg.provider!=='openai'; $('#s-msg').hidden = true; $('#s-ctx').value = ctx; ctxHint(); dlg.showModal(); }
  async function autoPickMic(){
    if (cfg.micId) return;                       // 他自己指定过就不动
    try {
      const ds = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.label);
      const pri = [/yooo?claw/i, /聚合|aggregate|听会台线上会/i];
      for (const re of pri) {
        const hit = ds.find(d => re.test(d.label));
        if (hit) { cfg.micId = hit.deviceId; cfg.micLabel = hit.label;
          try { localStorage.setItem('tht-settings', JSON.stringify(cfg)); } catch(e){}
          note((T('auto_mic')||'自动选了收音设备：') + hit.label); setTimeout(()=>note(''), 3000); return; }
      }
    } catch(e){}
  }
  async function fillMics(){
    const sel = $('#s-mic'), hint = $('#s-mic-hint');
    try {
      const ds = (await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput');
      sel.innerHTML = `<option value="">${T('mic_default')||'系统默认'}</option>` + ds.map(d=>`<option value="${esc(d.deviceId)}">${esc(d.label||('输入设备 '+d.deviceId.slice(0,6)))}</option>`).join('');
      sel.value = cfg.micId || '';
      hint.textContent = ds.some(d=>d.label) ? (T('mic_hint')||'桌面 App 开会时选「聚合设备（BlackHole + 麦克风）」，才能听见对方。') : (T('mic_nolabel')||'先允许一次麦克风权限，设备名才显示得出来。');
    } catch(e){ hint.textContent = String(e.message||e); }
  }
  $('#gear').onclick = () => { window.open('setup.html', 'tinghuitai-service-settings', 'popup,width=720,height=860'); };