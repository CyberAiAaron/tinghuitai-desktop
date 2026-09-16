  // ===== 说什么语言，尽量自己看出来，不让用户先选 =====
  // 做法：拿已经出来的转写文本判语种（中文看字符集；拉丁语系看高频虚词），判出来再告诉火山并重连。
  // 全程不调模型：零延迟、可解释、判错了用户能在设置里手动定住。
  let autoLang = '';           // 本场自动判出来的语种（''=还没判出来，先按中英混检跑）
  let autoTried = 0;
  const STOPWORDS = {
    es: ['que','de','la','el','los','las','por','para','con','una','como','pero','está','esto','porque','muy','hacer','tiene'],
    pt: ['que','não','de','para','com','uma','você','está','mas','isso','porque','muito','fazer','tem','então','também','são'],
    id: ['yang','dan','tidak','saya','itu','ini','untuk','dengan','bisa','ada','dari','akan','sudah','kalau','juga','kita','jadi'],
    en: ['the','and','is','to','of','that','this','for','with','you','are','have','but','not','can','what','they','would']
  };
  function detectTongue(text){
    const s = String(text||'');
    if (!s.trim()) return '';
    const han = (s.match(/[一-鿿]/g)||[]).length;
    if (han >= 8 && han / Math.max(1, s.replace(/\s/g,'').length) > 0.15) return 'zh';
    const words = (s.toLowerCase().match(/[a-zà-üñçãõáéíóúâêô]+/g)||[]);
    if (words.length < 25) return '';                       // 样本太少先别下结论
    const score = {};
    for (const k of Object.keys(STOPWORDS)) score[k] = words.filter(w => STOPWORDS[k].includes(w)).length;
    // 葡语/西语共享很多虚词，用各自独有的字符与词再拉开距离
    if (/[ãõ]|ção|não|você/.test(s.toLowerCase())) score.pt += 4;
    if (/¿|¡|ñ/.test(s)) score.es += 4;
    const best = Object.keys(score).sort((a,b)=>score[b]-score[a])[0];
    const second = Object.keys(score).sort((a,b)=>score[b]-score[a])[1];
    if (!best || score[best] < 3 || score[best] - score[second] < 2) return '';   // 分不开就不猜
    return best;
  }
  if (new URLSearchParams(location.search).has('lmtest')) window.__lm = { detectTongue };   // 只在带 ?lmtest 时暴露，供语种判断的正反例检查
  // 每来几句 final 就试一次，判出来（或改判）就切过去
  function maybeDetectTongue(){
    if (tongue() !== 'auto' || !cur) return;
    const rows = cur.transcript || [];
    if (rows.length < 4 || rows.length - autoTried < 3) return;
    autoTried = rows.length;
    const sample = rows.slice(-40).map(x => x.text).join(' ').slice(-4000);
    const got = detectTongue(sample);
    if (!got || got === autoLang) return;
    autoLang = got;
    const label = { zh:'中文', en:'English', id:'Bahasa Indonesia', pt:'Português do Brasil', es:'Español' }[got] || got;
    const late = ['id','pt','es'].includes(got);
    note((ui==='en' ? 'Detected language: ' : '听出来是「') + label + (ui==='en' ? '' : '」')
      + (late ? (ui==='en' ? ' — live captions are rough for this one; it will be re-transcribed after the meeting.' : '。会中字幕对它还听不准，会后会用本机模型重新转写一遍。')
              : (ui==='en' ? '' : '，已按它识别。设置里可以手动定住。')), late);
    setTimeout(()=>note(''), late ? 6000 : 4000);
    try { if (running && asrMode) asrReopen(); } catch(e){}
  }
  // 送给中转的语种：auto 用自动判出来的（还没判出来就空串＝中英混检），mix 恒定空串，其余原样传
  const relayLang = () => { const v = tongue(); if (v === 'auto') return autoLang || ''; return v === 'mix' ? '' : v; };
  const tongue = () => el.tongue.value;
  const srLang = () => tongue()==='en' ? 'en-US' : 'zh-CN';
  async function uploadPending(){
    if (!cfg.relayToken || !macOnline) return;
    for (const sess of state.sessions.filter(x => x.end && x.pendingUpload && (!x.uploadAfter||Date.now()>=x.uploadAfter))) {
      const revision=sess.archiveEditRevision||0;
      try { const r = await fetch(`${relayBase()}/session?token=${encodeURIComponent(cfg.relayToken)}`, {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(sess)}); if (r.ok && revision===(sess.archiveEditRevision||0)) { sess.pendingUpload = false;sess.archiveDirty=false; persist(); } } catch(e) {}
    }
  }
  // 观众：任何设备打开同一链接，都能实时看 Mac 上正在进行的场次
  function viewerConnect(){
    if (!cfg.relayToken || !macOnline || running || (viewWs && viewWs.readyState <= 1)) return;
    try { viewWs = new WebSocket(`${wsBase()}?token=${encodeURIComponent(cfg.relayToken)}&role=view`); } catch(e) { return; }
    viewWs.onopen = () => { viewWs.send(JSON.stringify({type:'view'})); };
    viewWs.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch(e) { return; }
      if (m.type === 'snapshot') { if (m.session) { viewLive = !m.session.end; if (!running) { const S = normalizeSession(m.session);
          ['highlights','todos','factchecks'].forEach(k => { (S[k]||[]).forEach((x,i) => { if (!x.at) x.at = (S.start||Date.now()) + i*1000; }); });
          (S.transcript||[]).forEach((x,i) => { if (!x.at) x.at = (S.start||Date.now()) + (x.t||i)*1000; });
          cur = Object.assign(newSession('view', 'view'), S, {viewOnly:true}); resetSigs(); stickBottom = true; render(); el.src.textContent = '🎙 ' + (m.session.source||'另一台设备') + ' 在采音'; updateStatusIdle(); } } else { viewLive = false; updateStatusIdle(); } }
      else if (!running && cur && cur.viewOnly) {
        if(m.type==='assistantAck'){assistantAck(m);return;}
      if(m.type==='snapshot'&&m.session?.id===cur.id){const restored=normalizeSession(m.session);for(const key of ['transcript','highlights','todos','factchecks','summary','names'])if(restored[key]!==undefined)cur[key]=restored[key];persist();resetSigs();render();}
      else if (m.type === 'partial') { interim = m.text||''; render(); }
        else if (m.type === 'final' && m.text) { cur.transcriptionInterrupted=false; interim=''; cur.transcript.push({at: m.at||Date.now(), t: m.t||0, text: m.text, spk: m.speaker||''}); render(); }
        else if (m.type === 'speaker_update' && cur.transcript[m.index]) {cur.transcript[m.index].spk=m.speaker;resetSigs();render();}
        else if (m.type === 'revise') applyRevise(m);
        else if (m.type === 'recomputed') applyRecomputed(m);
        else if (m.type === 'condensed') applyCondensed(m);
        else if (m.type === 'stale') markStale(m);
        else if (m.type === 'feedback') applyFeedback(m);
        else if (m.type === 'revise') applyRevise(m);
        else if (m.type === 'recomputed') applyRecomputed(m);
        else if (m.type === 'condensed') applyCondensed(m);
        else if (m.type === 'stale') markStale(m);

        else if (m.type === 'summary' && m.text) { cur.summary = m.text; render(); }
        else if (m.type === 'ended') { viewLive = false; cur.end = m.at||Date.now(); updateStatusIdle(); el.src.textContent = '已结束'; }
        else if (m.type === 'names' && m.names) { cur.names = m.names; render(); }
      } };
    viewWs.onclose = () => { viewWs = null; viewLive = false; if (!running) { updateStatusIdle(); setTimeout(()=>{ checkMac().then(viewerConnect); }, 15000); } };
  }

  // 会上明确改口时，服务端就地修订已有条目并广播 revise；界面要原位更新，不要重新插一条。
  function openArchivePanel(id){let ov=$('#archive-overlay');if(!ov){ov=document.createElement('div');ov.id='archive-overlay';ov.innerHTML='<div class="ap-bar"><b id="ap-title">会议详情</b><span style="flex:1"></span><button class="btn sm" id="ap-new" type="button">新窗口打开 ↗</button><button class="archive-close" id="ap-close" type="button" aria-label="关闭">×</button></div><iframe id="ap-frame" title="会议详情"></iframe>';document.body.append(ov);$('#ap-close').onclick=()=>{ov.hidden=true;$('#ap-frame').src='about:blank';};document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!ov.hidden)$('#ap-close').click();});}
    const url='archive.html?id='+encodeURIComponent(id)+'&embed=1';$('#ap-frame').src=url;$('#ap-new').onclick=()=>window.open('archive.html?id='+encodeURIComponent(id),'_blank','noopener');const sess=state.sessions.find(x=>x.id===id);$('#ap-title').textContent=sess?(sess.topicTitle||sess.title||'会议详情'):'会议详情';ov.hidden=false;closeSheets();}

  // 订正原文后服务端真重算完了：原位更新那几条，不再成立的直接从列表里去掉。
  // 收敛跑完了：把结果收进这一场，并让会后卡片当场出现——不要求刷新
  function applyCondensed(m){
    if(!cur || !m || !m.condensed) return;
    cur.condensed = m.condensed;
    persist();
    pullPostCards();
    note(ui==='en' ? 'Sorted. The card above has the note and the review.' : '整理好了，上面那张卡里能看纪要、也能过一遍。');
    setTimeout(()=>note(''), 8000);
  }
  function applyRecomputed(m){
    if(!cur)return;
    let n=0;
    const drop=new Set(Array.isArray(m.dropped)?m.dropped:[]);
    for(const key of ['highlights','todos','factchecks']){
      const list=cur[key]||[];
      for(const u of (Array.isArray(m.updated)?m.updated:[])){
        const row=list.find(x=>x&&x.id===u.id);
        if(!row)continue;
        if(row.text!==u.text) row.history=(row.history||[]).concat([{text:row.text,owner:row.owner||'',due:row.due||''}]).slice(-5);
        row.text=u.text; row.stale=false; row.staleReason=''; row.recomputed=true;
        if(typeof u.owner==='string'&&u.owner.trim()) row.owner=u.owner;
        if(typeof u.due==='string'&&u.due.trim()) row.due=u.due;
        n++;
      }
      if(drop.size){ const kept=list.filter(x=>!(x&&drop.has(x.id))); if(kept.length!==list.length){ n+=list.length-kept.length; cur[key]=kept; } }
    }
    if(n){ persist(); render(); }
  }

  function applyRevise(m){
    if(!cur||!Array.isArray(m.items))return;
    let n=0;
    for(const it of m.items){
      for(const list of [cur.highlights||[], cur.todos||[]]){
        const row=list.find(x=>x&&x.id===it.id);
        if(!row)continue;
        row.history=(row.history||[]).concat([{text:row.text,owner:row.owner||'',due:row.due||''}]).slice(-5);
        row.text=it.text; row.revised=true; row.revisedWhy=it.why||'';
        if(typeof it.owner==='string'&&it.owner.trim()) row.owner=it.owner;
        if(typeof it.due==='string'&&it.due.trim()) row.due=it.due;
        n++;
      }
    }
    if(n){ persist(); render(); }
  }
  // 用户改了原文，基于那段生成的结论先标出来，别让人以为还是准的。
  function markStale(m){
    if(!cur)return;
    let n=0;
    for(const list of [cur.highlights||[], cur.todos||[], cur.factchecks||[]]){
      for(const row of list){
        if(row && !row.stale && (row.sourceRefs||[]).some(r=>r&&r.segId===m.segId)){ row.stale=true; n++; }
      }
    }
    if(n){ persist(); render(); }
  }

  function applyFeedback(m){
    const at = Date.now(); let n = 0;
    const seenH = new Set([...cur.highlights.map(x=>x.text), ...cur.todos.map(x=>x.text)]);
    const seenC = new Set(cur.factchecks.map(x=>x.claim));
    (m.highlights||[]).forEach(x=>{ if (x&&x.text && !/与已有条目重复|无新增|already (?:recorded|covered)|no new information/i.test(x.text) && !seenH.has(x.text)) { seenH.add(x.text); cur.highlights.push({id:x.id, sourceRefs:x.sourceRefs, at:x.at||at, text:x.text}); n++; } });
    (m.todos||[]).forEach(x=>{ if (x&&x.text && !/与已有条目重复|无新增|already (?:recorded|covered)|no new information/i.test(x.text) && !seenH.has(x.text)) { seenH.add(x.text); cur.todos.push({id:x.id, sourceRefs:x.sourceRefs, at:x.at||at, text:x.text, owner:x.owner||'', how:x.how||''}); n++; } });
    (m.factchecks||[]).forEach(x=>{ if (x&&x.claim && !seenC.has(x.claim)) { seenC.add(x.claim); cur.factchecks.push({id:x.id, sourceRefs:x.sourceRefs, at:x.at||at, claim:x.claim, verdict:['true','false','unsure'].includes(x.verdict)?x.verdict:'unsure', note:x.note||''}); n++; } });
    if (n) { persist(); render(); buzz(); }
  }

  function sendNames(){ try { if (asrWs && asrWs.readyState===1 && cur) asrWs.send(JSON.stringify({type:'names', names: cur.names||{}})); } catch(e){} }
