  // ===== 就绪状态：不拦人，只让人随时看得见「现在用什么转写、纪要能不能出」 =====
  // 判据只看两件事：有没有一条转写路子、有没有一个写纪要的模型。
  // 两样都齐就整条不显示，已经配好的人界面和以前一模一样。
  let boot = window.THT_BOOT || {};
  let rbNoteHidden = false;
  try { rbNoteHidden = localStorage.getItem('tht-rb-note') === 'off'; } catch(e){}
  const ASR_LABEL = { mac:['本机转写','On-device'], volc:['火山语音','Volcano'], deepgram:['Deepgram','Deepgram'] };
  function updateReadyBar(){
    const bar = $('#ready-bar'); if (!bar) return;
    const en = ui === 'en';
    const asrOk = !!boot.asrConfigured, llmOk = !!boot.modelConfigured;
    const canListen = asrOk || !!boot.macAsrAvailable;
    if (asrOk && llmOk) { bar.hidden = true; return; }     // 都配好了：这条不存在
    bar.hidden = false;
    const a = $('#rb-asr'), l = $('#rb-llm'), note = $('#rb-note');
    const asrName = asrOk ? (ASR_LABEL[boot.asrProvider] ? ASR_LABEL[boot.asrProvider][en?1:0] : (en?'Configured':'已配置'))
      : (boot.macAsrAvailable ? (en?'On-device (offline)':'本机转写（离线）') : (en?'Not ready':'未就绪'));
    a.textContent = (en?'Transcription: ':'转写：') + asrName;
    a.classList.toggle('warn', !canListen);
    const llmName = llmOk ? 'MyAgent'
      : (en?'not connected':'未接');
    l.textContent = (en?'Notes: ':'纪要：') + llmName;
    l.classList.toggle('warn', !llmOk);
    note.hidden = rbNoteHidden;
    note.textContent = !canListen
      ? (en?'This Mac cannot transcribe on-device. Connect a transcription service to start.':'这台机器用不了本机转写，接一个转写服务就能开始。')
      : (llmOk ? (en?'Ready to go.':'可以直接开会了。')
               : (en?'You can start right now; notes need a model, which you can connect after the meeting.':'现在就能开会，纪要要接个模型，会后再接也行。'));
  }
  $('#rb-hide') && ($('#rb-hide').onclick = () => { rbNoteHidden = true; try { localStorage.setItem('tht-rb-note','off'); } catch(e){} updateReadyBar(); });
  $('#rb-asr') && ($('#rb-asr').onclick = () => window.open('setup.html','_blank','noopener'));
  $('#rb-llm') && ($('#rb-llm').onclick = () => window.open('setup.html','_blank','noopener'));
  // 设置页在另一个窗口改完，回到这里要能自己刷新状态
  async function refreshBoot(){
    try { const r = await fetch('/setup', {cache:'no-store'}); if (r.ok) { boot = Object.assign({}, boot, await r.json()); } } catch(e){}
    updateReadyBar();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshBoot(); });

  function assistantIdentity(config,online){
    return 'MyAgent';
  }
  let serverModelIdentity='MyAgent';
  fetch('/setup').then(r=>r.ok?r.json():null).then(c=>{if(c){serverModelIdentity=assistantIdentity({key:'server-held',model:c.model||'',provider:c.provider||''},true);updateAssistantIdentity();}}).catch(()=>{});
  function updateAssistantIdentity(){const name=serverModelIdentity;$('#b-assistant').textContent=name;$('#assistant-name').textContent=name;$('#assistant-panel').setAttribute('aria-label',name);}
  const assistantPending=new Map();let assistantBusy=false,assistantUndo=null,assistantLastRule='',assistantTrigger=null;
  const A=window.LiveMateCore;
  const assistantSay=(text)=>{const p=document.createElement('p');p.textContent=text;$('#assistant-log').append(p);p.scrollIntoView({block:'nearest'});};
  function assistantInvalidate(s){s.i18n={};s.assistantRevision=(s.assistantRevision||0)+1;s.brief=effectiveBrief(s);persist();resetSigs();render();scheduleTranslation();}
  function assistantRulesUI(){const box=$('#assistant-rules');box.replaceChildren();for(const [scope,rules] of [['session',cur?.assistantRules||[]],['memory',assistantMemory]])rules.forEach((rule,i)=>{const p=document.createElement('p'),t=document.createElement('span'),b=document.createElement('button');t.textContent=(scope==='memory'?'个人记忆：':'本场：')+rule;b.textContent='移除';b.className='btn sm';b.type='button';b.onclick=async()=>{if(assistantBusy)return;const s=cur;if(scope==='session'&&(!running||viewMode||!s)){assistantSay('本场已结束；历史会议保持只读。');return;}assistantBusy=true;try{const next=(s?.assistantRules||[]).slice(),mem=assistantMemory.slice();(scope==='memory'?mem:next).splice(i,1);if(running&&s)await assistantRemote(s,[],[briefText,...mem,...next].filter(Boolean).join('\n'));if(scope==='memory'){localStorage.setItem('livemate-memory',JSON.stringify(mem));assistantMemory=mem;}else s.assistantRules=next;if(s)assistantInvalidate(s);assistantRulesUI();assistantSay('规则已移除，后续处理将使用新背景。已有内容保留，需要回退修改请点“撤销上次修改”。');}catch(e){assistantSay(e.message);}finally{assistantBusy=false;}};p.append(t,b);box.append(p);});}
  async function assistantRemote(s,patches,brief){
    if(!running||viewMode||!asrMode||cur!==s||asrWs?.readyState!==1)throw Error('本场没有连接到录音服务；这次未修改。');
    const r=await fetch(relayBase()+'/health?token='+encodeURIComponent(cfg.relayToken||''));const health=await r.json();
    if(health.assistantVersion!==1)throw Error('助手问答已可用；纠错需要会后加载新版后台，本次未修改。');
    if(!running||cur!==s||asrWs?.readyState!==1)throw Error('会议状态已改变，本次未修改。');
    const requestId=crypto.randomUUID();return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{assistantPending.delete(requestId);reject(Error('未收到保存确认，结果暂不确定；请勿重复提交，重新连接后核对。'));},8000);assistantPending.set(requestId,{resolve,reject,timeout,session:s});asrWs.send(JSON.stringify({type:'assistantPatch',requestId,patches,brief}));});
  }
  function assistantAck(m){const p=assistantPending.get(m.requestId);if(!p)return;clearTimeout(p.timeout);assistantPending.delete(m.requestId);if(m.error)p.reject(Error(m.error));else p.resolve(m);}
  $('#b-assistant').onclick=()=>{updateAssistantIdentity();assistantTrigger=document.activeElement;$('#assistant-panel').hidden=false;$('#b-assistant').setAttribute('aria-expanded','true');assistantRulesUI();$('#assistant-input').focus();};
  function assistantClose(){$('#assistant-panel').hidden=true;$('#b-assistant').setAttribute('aria-expanded','false');assistantTrigger?.focus();}
  $('#assistant-close').onclick=assistantClose;
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#assistant-panel').hidden){e.preventDefault();assistantClose();}});
  $('#assistant-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#assistant-form').requestSubmit();}});
  $('#assistant-form').onsubmit=async e=>{e.preventDefault();if(assistantBusy)return;const message=$('#assistant-input').value.trim(),s=cur;if(!message)return;if(!s){assistantSay('先开始一场会议，或打开历史会议。');return;}assistantBusy=true;$('#assistant-send').disabled=true;$('#assistant-input').value='';assistantSay('你：'+message);assistantSay('正在看本场内容…');
    try{
      const snap=A.snapshot(s);const raw=await llm(A.prompt(message,snap,effectiveBrief(s),ui==='en'),'full');const result=parseJSON(raw);
      if(cur!==s){assistantSay('已切换会议，结果未应用。');return;}
      if(typeof result.reply!=='string')throw Error('助手返回格式不完整，本次未修改。');assistantSay(result.reply.slice(0,5000));
      for(const a of (Array.isArray(result.actions)?result.actions.slice(0,4):[])) if(a&&typeof a.title==='string'&&['lark_doc','slack_self','lark_task','handoff','other'].includes(a.kind)) draftAction(a);
      if(!running||viewMode||!asrMode){assistantSay('历史会议和旁观模式仅支持问答，本次未修改内容。');return;}
      const proposed=Array.isArray(result.patches)?result.patches.slice(0,80):[];const patches=proposed.filter(p=>A.eligible(s,p,snap));
      const rule=typeof result.contextRule==='string'?result.contextRule.trim().slice(0,1200):'';if(!patches.length&&!rule){if(proposed.length)assistantSay('内容已有变化，未套用过时修改。');return;}
      const oldRules=(s.assistantRules||[]).slice(),newRules=rule?[...oldRules,rule].slice(-20):oldRules;
      const ack=await assistantRemote(s,patches,[briefText,...assistantMemory,...newRules].filter(Boolean).join('\n'));
      if(cur!==s){assistantSay('保存结果属于上一场会议，未改写当前页面。');return;}
      const accepted=patches.filter((p,i)=>ack.applied.includes(i)&&A.eligible(s,p,snap));const local=A.apply(s,accepted);s.assistantRules=newRules;assistantUndo={session:s,patches:accepted.filter((_,i)=>local.applied.includes(i)),oldRules,newRules};assistantLastRule=rule;const detail=document.createElement('details'),heading=document.createElement('summary'),body=document.createElement('pre');heading.textContent='查看本次修改与原文';body.style='white-space:pre-wrap;font:inherit';body.textContent=accepted.map(p=>p.before+' → '+p.after).join('\n\n');detail.append(heading,body);if(accepted.length)$('#assistant-log').append(detail);assistantInvalidate(s);assistantRulesUI();$('#assistant-undo').disabled=false;$('#assistant-remember').hidden=!rule;
      assistantSay(`已修改 ${local.applied.length} 处，跳过 ${proposed.length-local.applied.length} 处。${rule?'本场规则已生效：'+rule:''}${ack.saved?' 已保存到录音服务。':' 服务存储异常，请保留本页面并导出备份。'}`);
    }catch(e){assistantSay('未完成：'+e.message);}finally{assistantBusy=false;$('#assistant-send').disabled=false;}
  };
  $('#assistant-undo').onclick=async()=>{if(assistantBusy||!assistantUndo)return;const u=assistantUndo,s=u.session;if(cur!==s||!running){assistantSay('只能撤销当前正在录音的会议修改。');return;}assistantBusy=true;try{const patches=A.reverse(u.patches);const rules=JSON.stringify(s.assistantRules)===JSON.stringify(u.newRules)?u.oldRules:s.assistantRules;const ack=await assistantRemote(s,patches,[briefText,...assistantMemory,...rules].filter(Boolean).join('\n'));const result=A.apply(s,patches.filter((_,i)=>ack.applied.includes(i)));s.assistantRules=rules;assistantInvalidate(s);assistantRulesUI();assistantSay(`已撤销 ${result.applied.length} 处；${patches.length-result.applied.length} 处因后续修改而保留。${ack.saved?'已保存。':'服务存储异常，请保留页面。'}`);assistantUndo=null;assistantLastRule='';$('#assistant-remember').hidden=true;$('#assistant-undo').disabled=true;}catch(e){assistantSay(e.message);}finally{assistantBusy=false;}};
  $('#assistant-remember').onclick=()=>{if(assistantBusy||!assistantLastRule)return;try{const next=[...new Set([...assistantMemory,assistantLastRule])].slice(-20);localStorage.setItem('livemate-memory',JSON.stringify(next));assistantMemory=next;assistantRulesUI();assistantSay('已记入这个浏览器的个人记忆，下次会议也会使用。可在下方移除。');$('#assistant-remember').hidden=true;}catch{assistantSay('本机存储不可用，未保存长期记忆。');}};
  // This indicator measures incoming PCM only, never claims that ASR/storage succeeded.
  let meterLast=0,meterPaint=0,meterRms=0;
  function updateAudioMeter(samples){meterLast=Date.now();meterRms=A?A.level(samples):0;if(meterLast-meterPaint<90)return;meterPaint=meterLast;paintAudioMeter();}
  function paintAudioMeter(){updateAssistantIdentity();const box=$('#audio-meter'),label=$('#audio-meter-label'),fresh=Date.now()-meterLast<1200;const active=running&&asrMode&&fresh;const loud=active&&meterRms>.006;label.textContent=ui==='en'?(active?(loud?'Sound received':'Listening · quiet'):(running&&asrMode?'Waiting for audio':'Not listening')):(active?(loud?'收到声音':'正在收音 · 暂时安静'):(running&&asrMode?'等待音频输入':'未收音'));box.dataset.active=loud?'true':'false';const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;box.querySelectorAll('b').forEach((b,i)=>b.style.height=(active?3+Math.min(1,meterRms*16)*(reduced?10:8+12*Math.sin((i+1)*.65)**2):3)+'px');}
  setInterval(paintAudioMeter,350);
