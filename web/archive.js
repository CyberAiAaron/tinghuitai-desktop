'use strict';
// 单场会议详情页：独立窗口，不碰 index.html 的会议状态。数据优先取 Mac 归档 /meeting-result；Mac 不在线或该场未同步时退回本机 localStorage（tht-state）。
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const id=new URLSearchParams(location.search).get('id')||'';
let settings={};try{settings=JSON.parse(localStorage.getItem('tht-settings')||'{}');}catch{}
const ts=v=>typeof v==='number'?v:(Date.parse(v)||0);
const fmtDur=sec=>{sec=Math.max(0,Math.round(sec));const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return (h?h+':':'')+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');};
const clock=(row,start)=>{if(row.t)return row.t;const at=Number(row.at||0);const rel=at>1e11?(at-start)/1000:at;const m=Math.floor(rel/60),s=Math.floor(rel%60);return m+':'+String(s).padStart(2,'0');};
let record=null,source='',showRaw=false;
// 界面语言跟着主界面走：主界面存了就用存的，没存过按浏览器语言猜一次
let uiLang=(navigator.language||'').toLowerCase().startsWith('zh')?'zh':'en';
try{const v=localStorage.getItem('tht-ui');if(v)uiLang=(v==='en'?'en':'zh');}catch{}
if(window.opener||history.length<=1){$('#closewin').hidden=false;$('#closewin').onclick=()=>window.close();}

function fromLocal(){try{const st=JSON.parse(localStorage.getItem('tht-state')||'{}');return (st.sessions||[]).find(s=>String(s.id)===id)||null;}catch{return null;}}
async function fromMac(){const r=await fetch('/asr-relay/meeting-result?id='+encodeURIComponent(id)+'&token='+encodeURIComponent(settings.relayToken||''),{cache:'no-store',signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error(String(r.status));return r.json();}

function spkName(s,names){if(!s)return '';return (names&&names[s])||({me:'我',them:'对方'})[s]||('S'+s);}
let hasAudio=false;
// 点任何一个时间戳都跳到播放器的那一刻。录音不存在时整套回听不出现。
function seekTo(sec){const a=$('#player');if(!a)return;const t=Math.max(0,Number(sec)||0);
  const go=()=>{try{a.currentTime=t;a.play().catch(()=>{});}catch(e){}};
  if(a.readyState>=1)go();else{a.addEventListener('loadedmetadata',go,{once:true});a.load();}}
document.addEventListener('click',e=>{const b=e.target.closest('.play');if(!b)return;e.preventDefault();seekTo(b.dataset.sec);});
document.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const b=e.target.closest&&e.target.closest('time.play');if(!b)return;e.preventDefault();seekTo(b.dataset.sec);});

function render(s){
  record=s;
  const start=ts(s.start);const lastAt=(s.transcript&&s.transcript.length)?Number(s.transcript[s.transcript.length-1].at||0):0;
  const end=ts(s.end)||(lastAt>1e11?lastAt:(lastAt?start+lastAt*1000:0));
  const title=s.topicTitle||s.title||('会议 '+new Date(start).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}));
  document.title=title; $('#title').textContent=title;
  const parts=[];
  parts.push('<span><b>'+esc(new Date(start).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}))+'</b></span>');
  if(end)parts.push('<span>时长 <b>'+fmtDur((end-start)/1000)+'</b></span>');
  parts.push('<span><b>'+(s.transcript||[]).length+'</b> 句</span>');
  if(s.topicTitle&&s.title&&s.title!==s.topicTitle)parts.push('<span title="原始标题">'+esc(s.title.slice(0,40))+'</span>');
  const ppl=Array.isArray(s.participants)?s.participants.filter(Boolean):[];
  parts.push('<span>参会人 <b>'+(ppl.length?esc(ppl.join('、')):'未记录')+'</b></span>');
  if(s.speakerWarning)parts.push('<span>'+esc(s.speakerWarning)+'</span>');
  $('#meta').innerHTML=parts.join('');
  mountPlayer();
  renderCondenseBar(s);
  mountReviewButton(s);
  mountMemoryLink();
  mountNote(s);
  // 从会后卡片点「过一遍」过来的，直接开，不用再点一次按钮
  if(new URLSearchParams(location.search).get('review')==='1' && reviewReady(s) && !window.__rvAuto){
    window.__rvAuto=1; setTimeout(()=>startReview(s), 300);
  }
  $('#src-chip').hidden=false;$('#src-chip').textContent=source==='mac'?'来源：Mac 归档'+(s.archiveNote?'（'+s.archiveNote+'）':''):'来源：本机记录（Mac 未同步）';
  $('#summary').textContent=s.summary||'总结尚未完成，逐字稿已保留。';
  // 会后收敛：默认只显示收敛过的那十几条，原始的几百条折在「看全部」后面。
  // 会中每 40 秒一轮、只看眼前一小段，所以宁可多记；这里才是该做取舍的地方。
  const cond = s.condensed && !showRaw ? s.condensed : null;
  const hl=(cond? cond.highlights : (s.highlights||[])),
        td=(cond? cond.todos : (s.todos||[])),
        ck=(cond? cond.factchecks : (s.factchecks||[])),
        tr=(s.transcript||[]);
  $('#c-hl').textContent=hl.length;$('#c-td').textContent=td.length;$('#c-ck').textContent=ck.length;$('#c-tr').textContent=tr.length;
  // 时间戳做成可点的：点一下把播放器跳到那一刻。没有录音时退回成普通标签。
  const secOf=x=>{const at=Number(x.at||0);if(!at)return null;return at>1e11?(at-start)/1000:at;};
  const when=x=>{if(!x.at)return '';const t=esc(clock({at:x.at},start));const sec=secOf(x);
    return hasAudio&&sec!=null?'<button type="button" class="k play" data-sec="'+sec+'" title="'+(uiLang==='en'?'Replay from here':'回听这一段')+'">▶ '+t+'</button>':'<span class="k">'+t+'</span>';};
  $('#highlights').innerHTML=hl.length?hl.map(x=>'<div class="card hl">'+when(x)+'<div>'+esc(x.text)+(x.how?'<div class="v">💡 '+esc(x.how)+'</div>':'')+'</div></div>').join(''):'<div class="empty">本场没有要点。</div>';
  $('#todos').innerHTML=td.length?td.map(x=>'<div class="card todo">'+when(x)+'<div>☐ '+esc(x.text)+(x.owner?'<div class="v">→ '+esc(x.owner)+'</div>':'')+'</div></div>').join(''):'<div class="empty">本场没有待办。</div>';
  const vl=v=>v==='true'?'大概率对':v==='false'?'可能有误':'拿不准';
  $('#factchecks').innerHTML=ck.length?ck.map(x=>'<div class="card ck">'+when(x)+'<div>'+esc(x.claim)+'<div class="v"><span class="verdict '+esc(x.verdict||'')+'">'+vl(x.verdict)+'</span> '+esc(x.note||'')+'</div></div></div>').join(''):'<div class="empty">本场没有待核查项。</div>';
  const names=s.names||{};
  $('#transcript').innerHTML=tr.length?tr.map(row=>{const sp=row.speaker||row.spk||row.who||'';const rsec=(()=>{const at=Number(row.at||0);if(!at)return null;return at>1e11?(at-start)/1000:at;})();
    return '<p>'+(hasAudio&&rsec!=null?'<time class="play" role="button" tabindex="0" data-sec="'+rsec+'" title="'+(uiLang==='en'?'Replay this line':'回听这一句')+'">'+esc(clock(row,start))+'</time>':'<time>'+esc(clock(row,start))+'</time>')+(sp?'<span class="spk s'+esc(String(sp).replace(/\D/g,'')||'0')+'">'+esc(spkName(sp,names))+'</span>':'')+esc(row.text)+'</p>'+(row.originalText&&row.originalText!==row.text?'<span class="orig">原句：'+esc(row.originalText)+'</span>':'');}).join(''):'<div class="empty">没有转写内容。</div>';
}

// 录音在 Mac 上。先 HEAD 一下，有才挂播放器，避免页面上出现一个点不动的控件。
// 收敛条：说清楚现在看的是哪一版，一键切换。没收敛过就不出现。
function renderCondenseBar(s){
  let bar=document.getElementById('cond-bar');
  const mk=()=>{ let b=document.getElementById('cond-bar');
    if(!b){ b=document.createElement('div'); b.id='cond-bar'; b.className='cond-bar';
      document.getElementById('player-box').insertAdjacentElement('afterend', b); }
    return b; };
  // 这里只说明状态，不放按钮。整理这件事只有一个入口：历史会议里的「重新整理」。
  // 2026-09-12：这里原来也放了一个「按最新格式整理」，和外面那个按钮干同一件事，
  // 违反「一个动作只留一个入口」，已撤掉。
  if(!s.condensed){
    const n=(s.highlights||[]).length+(s.todos||[]).length+(s.factchecks||[]).length;
    if(n<20 || source!=='mac'){ if(bar) bar.hidden=true; return; }
    bar=mk(); bar.hidden=false;
    bar.innerHTML='<span>这场按老格式整理，共 '+n+' 条。回到「历史会议」点这一场的「重新整理」，可以按最新格式重整。</span>';
    return;
  }
  bar=mk(); bar.hidden=false;
  const src=s.condensed.source||{};
  const c=s.condensed;
  bar.innerHTML = showRaw
    ? '<span>正在看会中逐段抽出来的全部条目（要点 '+(src.highlights||0)+' · 待办 '+(src.todos||0)+' · 待核查 '+(src.factchecks||0)+'）</span><button type="button" id="cond-toggle">看收敛后的</button>'
    : '<span>会后已收敛：要点 '+(src.highlights||0)+'→'+c.highlights.length+' · 待办 '+(src.todos||0)+'→'+c.todos.length+' · 待核查 '+(src.factchecks||0)+'→'+c.factchecks.length+'</span><button type="button" id="cond-toggle">看全部原始条目</button>';
  document.getElementById('cond-toggle').onclick=()=>{ showRaw=!showRaw; render(record); };
}
// 这一场往长期记忆里留下了什么。点进去能看到那几条。
async function mountMemoryLink(){
  let el=document.getElementById('mem-link');
  try{
    const r=await fetch('/asr-relay/meeting-memory?id='+encodeURIComponent(id)+'&token='+encodeURIComponent(settings.relayToken||''),{cache:'no-store',signal:AbortSignal.timeout(6000)});
    const j=await r.json();
    if(!j.ok||!j.count){ if(el) el.hidden=true; return; }
    if(!el){ el=document.createElement('div'); el.id='mem-link'; el.className='cond-bar';
      (document.getElementById('cond-bar')||document.getElementById('player-box')).insertAdjacentElement('afterend', el); }
    el.hidden=false;
    const kinds={decision:'决定',promise:'承诺',question:'未决',term:'术语',name:'人名',rule:'习惯'};
    const by={}; for(const c of j.cards) by[c.kind]=(by[c.kind]||0)+1;
    const desc=Object.entries(by).map(([k,v])=>v+' 条'+(kinds[k]||k)).join('、');
    el.innerHTML='<span>这场留进长期记忆：'+desc+'，下一场相关时会被自动翻出来。</span>'
      +'<button type="button" id="mem-open">去会议记忆看</button>';
    document.getElementById('mem-open').onclick=()=>window.open('memory.html?meeting='+encodeURIComponent(id),'_blank','noopener');
  }catch(e){ if(el) el.hidden=true; }
}
function audioUrl(){return '/asr-relay/audio?id='+encodeURIComponent(id)+'&token='+encodeURIComponent(settings.relayToken||'');}
// 渲染之前先确认录音在不在：渲染时要靠 hasAudio 决定时间戳是不是可点的。
async function probeAudio(){
  hasAudio=false;
  if(source!=='mac')return;                       // 本机记录没有录音文件
  try{const r=await fetch(audioUrl(),{method:'HEAD',cache:'no-store',signal:AbortSignal.timeout(4000)});hasAudio=r.ok;}catch(e){hasAudio=false;}
}
function mountPlayer(){
  const host=$('#player-box'); if(!host)return;
  if(!hasAudio){host.hidden=true;host.innerHTML='';return;}
  host.hidden=false;
  host.innerHTML='<span class="ph">'+(uiLang==='en'?'Replay this meeting · click any timestamp to jump there':'回听本场录音 · 点任意时间戳跳到那一刻')+'</span><audio id="player" controls preload="metadata" src="'+audioUrl().replace(/"/g,'&quot;')+'"></audio>';
}

(async()=>{
  if(!id){$('#title').textContent='缺少会议编号';return;}
  try{const s=await fromMac();source='mac';await probeAudio();render(s);}
  catch(e){const s=fromLocal();if(s){source='local';hasAudio=false;render(s);}else{$('#title').textContent=e.message==='401'?'请回到 Meeting LiveMate，在设置里连接 Mac 后重试。':'这场会议在 Mac 和本机都没找到（Mac 在线吗？）';}}
})();

$('#download').onclick=()=>{if(!record)return;const s=record,start=ts(s.start);const names=s.names||{};
  const text='# '+(s.topicTitle||s.title||'会议')+'\n\n'+new Date(start).toLocaleString('zh-CN')+'\n\n## 智能总结\n'+(s.summary||'')+'\n\n## 要点\n'+(s.highlights||[]).map(x=>'- '+x.text).join('\n')+'\n\n## 待办\n'+(s.todos||[]).map(x=>'- [ ] '+x.text+(x.owner?' → '+x.owner:'')).join('\n')+'\n\n## 待核查\n'+(s.factchecks||[]).map(x=>'- '+x.claim+' ['+(x.verdict||'')+'] '+(x.note||'')).join('\n')+'\n\n## 逐字稿\n'+(s.transcript||[]).map(t=>{const sp=t.speaker||t.spk||t.who||'';return '['+clock(t,start)+'] '+(sp?spkName(sp,names)+'：':'')+t.text+(t.originalText&&t.originalText!==t.text?'\n原句：'+t.originalText:'');}).join('\n\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));a.download=(s.topicTitle||s.title||'会议记录').replace(/[\\/:*?"<>|]/g,'_')+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};

// ===== 过一遍：收敛后的十几条，一条一条判「留下 / 改一下 / 不要」 =====
// 只对收敛结果做，原始那几百条不进这个流程——那是翻不动的。
// 判断完两个去处：留下的进记忆卡（Claude 那边的投影随之更新），外加一份给人看的纪要。
let rvQueue=[], rvAt=0, rvDecisions=[], rvEditing=false;
const RV_KIND={highlights:'要点',todos:'待办',factchecks:'待核查'};

function reviewReady(s){
  const c=s && s.condensed;
  if(!c) return 0;
  return (c.highlights||[]).length+(c.todos||[]).length+(c.factchecks||[]).length;
}
function mountReviewButton(s){
  const b=document.getElementById('review-go'); if(!b) return;
  const n=reviewReady(s);
  if(!n || source!=='mac'){ b.hidden=true; return; }
  b.hidden=false;
  const done=s.review && s.review.decisions ? s.review.decisions.length : 0;
  // 「过一遍」没人看得懂。说清是什么动作、有多少条。
  b.textContent = done ? ('重新确认这 '+n+' 条') : ('确认这 '+n+' 条');
  b.onclick=()=>startReview(s);
}

// 纪要是这一页的正文，放最上面。以前它埋在「智能总结」里，而那是一大篇未收敛的长文。
async function mountNote(s){
  let box=document.getElementById('note-box');
  if(!box){ box=document.createElement('section'); box.id='note-box'; box.className='note-box';
    (document.getElementById('mem-link')||document.getElementById('cond-bar')||document.getElementById('player-box'))
      .insertAdjacentElement('afterend', box); }
  if(source!=='mac'){ box.hidden=true; return; }
  box.hidden=false; box.innerHTML='<p class="note-loading">纪要加载中…</p>';
  try{
    const r=await fetch('/asr-relay/share-note?id='+encodeURIComponent(id)+'&token='+encodeURIComponent(settings.relayToken||''),{cache:'no-store',signal:AbortSignal.timeout(15000)});
    const j=await r.json();
    if(!j.ok||!j.note){ box.hidden=true; return; }
    const lines=j.note.split('\n');
    const html=lines.map(l=>{
      if(l.startsWith('## ')) return '<h3>'+esc(l.slice(3))+'</h3>';
      if(l.startsWith('# ')) return '';
      if(l.startsWith('- ')) return '<li>'+esc(l.slice(2))+'</li>';
      return l.trim()? '<p class="note-meta">'+esc(l)+'</p>' : '';
    }).join('').replace(/(<li>.*?<\/li>)+/g, m=>'<ul>'+m+'</ul>');
    box.innerHTML='<div class="note-head"><b>纪要</b><span class="note-tag">'+(j.confirmed?'你确认过的版本':'自动整理版')+'</span>'
      +'<span style="flex:1"></span><button type="button" id="note-copy">复制</button></div>'
      +'<div class="note-body">'+html+'</div>';
    document.getElementById('note-copy').onclick=async()=>{
      try{ await navigator.clipboard.writeText(j.note); document.getElementById('note-copy').textContent='已复制'; }
      catch(e){ document.getElementById('note-copy').textContent='复制失败'; }
    };
  }catch(e){ box.hidden=true; }
}
function startReview(s){
  const c=s.condensed||{};
  rvQueue=[];
  for(const k of ['highlights','todos','factchecks'])
    (c[k]||[]).forEach((x,i)=>rvQueue.push({kind:k,index:i,item:x}));
  if(!rvQueue.length) return;
  rvAt=0; rvDecisions=[]; rvEditing=false;
  document.getElementById('rv-done').hidden=true;
  document.getElementById('rv-acts').hidden=false;
  document.getElementById('rv').hidden=false;
  paintReview();
}
function paintReview(){
  const cur=rvQueue[rvAt];
  if(!cur) return finishReview();
  document.getElementById('rv-step').textContent=(rvAt+1)+' / '+rvQueue.length;
  document.getElementById('rv-kind').textContent=RV_KIND[cur.kind]||cur.kind;
  const t=cur.item.text||cur.item.claim||'';
  document.getElementById('rv-text').textContent=t;
  const ed=document.getElementById('rv-edit');
  ed.hidden=!rvEditing;
  if(rvEditing){
    document.getElementById('rv-input').value=t;
    document.getElementById('rv-owner').value=cur.item.owner||'';
    document.getElementById('rv-due').value=cur.item.due||'';
    document.getElementById('rv-wrong').value=''; document.getElementById('rv-right').value='';
    setTimeout(()=>document.getElementById('rv-input').focus(),30);
  }
}
function rvNext(action){
  const cur=rvQueue[rvAt]; if(!cur) return;
  const d={kind:cur.kind,index:cur.index,action};
  if(action==='edit'){
    d.text=(document.getElementById('rv-input').value||'').trim();
    d.owner=(document.getElementById('rv-owner').value||'').trim();
    d.due=(document.getElementById('rv-due').value||'').trim();
    if(!d.text){ d.action='keep'; }
    const w=(document.getElementById('rv-wrong').value||'').trim(), r=(document.getElementById('rv-right').value||'').trim();
    if(w&&r) pushLexiconFromReview(w,r);      // 顺手纠的词也回流到热词
  }
  rvDecisions.push(d);
  rvEditing=false; rvAt++;
  paintReview();
}
async function pushLexiconFromReview(wrong,right){
  try{ await fetch('/asr-relay/lexicon?token='+encodeURIComponent(settings.relayToken||''),
    {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({wrong,right,meetingId:id}),signal:AbortSignal.timeout(8000)}); }
  catch(e){ console.debug('[review] 词没送上去', e&&e.message); }
}
async function finishReview(){
  const box=document.getElementById('rv-done');
  document.getElementById('rv-acts').hidden=true;
  document.getElementById('rv-edit').hidden=true;
  document.getElementById('rv-text').textContent='';
  document.getElementById('rv-kind').textContent='';
  box.hidden=false; box.textContent='正在保存…';
  try{
    const r=await fetch('/asr-relay/review?token='+encodeURIComponent(settings.relayToken||''),
      {method:'POST',headers:{'content-type':'application/json'},
       body:JSON.stringify({id,decisions:rvDecisions}),signal:AbortSignal.timeout(30000)});
    const j=await r.json();
    if(!j.ok){ box.textContent='没存上：'+(j.error||'未知原因'); return; }
    const kept=rvDecisions.filter(d=>d.action!=='drop').length, dropped=rvDecisions.length-kept;
    box.innerHTML='<p><b>过完了。</b>留下 '+kept+' 条，丢掉 '+dropped+' 条。</p>'
      +'<p>已写进会议记忆 '+j.written+' 条'+(j.projected?'，Claude 那边的只读副本也更新了：<br><code>'+esc(j.projected)+'</code>':'')+'</p>'
      +'<p style="margin-top:14px">下面这份是给人看的，可以直接转发：</p>'
      +'<pre id="rv-note">'+esc(j.note||'')+'</pre>'
      +'<div class="rv-row"><button type="button" id="rv-copy">复制这份纪要</button><button type="button" id="rv-close2">关闭</button></div>';
    document.getElementById('rv-copy').onclick=async()=>{
      try{ await navigator.clipboard.writeText(j.note||''); document.getElementById('rv-copy').textContent='已复制'; }
      catch(e){ document.getElementById('rv-copy').textContent='复制失败，手动选中'; }
    };
    document.getElementById('rv-close2').onclick=()=>{ document.getElementById('rv').hidden=true; location.reload(); };
  }catch(e){ box.textContent='没存上：'+(e.message||e); }
}
document.addEventListener('keydown',e=>{
  const rv=document.getElementById('rv');
  if(!rv||rv.hidden) return;
  if(e.key==='Escape'){ rv.hidden=true; return; }
  if(rvEditing){
    if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){ e.preventDefault(); rvNext('edit'); }
    return;
  }
  if(e.key==='ArrowRight'){ e.preventDefault(); rvNext('keep'); }
  else if(e.key==='ArrowLeft'){ e.preventDefault(); rvNext('drop'); }
  else if(e.key==='ArrowUp'){ e.preventDefault(); rvEditing=true; paintReview(); }
});
document.addEventListener('click',e=>{
  if(e.target.id==='rv-x'){ document.getElementById('rv').hidden=true; }
  else if(e.target.id==='rv-keep'){ rvNext('keep'); }
  else if(e.target.id==='rv-drop'){ rvNext('drop'); }
  else if(e.target.id==='rv-edit-go'){ if(rvEditing) rvNext('edit'); else { rvEditing=true; paintReview(); } }
});
