  // ===== 状态 =====
  let state = {sessions:[], names:{}}; try { state = Object.assign({sessions:[], names:{}}, JSON.parse(localStorage.getItem('tht-state')||'null')||{}); } catch(e){}
  let cur = null, rec = null, running = false, interim = '', lastAnalyzedLen = 0, timer = null, wake = null, analyzing = false, lastFinal = '';
  let startedMode = '', stallWarned = false, stallTries = 0, fellBack = false, lastStallRetry=0;
  let imeMode = false, asrMode = false, viewMode = false;
  // R12：以前每来一句 final 就把全部历史场次整份写进 localStorage。开久了必然超配额，
  // 而且是静默失败——界面照常显示，一刷新全没了。
  // 现在存盘只留「现在这场 + 最近 3 场 + 还没安全送到 Mac 的」；内存里的 state 一场不删，
  // 会议列表本来就是跟服务端的 /meeting-list 合出来的，旧场次在 Mac 上。
  const KEEP_RECENT = 3;
  const notSafeYet = s => !!(s && (s.pendingUpload || s.archiveDirty || s.archiveAwaitingSince));
  const storedState = () => {
    const all = Array.isArray(state.sessions) ? state.sessions : [];
    const keep = new Set([...all].sort((a,b)=>(b.start||0)-(a.start||0)).slice(0, KEEP_RECENT));
    for (const s of all) if (notSafeYet(s) || (cur && s.id === cur.id) || (state.live && s.id === state.live)) keep.add(s);
    return {...state, sessions: all.filter(s => keep.has(s))};
  };
  const persist = () => { if(cur)applyCorrections(cur);
    const small = storedState();
    try { localStorage.setItem('tht-state', JSON.stringify(small)); }
    catch(e){
      // 还是写不下（单场特别长的时候会）：退到只留当前这场和还没送走的，那两类丢了才是真丢
      try { localStorage.setItem('tht-state', JSON.stringify({...small, sessions: small.sessions.filter(s => notSafeYet(s) || (cur && s.id === cur.id))})); }
      catch(e2){ note('本机存储满了，请导出后清空旧场次。', true); }
    } };
  function normalizeSession(s){const start=typeof s.start==='number'?s.start:Date.parse(s.start)||Date.now();return {...s,start,end:s.end?(typeof s.end==='number'?s.end:Date.parse(s.end)):null,transcript:(s.transcript||[]).map(x=>({...x,at:Number(x.at)>1e11?Number(x.at):start+Number(x.at||0)*1000,spk:x.spk||x.speaker||x.who||''})),todos:s.todos||[],highlights:s.highlights||[],factchecks:s.factchecks||[]};}
  const newSession = (mode, lang) => ({id: Date.now().toString(36)+Math.random().toString(36).slice(2,6), title:'', start: Date.now(), end: null, lang, mode, transcript: [], highlights: [], todos: [], factchecks: [], summary: '', uiLang:ui, names:{}, fixes:parseFixes(briefFix), transcriptEdits:[]});

  // Meeting assistant: local profile, per-session rules, guarded field patches.
  // L-18：「以后也记住」以前只写进这个浏览器的 localStorage，底栏「它记住的」是服务端记忆，两套东西。
  // 现在真源是服务端的 kind='rule' 记忆卡，localStorage 只当离线缓存（服务连不上时还能用上一次的规矩）。
  // 第一次联上服务端时，把本机遗留的几条一次性搬上去，搬完不再回头读它。
  let assistantMemory=[];
  const assistantMemoryIds=new Map();              // 规矩原文 → 服务端卡片 id，移除时要用
  try{const m=JSON.parse(localStorage.getItem('livemate-memory')||'[]');if(Array.isArray(m))assistantMemory=m.filter(x=>typeof x==='string').slice(-200);}catch{}
  const memCache=()=>{try{localStorage.setItem('livemate-memory',JSON.stringify(assistantMemory));}catch(e){}};
  async function memPost(body){
    const r=await fetch('/memory',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw Error(j.error||('HTTP '+r.status));
    return j;
  }
  async function rememberRule(text){
    const t=String(text||'').trim(); if(!t)return;
    const j=await memPost({action:'remember',text:t,meetingId:(cur&&cur.id)||'',meetingTitle:(cur&&cur.title)||''});
    if(j.id)assistantMemoryIds.set(t,j.id);
    assistantMemory=[...new Set([...assistantMemory,t])].slice(-200); memCache();
  }
  async function forgetRule(text){
    const t=String(text||'').trim(), id=assistantMemoryIds.get(t);
    if(id)await memPost({action:'drop',id});        // 没有 id 说明这条还没同步上去，只清本机
    assistantMemoryIds.delete(t);
    assistantMemory=assistantMemory.filter(x=>x!==t); memCache();
  }
  async function loadRules(){
    try{
      const r=await fetch('/memory',{cache:'no-store'}); const j=await r.json();
      if(!j||!j.ok||!Array.isArray(j.cards))return;
      const rules=j.cards.filter(c=>c.kind==='rule'&&c.state==='active');
      const server=rules.map(c=>c.text);
      for(const c of rules)assistantMemoryIds.set(c.text,c.id);
      const onlyLocal=assistantMemory.filter(t=>!server.includes(t));
      // 先把本机遗留的搬上去，搬成功的才算进服务端那份；搬失败的留在本机，下次再搬。
      // 原来是先 memCache() 覆盖本机缓存再上传，上传失败被吞掉 → 这条规矩两边都没有了。
      const stuck=[];
      for(const t of onlyLocal){try{await rememberRule(t);}catch(e){stuck.push(t);}}
      const next=[...new Set([...server,...stuck])];   // 服务端给多少条就留多少条（上限在服务端），原来截成 20 条会让第 21 条起的规矩静默失效
      // 服务端一条规矩都没有、本机却有，多半是接口被截断或库被清了，宁可留着本机这份也不清空。
      if(next.length||!assistantMemory.length){assistantMemory=next;memCache();}
      try{assistantRulesUI();}catch(e){}
    }catch(e){}                                      // 服务连不上就继续用缓存里的
  }
  loadRules();
  const assistantContext=(s=cur)=>[...assistantMemory,...(s?.assistantRules||[])].join('\n').slice(-10000);
  const effectiveBrief=(s=cur)=>[briefText,assistantContext(s)].filter(Boolean).join('\n');