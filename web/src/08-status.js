  // ===== 状态 =====
  let state = {sessions:[], names:{}}; try { state = Object.assign({sessions:[], names:{}}, JSON.parse(localStorage.getItem('tht-state')||'null')||{}); } catch(e){}
  let cur = null, rec = null, running = false, interim = '', lastAnalyzedLen = 0, timer = null, wake = null, analyzing = false, lastFinal = '';
  let startedMode = '', stallWarned = false, stallTries = 0, fellBack = false, lastStallRetry=0;
  let imeMode = false, asrMode = false, viewMode = false;
  const persist = () => { if(cur)applyCorrections(cur);try { localStorage.setItem('tht-state', JSON.stringify(state)); } catch(e){ note('本机存储满了，请导出后清空旧场次。', true); } };
  function normalizeSession(s){const start=typeof s.start==='number'?s.start:Date.parse(s.start)||Date.now();return {...s,start,end:s.end?(typeof s.end==='number'?s.end:Date.parse(s.end)):null,transcript:(s.transcript||[]).map(x=>({...x,at:Number(x.at)>1e11?Number(x.at):start+Number(x.at||0)*1000,spk:x.spk||x.speaker||x.who||''})),todos:s.todos||[],highlights:s.highlights||[],factchecks:s.factchecks||[]};}
  const newSession = (mode, lang) => ({id: Date.now().toString(36)+Math.random().toString(36).slice(2,6), title:'', start: Date.now(), end: null, lang, mode, transcript: [], highlights: [], todos: [], factchecks: [], summary: '', uiLang:ui, names:{}, fixes:parseFixes(briefFix), transcriptEdits:[]});

  // Meeting assistant: local profile, per-session rules, guarded field patches.
  let assistantMemory=[];
  try{const m=JSON.parse(localStorage.getItem('livemate-memory')||'[]');if(Array.isArray(m))assistantMemory=m.filter(x=>typeof x==='string').slice(-20);}catch{}
  const assistantContext=(s=cur)=>[...assistantMemory,...(s?.assistantRules||[])].join('\n').slice(-10000);
  const effectiveBrief=(s=cur)=>[briefText,assistantContext(s)].filter(Boolean).join('\n');