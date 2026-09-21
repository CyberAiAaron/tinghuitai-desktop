  // ===== 设置 =====
  const DEF = {provider:'deepseek', key:'', base:'', quick:'deepseek-chat', model:'deepseek-chat', relayToken:window.THT_BOOT?.relayToken||'', micId:'', micLabel:'', hotwords:'', autoEndMin:12};
  const PRESET = {deepseek:{base:'https://api.deepseek.com', quick:'deepseek-chat', model:'deepseek-chat'}, anthropic:{base:'', quick:'claude-haiku-4-5', model:'claude-sonnet-4-5'}, openai:{base:'', quick:'', model:''}};
  let ctx = ''; try { ctx = localStorage.getItem('tht-ctx') || ''; } catch(e){}
  let cfg = Object.assign({}, DEF); try { Object.assign(cfg, JSON.parse(localStorage.getItem('tht-settings')||'{}')); } catch(e){}
  const ctxHint = () => { $('#s-ctx-hint').textContent = ctx ? `已加载 ${ctx.length} 字。` : '未填：Mac 离线时会中分析只能靠转写本身。'; };
  const dlg = $('#dlg');
  // L-13：以前有两套设置界面——设置弹窗和 setup.html，同一批配置两处都能改，setup.html 还有 5 个入口。
  // 现在 setup.html 只留首次引导（launch.js 在没配好时直接开它），其余入口一律开设置弹窗并跳到对应那一栏。
  const SET_SECTION = {
    asr: {el:'#s-asr', adv:false},           // 转写方式
    llm: {el:'#s-agent-provider', adv:false},// MyAgent 后台
    api: {el:'#s-key', adv:true},            // 自己填 API Key
    mic: {el:'#s-mic', adv:false},           // 收音设备
    ctx: {el:'#s-ctx', adv:true},            // 项目上下文
  };
  function jumpTo(section){
    const t = SET_SECTION[section]; if (!t) return;
    const adv = $('#adv'); if (t.adv && adv) adv.open = true;
    const el = $(t.el); if (!el) return;
    // 等弹窗自己排完版再滚，否则滚到的是旧位置
    requestAnimationFrame(() => {
      try { el.scrollIntoView({block:'center', behavior:'smooth'}); } catch(e) { el.scrollIntoView(); }
      const box = el.closest('.field') || el;
      box.classList.add('jump-hi'); setTimeout(() => box.classList.remove('jump-hi'), 1600);
      try { el.focus({preventScroll:true}); } catch(e) {}
    });
  }
  function openSettings(section){ loadServerSettings(); $('#s-provider').value = cfg.provider; $('#s-key').value = cfg.key; $('#s-base').value = cfg.base; $('#s-quick').value = cfg.quick; $('#s-model').value = cfg.model; $('#s-relay').value = cfg.relayToken||''; $('#s-hot').value = cfg.hotwords||''; fillMics(); $('#s-auto').value = cfg.autoEndMin||12; $('#f-base').hidden = cfg.provider!=='openai'; $('#s-msg').hidden = true; $('#s-ctx').value = ctx; ctxHint(); dlg.showModal(); if (section) jumpTo(section); }
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
  $('#gear').onclick = () => openSettings('asr');