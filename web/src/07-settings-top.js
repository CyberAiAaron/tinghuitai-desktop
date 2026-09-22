  // ===== 设置页顶部两块：转写方式、写纪要的模型 =====
  // 以前这两样在 setup.html 里，和 ⚙︎ 是两套；现在设置页是唯一去处，setup.html 只在首次引导时出现。
  const ASR_DESC = {
    mac: '离线，不用注册，什么都不用填。慢几秒，分不出谁在说话。',
    volc: '中文最准，能区分说话人。要注册火山引擎账号。',
    deepgram: '邮箱就能注册，不要中国手机号，英文很准。',
  };
  async function loadServerSettings(){
    try {
      const r = await fetch('/setup', {cache:'no-store', headers:{'x-tht-token':cfg.relayToken||''}});
      if (!r.ok) return;
      const c = await r.json();
      boot = Object.assign({}, boot, c);
      const sel = $('#s-asr');
      if (sel) { sel.value = c.asrProvider || (c.macAsrAvailable ? 'mac' : 'volc'); paintAsrHint(); }
      const now = $('#s-llm-now');
      if (now) now.textContent = c.modelConfigured
        ? '现在用：MyAgent'
        // L-11：界面上会出现四个 AI 名字。Codex / Claude / DeepSeek 是 MyAgent 背后用哪个模型，
        // 不是另外三个助手——这里说清楚，比把它们改名更有用（改名会让人对不上后台实际配置）。
        : 'MyAgent 还没接。会后纪要需要它。Codex、Claude、DeepSeek 是 MyAgent 背后用哪个模型，不是另外的助手。';
      const agentProvider = $('#s-agent-provider');
      if (agentProvider) agentProvider.value = ['codex','claude','deepseek'].includes(c.provider) ? c.provider : 'deepseek';
      const f = $('#f-asr'); if (f) f.hidden = false;
    } catch(e) {}
  }
  function paintAsrHint(){
    const v = $('#s-asr') && $('#s-asr').value;
    const h = $('#s-asr-hint'); if (!h) return;
    h.textContent = ASR_DESC[v] || '';
    if (v === 'mac' && boot && boot.macAsrAvailable === false) h.textContent = '这台机器用不了本机转写，换一个。';
  }
  $('#s-asr') && ($('#s-asr').onchange = async () => {
    paintAsrHint();
    const v = $('#s-asr').value;
    try {
      const r = await fetch('/setup', {method:'POST', headers:{'content-type':'application/json','x-tht-token':cfg.relayToken||''}, body: JSON.stringify({ASR_PROVIDER:v})});
      if (!r.ok) throw new Error(String(r.status));
      boot.asrProvider = v; boot.asrConfigured = true; updateReadyBar();
      note('转写方式已改成：' + ($('#s-asr').selectedOptions[0]||{}).textContent); setTimeout(()=>note(''),3000);
    } catch(e) { note('没改成，去设置页看看：' + (e.message||e), true); }
  });
  $('#s-detect-cli') && ($('#s-detect-cli').onclick = async (e) => {
    const b = e.target; b.disabled = true; const old = b.textContent; b.textContent = '检测中…';
    try {
      for (const kind of ['codex','claude']) {
        const r = await fetch('/setup/detect', {method:'POST', headers:{'content-type':'application/json','x-tht-token':cfg.relayToken||''}, body: JSON.stringify({kind})});
        const j = await r.json();
        if (j.ok) { note(j.message); setTimeout(()=>note(''),5000); await loadServerSettings(); updateReadyBar(); return; }
      }
      note('这台电脑上没找到可用的 MyAgent 后台。可以改用 DeepSeek API。', true); setTimeout(()=>note(''),5000);
    } catch(err) { note('检测失败：'+(err.message||err), true); }
    finally { b.disabled = false; b.textContent = old; }
  });
  $('#s-agent-provider') && ($('#s-agent-provider').onchange = async (e) => {
    const wanted=e.target.value,previous=boot.provider||'';e.target.disabled=true;
    try{
      const r=await fetch('/setup/agent',{method:'POST',headers:{'content-type':'application/json','x-tht-token':cfg.relayToken||''},body:JSON.stringify({kind:wanted})});
      const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'切换失败');
      boot.provider=wanted;await loadServerSettings();updateReadyBar();note('MyAgent 后台已切换。');setTimeout(()=>note(''),3000);
    }catch(err){e.target.value=previous||'deepseek';note('MyAgent 没切换：'+(err.message||err),true);}
    finally{e.target.disabled=false;}
  });
  $('#s-open-setup') && ($('#s-open-setup').onclick = () => jumpTo('api'));
  $('#s-jump-api') && ($('#s-jump-api').onclick = () => jumpTo('api'));

  $('#s-provider').onchange = e => { const pr = PRESET[e.target.value]; $('#f-base').hidden = e.target.value!=='openai'; $('#s-base').value = pr.base; $('#s-quick').value = pr.quick; $('#s-model').value = pr.model; };
  $('#s-cancel').onclick = () => dlg.close();
  const readForm = () => ({provider:$('#s-provider').value, key:$('#s-key').value.trim(), base:$('#s-base').value.trim(), quick:$('#s-quick').value.trim()||DEF.quick, model:$('#s-model').value.trim()||DEF.model, relayToken:$('#s-relay').value.trim(), micId:$('#s-mic').value, micLabel:(($('#s-mic').selectedOptions[0]||{}).textContent||''), hotwords:$('#s-hot').value.trim(), autoEndMin: Math.max(3, parseInt($('#s-auto').value,10)||12)});
  async function saveModelDraft(form){
    if(!form.key)return;
    const r=await fetch('/setup',{method:'POST',headers:{'content-type':'application/json','x-tht-token':cfg.relayToken||''},body:JSON.stringify({DEEPSEEK_API_KEY:form.key,LLM_BASE_URL:form.base,LLM_MODEL:form.model})});
    const result=await r.json();if(!r.ok)throw Error(result.error||'模型设置未保存');
    $('#s-key').value='';
  }
  $('#s-save').onclick = async () => {
    const b=$('#s-save');if(b.disabled)return;b.disabled=true;
    try{const form=readForm();await saveModelDraft(form);
      cfg={...form,key:'',relayToken:window.THT_BOOT?.relayToken||cfg.relayToken||''};
      localStorage.setItem('tht-settings',JSON.stringify(cfg));ctx=$('#s-ctx').value.trim();localStorage.setItem('tht-ctx',ctx);
      await loadServerSettings();dlg.close();checkMac().then(()=>{viewerConnect();updateStatusIdle();});note('设置已保存。');
    }catch(e){note('保存未完成：'+e.message,true);}finally{b.disabled=false;}
  };
  $('#s-test').onclick = async () => {
    const m=$('#s-msg');m.hidden=false;m.textContent='测试中…';
    try{if(!await checkMac())throw Error('录音服务未连接，请重新打开听会台');
      await saveModelDraft(readForm());
      const r=await fetch('/setup/test',{method:'POST',headers:{'content-type':'application/json','x-tht-token':cfg.relayToken||''},body:'{}'});
      const result=await r.json();m.textContent=result.message||result.error||(r.ok?'模型已连通':'模型测试失败');
    }catch(e){m.textContent='测试未完成：'+e.message;}
  };

  async function llm(prompt, tier){
    if(!macOnline)throw Error('本机服务未连接，请重新启动听会台');
    return (await hubAPI(tier==='summary'?'summarize':'llm',tier==='summary'?{text:prompt,language:ui}:{prompt,tier})).text;
  }

  const parseJSON = t => JSON.parse(String(t).trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
