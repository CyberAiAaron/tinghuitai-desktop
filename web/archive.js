'use strict';
// 单场会议详情页：独立窗口，不碰 index.html 的会议状态。数据优先取 Mac 归档 /meeting-result；Mac 不在线或该场未同步时退回本机 localStorage（tht-state）。
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const id=new URLSearchParams(location.search).get('id')||'';
let settings={};try{settings=JSON.parse(localStorage.getItem('tht-settings')||'{}');}catch{}
const ts=v=>typeof v==='number'?v:(Date.parse(v)||0);
const fmtDur=sec=>{sec=Math.max(0,Math.round(sec));const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return (h?h+':':'')+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');};
const clock=(row,start)=>{if(row.t)return row.t;const at=Number(row.at||0);const rel=at>1e11?(at-start)/1000:at;const m=Math.floor(rel/60),s=Math.floor(rel%60);return m+':'+String(s).padStart(2,'0');};
let record=null,source='';
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
  $('#src-chip').hidden=false;$('#src-chip').textContent=source==='mac'?'来源：Mac 归档'+(s.archiveNote?'（'+s.archiveNote+'）':''):'来源：本机记录（Mac 未同步）';
  $('#summary').textContent=s.summary||'总结尚未完成，逐字稿已保留。';
  const hl=(s.highlights||[]),td=(s.todos||[]),ck=(s.factchecks||[]),tr=(s.transcript||[]);
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
