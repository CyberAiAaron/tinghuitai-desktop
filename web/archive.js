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
if(window.opener||history.length<=1){$('#closewin').hidden=false;$('#closewin').onclick=()=>window.close();}

function fromLocal(){try{const st=JSON.parse(localStorage.getItem('tht-state')||'{}');return (st.sessions||[]).find(s=>String(s.id)===id)||null;}catch{return null;}}
async function fromMac(){const r=await fetch('/asr-relay/meeting-result?id='+encodeURIComponent(id)+'&token='+encodeURIComponent(settings.relayToken||''),{cache:'no-store',signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error(String(r.status));return r.json();}

function spkName(s,names){if(!s)return '';return (names&&names[s])||({me:'我',them:'对方'})[s]||('S'+s);}
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
  $('#src-chip').hidden=false;$('#src-chip').textContent=source==='mac'?'来源：Mac 归档'+(s.archiveNote?'（'+s.archiveNote+'）':''):'来源：本机记录（Mac 未同步）';
  $('#summary').textContent=s.summary||'总结尚未完成，逐字稿已保留。';
  const hl=(s.highlights||[]),td=(s.todos||[]),ck=(s.factchecks||[]),tr=(s.transcript||[]);
  $('#c-hl').textContent=hl.length;$('#c-td').textContent=td.length;$('#c-ck').textContent=ck.length;$('#c-tr').textContent=tr.length;
  const when=x=>x.at?'<span class="k">'+esc(clock({at:x.at},start))+'</span>':'';
  $('#highlights').innerHTML=hl.length?hl.map(x=>'<div class="card hl">'+when(x)+'<div>'+esc(x.text)+(x.how?'<div class="v">💡 '+esc(x.how)+'</div>':'')+'</div></div>').join(''):'<div class="empty">本场没有要点。</div>';
  $('#todos').innerHTML=td.length?td.map(x=>'<div class="card todo">'+when(x)+'<div>☐ '+esc(x.text)+(x.owner?'<div class="v">→ '+esc(x.owner)+'</div>':'')+'</div></div>').join(''):'<div class="empty">本场没有待办。</div>';
  const vl=v=>v==='true'?'大概率对':v==='false'?'可能有误':'拿不准';
  $('#factchecks').innerHTML=ck.length?ck.map(x=>'<div class="card ck">'+when(x)+'<div>'+esc(x.claim)+'<div class="v"><span class="verdict '+esc(x.verdict||'')+'">'+vl(x.verdict)+'</span> '+esc(x.note||'')+'</div></div></div>').join(''):'<div class="empty">本场没有待核查项。</div>';
  const names=s.names||{};
  $('#transcript').innerHTML=tr.length?tr.map(row=>{const sp=row.speaker||row.spk||row.who||'';return '<p><time>'+esc(clock(row,start))+'</time>'+(sp?'<span class="spk s'+esc(String(sp).replace(/\D/g,'')||'0')+'">'+esc(spkName(sp,names))+'</span>':'')+esc(row.text)+'</p>'+(row.originalText&&row.originalText!==row.text?'<span class="orig">原句：'+esc(row.originalText)+'</span>':'');}).join(''):'<div class="empty">没有转写内容。</div>';
}

(async()=>{
  if(!id){$('#title').textContent='缺少会议编号';return;}
  try{const s=await fromMac();source='mac';render(s);}
  catch(e){const s=fromLocal();if(s){source='local';render(s);}else{$('#title').textContent=e.message==='401'?'请回到 Meeting LiveMate，在设置里连接 Mac 后重试。':'这场会议在 Mac 和本机都没找到（Mac 在线吗？）';}}
})();

$('#download').onclick=()=>{if(!record)return;const s=record,start=ts(s.start);const names=s.names||{};
  const text='# '+(s.topicTitle||s.title||'会议')+'\n\n'+new Date(start).toLocaleString('zh-CN')+'\n\n## 智能总结\n'+(s.summary||'')+'\n\n## 要点\n'+(s.highlights||[]).map(x=>'- '+x.text).join('\n')+'\n\n## 待办\n'+(s.todos||[]).map(x=>'- [ ] '+x.text+(x.owner?' → '+x.owner:'')).join('\n')+'\n\n## 待核查\n'+(s.factchecks||[]).map(x=>'- '+x.claim+' ['+(x.verdict||'')+'] '+(x.note||'')).join('\n')+'\n\n## 逐字稿\n'+(s.transcript||[]).map(t=>{const sp=t.speaker||t.spk||t.who||'';return '['+clock(t,start)+'] '+(sp?spkName(sp,names)+'：':'')+t.text+(t.originalText&&t.originalText!==t.text?'\n原句：'+t.originalText:'');}).join('\n\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));a.download=(s.topicTitle||s.title||'会议记录').replace(/[\\/:*?"<>|]/g,'_')+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
