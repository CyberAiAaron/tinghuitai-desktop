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
  if(ppl.length)parts.push('<span>参会人 <b>'+esc(ppl.join('、'))+'</b></span>');
  if(s.speakerWarning)parts.push('<span>'+esc(s.speakerWarning)+'</span>');
  $('#meta').innerHTML=parts.join('');
  mountPlayer();
  mountMemoryLink();
  mountHead(s);
  $('#src-chip').hidden=false;$('#src-chip').textContent=source==='mac'?'来源：Mac 归档'+(s.archiveNote?'（'+s.archiveNote+'）':''):'来源：本机记录（Mac 未同步）';
  renderBrief(s);
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

// ---- 回看页新版（REQ-004）：页面只渲染结构化数据，不出现 Markdown 原始标记 ----
const COLORS=['#202124','#c8102e','#1f5fbf','#1e7e34','#b26a00','#6a3fb5','#00838f','#8d6e63'];
const mmss=sec=>{sec=Math.max(0,Math.round(sec||0));const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),x=sec%60;return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0');};
function spkMap(s){const m={...(s.names||{})};const b=s.brief||{};(b.questions||[]).forEach(q=>{const a=(b.answers||{})[q.id];if(!a)return;const v=(a.text||'').trim()||q.options[a.choice];(q.affects||[]).forEach(f=>{const k=/^speaker:(.+)$/.exec(f);if(k&&v)m[k[1].replace(/^S/i,'')]=v;});});return m;}
function nm(text,map){let t=esc(text);Object.keys(map).forEach(k=>{if(!map[k]||!/^\w{1,12}$/.test(k))return;t=t.replace(new RegExp('(?:说话人\\s*|Speaker\\s*|S)'+k+'(?!\\d)','g'),()=>esc(map[k]));});return t;}
const tbtn=sec=>sec?'<button type="button" class="bf-t" data-sec="'+Number(sec)+'">'+mmss(sec)+'</button>':'';
function mdLite(src){ // 旧会议只有 Markdown 长文时的兜底渲染
  const out=[];let ul=false,tb=false;const inl=t=>esc(t).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/`([^`]+)`/g,'$1').replace(/\*([^*]+)\*/g,'$1');
  const close=()=>{if(ul){out.push('</ul>');ul=false;}if(tb){out.push('</table>');tb=false;}};
  String(src||'').split('\n').forEach(l=>{const x=l.trim();
    if(!x||/^-{3,}$/.test(x)){close();return;}
    let m;
    if((m=/^(#{1,6})\s+(.*)$/.exec(x))){close();out.push('<h3>'+inl(m[2])+'</h3>');return;}
    if(/^\|/.test(x)){if(/^\|[\s:|-]+\|?$/.test(x))return;if(ul){out.push('</ul>');ul=false;}if(!tb){out.push('<table>');tb=true;}out.push('<tr>'+x.replace(/^\||\|$/g,'').split('|').map(c=>'<td>'+inl(c.trim())+'</td>').join('')+'</tr>');return;}
    if((m=/^(?:[-*+]|\d+[.)、])\s+(?:\[[ xX]\]\s*)?(.*)$/.exec(x))){if(tb){out.push('</table>');tb=false;}if(!ul){out.push('<ul>');ul=true;}out.push('<li>'+inl(m[1])+'</li>');return;}
    close();out.push('<p>'+inl(x.replace(/^>\s*/,''))+'</p>');});
  close();return out.join('');}
function renderBrief(s){
  const b=s.brief, grid=$('#bf-grid'), legacy=$('#legacy-box'), ask=$('#ask-box');
  if(!b||!b.overview){
    grid.hidden=true;ask.hidden=true;legacy.hidden=false;
    $('#summary').innerHTML=s.summary?mdLite(s.summary):'<p class="bf-note">总结尚未完成，逐字稿已保留。</p>';
    const btn=$('#bf-build');btn.hidden=source!=='mac'||!(s.transcript||[]).length;btn.onclick=()=>buildBrief(btn);
    return;
  }
  legacy.hidden=true;grid.hidden=false;
  const map=spkMap(s), ov=b.overview, dur=Math.max(b.duration||0,...ov.topics.map(t=>t.to||0),1);
  let bar='',pos=0;ov.topics.forEach((t,i)=>{const f=Math.max(pos,t.from||0),to=Math.max(f,t.to||0);if(f>pos)bar+='<i class="gap" style="width:'+((f-pos)/dur*100)+'%"></i>';bar+='<i data-sec="'+f+'" title="'+esc(t.title)+' '+mmss(f)+'–'+mmss(to)+'" style="width:'+((to-f)/dur*100)+'%;background:'+COLORS[i%COLORS.length]+'">'+t.n+'</i>';pos=to;});
  const todoRows=ov.todos.map(t=>'<tr><td>'+nm(t.what,map)+'</td><td>'+(t.owner?(t.ownerSource==='suggested'?'<span class="bf-sug">'+nm(t.owner,map)+' · 建议</span>':nm(t.owner,map)):'<span class="bf-sug">未定</span>')+'</td><td>'+(t.due?esc(t.due):'<span class="bf-sug">未定</span>')+'</td></tr>').join('');
  $('#bf-sum').innerHTML=
    (b.meta&&b.meta.scope?'<p class="bf-scope">'+nm(b.meta.scope,map)+'</p>':'')
    +'<div class="bf-h">议题与时间分布</div><ul class="bf-topics">'+ov.topics.map((t,i)=>'<li><span class="bf-n" style="background:'+COLORS[i%COLORS.length]+'">'+t.n+'</span><span>'+nm(t.title,map)+'</span><span class="bf-dur">'+mmss(t.from)+'–'+mmss(t.to)+'</span></li>').join('')+'</ul><div class="bf-bar">'+bar+'</div>'
    +(ov.conclusions.length?'<div class="bf-h">核心结论</div>'+ov.conclusions.map(c=>'<div class="bf-key">'+nm(c,map)+'</div>').join(''):'')
    +(ov.todos.length?'<div class="bf-h">待办</div><table class="bf-table"><tr><th>事项</th><th>负责人</th><th>期限</th></tr>'+todoRows+'</table>':'')
    +'<div class="bf-h">议题展开</div>'+(b.topics||[]).map((t,i)=>{const head=ov.topics[i]||{};return '<div class="bf-card"><h3><span class="bf-n" style="background:'+COLORS[i%COLORS.length]+'">'+t.n+'</span>'+nm(head.title||'',map)+'</h3>'+(t.conclusion?'<div class="bf-key">'+nm(t.conclusion,map)+'</div>':'')+'<ul>'+t.points.map(x=>'<li>'+nm(x.text,map)+tbtn(x.at)+'</li>').join('')+'</ul>'+(t.open&&t.open.length?'<div class="bf-open">未决：'+t.open.map(x=>nm(x,map)).join('；')+'</div>':'')+'</div>';}).join('');
  const r=b.review, sec=(h,items)=>items&&items.length?'<div class="bf-h">'+h+'</div>'+items.join(''):'';
  $('#bf-rev').innerHTML=!r?'<p class="bf-note">'+(b.reviewWarning?'点评这次没生成出来：'+esc(b.reviewWarning):'点评尚未生成。')+'</p>':
    ((r.contextLoaded?'':'<p class="bf-note">未接项目背景，以下只依据会内内容。</p>')
    +sec('可能讲错的',r.errors.map(e=>'<div class="bf-item"><div class="bf-q">「'+nm(e.quote,map)+'」'+tbtn(e.at)+'</div><div>→ '+nm(e.why,map)+'</div><div class="bf-src">依据：'+esc(e.source||'会内推断')+' · '+esc(e.confidence)+'</div></div>'))
    +sec('补充背景',r.facts.map(f=>'<div class="bf-item">'+nm(f.text,map)+(f.source?'<div class="bf-src">'+esc(f.source)+'</div>':'')+'</div>'))
    +sec('和项目目标的关系',r.alignment.map(a=>'<div class="bf-item"><span class="bf-tag '+(a.status==='推进'?'ok':a.status==='偏离'?'bad':'')+'">'+esc(a.status)+'</span><b>'+esc(a.goal)+'</b><div>'+nm(a.note,map)+'</div></div>'))
    +sec('建议怎么做',r.advice.map((a,i)=>'<div class="bf-item"><span class="bf-tag">'+(i+1)+'</span>'+nm(a,map)+'</div>'))
    +sec('我核过的',r.checked.map(c=>'<div class="bf-item"><span class="bf-tag '+(c.result==='已核实'?'ok':c.result==='矛盾'?'bad':'')+'">'+esc(c.result)+'</span>'+nm(c.claim,map)+(c.note?'<div class="bf-src">'+nm(c.note,map)+'</div>':'')+'</div>')));
  const qs=b.questions||[];ask.hidden=!qs.length;
  if(qs.length){const ans=b.answers||{};
    const left=qs.filter(q=>!ans[q.id]).length;
    ask.innerHTML='<h2>'+(left?'需要你定一下 · 还剩 '+left+' 题':'需要你定的 '+qs.length+' 题都已确定')+'</h2>'+qs.map((q,i)=>{const a=ans[q.id];
      // 答过的收成一行：✓ 题目 → 你的答案，要改再点开
      if(a&&!askEditing.has(q.id)){const v=(a.text||'').trim();return '<div class="bf-qdone" data-q="'+esc(q.id)+'"><span class="bf-tag ok">✓ 已确定</span><span class="bf-qd-ask">'+esc(q.ask)+'</span><b>'+esc(q.options[a.choice]||'')+'</b>'+(v?'<span class="bf-src">补充：'+esc(v)+'</span>':'')+'<button type="button" class="bf-t" data-edit="'+esc(q.id)+'">改</button></div>';}
      const cur=a?a.choice:q.recommend;return '<div class="bf-qrow" data-q="'+esc(q.id)+'"><b>'+(i+1)+'　'+esc(q.ask)+'</b>'+q.options.map((o,k)=>'<button type="button" class="bf-opt'+(k===cur?' on':'')+'" data-k="'+k+'" title="'+(k===q.recommend?esc(q.why||'推荐'):'')+'">'+esc(o)+(k===q.recommend?' · 推荐':'')+'</button>').join('')+'<input type="text" placeholder="补一句（可选）" value="'+esc(a&&a.text||'')+'">'+spkProof(s,q)+'</div>';}).join('');
    ask.querySelectorAll('[data-edit]').forEach(el=>el.onclick=()=>{askEditing.add(el.dataset.edit);render(record);});
    ask.querySelectorAll('.bf-qrow').forEach(row=>{const qid=row.dataset.q;const send=(choice,text)=>saveAnswer(qid,choice,text);
      row.querySelectorAll('.bf-opt').forEach(o=>o.onclick=()=>send(Number(o.dataset.k),row.querySelector('input').value));
      row.querySelector('input').onchange=e=>{const on=row.querySelector('.bf-opt.on');send(on?Number(on.dataset.k):0,e.target.value);};});
  }
  document.querySelectorAll('#bf-grid [data-sec],#ask-box [data-sec]').forEach(el=>el.onclick=()=>jumpTo(Number(el.dataset.sec)));
}
// 问「说话人 N 是谁」时，把这个人说得最长的几句原话摆出来，点时间能回听——不给证据这题没法答
function spkProof(s,q){const k=(q.affects||[]).map(f=>/^speaker:S?(\w{1,12})$/i.exec(f)).filter(Boolean).map(m=>m[1])[0];if(!k)return '';
  const start=ts(s.start),rows=(s.transcript||[]).filter(r=>String(r.speaker||r.spk||r.who||'')===k&&(r.text||'').length>=12);if(!rows.length)return '';
  const all=(s.transcript||[]).filter(r=>String(r.speaker||r.spk||r.who||'')===k).length;
  const pick=[...rows].sort((a,b)=>b.text.length-a.text.length).slice(0,4).sort((a,b)=>Number(a.at||0)-Number(b.at||0));
  const sec=r=>{const at=Number(r.at||0);return at>1e11?Math.round((at-start)/1000):at;};
  return '<div class="bf-proof"><span class="bf-src">说话人 '+esc(k)+' 全场 '+all+' 句，说得最长的几句：</span>'+pick.map(r=>'<div class="bf-pq">「'+esc(r.text.length>90?r.text.slice(0,90)+'…':r.text)+'」<button type="button" class="bf-t" data-sec="'+sec(r)+'">'+mmss(sec(r))+'</button></div>').join('')+'</div>';}
function jumpTo(sec){seekTo(sec);const box=$('#tr-box');box.open=true;const rows=[...document.querySelectorAll('#transcript [data-sec]')];let hit=rows[0];rows.forEach(r=>{if(Number(r.dataset.sec)<=sec+1)hit=r;});if(hit){hit.scrollIntoView({block:'center',behavior:'smooth'});const p=hit.closest('p');if(p){p.style.background='#fff8e1';setTimeout(()=>p.style.background='',2500);}}}
const askEditing=new Set();
async function saveAnswer(qid,choice,text){
  askEditing.delete(qid);
  const b=record.brief;b.answers=b.answers||{};b.answers[qid]={choice,text:(text||'').trim(),at:Date.now()};
  render(record); // 先在页面上当场换掉，再存
  try{const r=await fetch('/asr-relay/meeting-answer?token='+encodeURIComponent(settings.relayToken||''),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,qid,choice,text:(text||'').trim()})});if(!r.ok)throw 0;}
  catch(e){delete record.brief.answers[qid];render(record);const row=document.querySelector('.bf-qrow[data-q="'+qid+'"]');if(row){const n=document.createElement('span');n.className='bf-tag bad';n.textContent='没存上，Mac 在线后再点一次';row.appendChild(n);}}
}
// P-17：以前这里叫「整理成新版」走 /meeting-brief，往期会议列表那个「重新整理」走 /meeting-retry，
// 同一个诉求两个按钮做两件事。现在两边都调 /meeting-retry，由服务端按缺什么补什么
// （缺总结就整场重跑、然后补新版数据、收敛和会议记忆），进度合成一条 /meeting-refresh-state。
async function buildBrief(btn){
  btn.disabled=true;btn.textContent='重新整理中，约 3–8 分钟…';
  const tk=encodeURIComponent(settings.relayToken||'');
  const back=msg=>{btn.disabled=false;btn.textContent='重新整理';btn.title=msg||'';const n=document.createElement('span');n.className='bf-src';n.textContent=' '+(msg||'没整理出来');btn.after(n);setTimeout(()=>n.remove(),8000);};
  try{const r=await fetch('/asr-relay/meeting-retry?token='+tk,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
      if(!r.ok)return back(await r.text().catch(()=>'')||'Mac 没接上');}catch(e){return back('Mac 没接上');}
  const began=Date.now();let idle=0;
  const poll=async()=>{try{const r=await fetch('/asr-relay/meeting-refresh-state?id='+encodeURIComponent(id)+'&token='+tk,{cache:'no-store'});const j=await r.json();
      if(j.state==='done'){location.reload();return;} if(j.state==='failed'||j.state==='empty')return back(j.error);
      if(j.state==='none'&&++idle>=6)return back('没启动起来，再点一次');if(Date.now()-began>45*60000)return back('等太久了，稍后刷新看看');
      if(j.phase)btn.textContent=j.phase+'…';}catch(e){}
    setTimeout(poll,5000);};
  setTimeout(poll,4000);
}
// 顶部会议信息：日历时间、组织者、参会人并在一行；置信度低时同一行标出来，可换一场
async function mountHead(s){
  if(source!=='mac')return;const meta=$('#meta');const tk=encodeURIComponent(settings.relayToken||'');
  const paint=j=>{let el=document.getElementById('cal-line');if(!el){el=document.createElement('span');el.id='cal-line';el.style.cssText='display:flex;flex-wrap:wrap;gap:10px;align-items:center;flex-basis:100%';meta.appendChild(el);}
    const ev=j&&j.event;if(!ev){el.innerHTML='<span>日历：'+esc(j&&j.chosen==='none'?'你标了不是日历上的会':(j&&j.reason||'没对上日程'))+'</span>'+(j&&j.chosen==='none'?'<button type="button" class="btn sm" data-cal="reset">重新匹配</button>':'');}
    else{const low=ev.confidence==='low'&&!ev.chosenByUser;const who=ev.attendees||[];
      el.innerHTML='<span>日程 <b>'+esc(ev.title)+'</b> '+esc((ev.start||'').slice(11,16)+(ev.end?'–'+ev.end.slice(11,16):''))+'</span>'+(ev.organizer?'<span>组织者 <b>'+esc(ev.organizer)+'</b></span>':'')+(who.length?'<span>参会 <b>'+who.length+'</b> 人：'+esc(who.join('、'))+'</span>':'')
        +(low?'<span class="bf-tag bad">按时间猜的</span>':'')+((ev.candidates||[]).length>1?'<select data-cal="pick">'+ev.candidates.map(c=>'<option value="'+esc(c.eventId)+'"'+(c.eventId===ev.eventId?' selected':'')+'>'+esc(c.title)+' '+esc((c.start||'').slice(11,16))+'</option>').join('')+'</select>':'')
        +(low?'<button type="button" class="btn sm" data-cal="'+esc(ev.eventId)+'">就是这场</button>':'')+'<button type="button" class="btn sm" data-cal="none">不是日历上的会</button>';}
    el.querySelectorAll('[data-cal]').forEach(c=>{const send=async v=>{el.style.opacity=.6;const r=await fetch('/asr-relay/calendar-match?id='+encodeURIComponent(id)+(v==='reset'?'&refresh=1':'')+'&token='+tk,v==='reset'?{cache:'no-store'}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({eventId:v})});el.style.opacity=1;paint(await r.json());};
      if(c.tagName==='SELECT')c.onchange=()=>send(c.value);else c.onclick=()=>send(c.dataset.cal);});};
  try{const r=await fetch('/asr-relay/calendar-match?id='+encodeURIComponent(id)+'&token='+tk,{cache:'no-store',signal:AbortSignal.timeout(60000)});paint(await r.json());}catch(e){}
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

// 下载和分享是同一件事，只留一个入口（顶栏这个）。
// 以前这里另有一份客户端拼的「全文与总结」，把会议过程中的几百条要点/待办/待核查全倒进去——
// 那不是给人读的。现在统一走 /share-export：总结 + 核心要点 + 核心纠错 + 核心待办 + 逐字稿。
$('#download').onclick=openTake;

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
      +'<span style="flex:1"></span><button type="button" id="note-copy">复制</button>'
      +'</div>'
      +'<div class="note-body">'+html+'</div>';
    document.getElementById('note-copy').onclick=async()=>{
      try{ await navigator.clipboard.writeText(j.note); document.getElementById('note-copy').textContent='已复制'; }
      catch(e){ document.getElementById('note-copy').textContent='复制失败'; }
    };
  }catch(e){ box.hidden=true; }
}

// 日历匹配的结果要让你一眼看到、一下改掉：猜对了就一个 ✓，猜得不稳就标「待确认」，点开能换一场或说「不是日历上的会」。
// 匹配错了不改，参会人和时间就会跟着错进纪要和分享文档。
async function mountCalendarChip(){
  let box=document.getElementById('cal-chip');
  if(!box){ box=document.createElement('div'); box.id='cal-chip'; box.className='cal-chip';
    (document.getElementById('note-box')||document.getElementById('player-box')).insertAdjacentElement('beforebegin', box); }
  if(source!=='mac'){ box.hidden=true; return; }
  const tok=encodeURIComponent(settings.relayToken||'');
  const paint=(j)=>{
    const ev=j.event; box.hidden=false;
    if(!ev){ box.innerHTML='<span class="cal-k">日历</span><span>'+esc(j.chosen==='none'?'你标了：不是日历上的会':(j.reason||'没对上日程'))+'</span>'+(j.chosen==='none'?'<button type="button" data-cal="reset">重新匹配</button>':''); }
    else {
      const low=ev.confidence==='low'&&!ev.chosenByUser;
      const when=(ev.start||'').slice(11,16)+(ev.end?'–'+ev.end.slice(11,16):'');
      box.innerHTML='<span class="cal-k">日历</span><b>'+esc(ev.title)+'</b><span class="cal-when">'+esc(when)+'</span>'
        +(ev.attendees&&ev.attendees.length?'<span class="cal-who">'+esc(ev.attendees.join('、'))+'</span>':'')
        +(low?'<span class="cal-warn">按时间猜的，待确认</span>':'<span class="cal-ok">✓</span>')
        +'<span style="flex:1"></span>'
        +((ev.candidates||[]).length>1?'<select data-cal="pick">'+(ev.candidates||[]).map(c=>'<option value="'+esc(c.eventId)+'"'+(c.eventId===ev.eventId?' selected':'')+'>'+esc(c.title)+' '+esc((c.start||'').slice(11,16))+'</option>').join('')+'</select>':'')
        +(low?'<button type="button" data-cal="'+esc(ev.eventId)+'">就是这场</button>':'')
        +'<button type="button" data-cal="none">不是日历上的会</button>';
    }
    box.querySelectorAll('[data-cal]').forEach(el=>{
      const send=async v=>{ box.style.opacity=.6; const r=await fetch('/asr-relay/calendar-match?id='+encodeURIComponent(id)+(v==='reset'?'&refresh=1':'')+'&token='+tok, v==='reset'?{cache:'no-store'}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({eventId:v})}); box.style.opacity=1; paint(await r.json()); mountNote(record); };
      if(el.tagName==='SELECT') el.onchange=()=>send(el.value); else el.onclick=()=>send(el.dataset.cal);
    });
  };
  try{ const r=await fetch('/asr-relay/calendar-match?id='+encodeURIComponent(id)+'&token='+tok,{cache:'no-store',signal:AbortSignal.timeout(60000)}); paint(await r.json()); }
  catch(e){ box.hidden=true; }
}
// 会后带走：下载和分享是同一件事的三个去处，共用同一份正文（纪要 + 逐字稿）。
// 分开做成三个按钮的话，三处各生成一遍，内容迟早对不上。
const tok=()=>encodeURIComponent(settings.relayToken||'');
async function openTake(){
  let d=document.getElementById('take-dlg');
  if(!d){
    d=document.createElement('dialog'); d.id='take-dlg'; d.className='take-dlg';
    d.innerHTML='<div class="take-head"><b>带走这一场</b><button type="button" data-x aria-label="关闭">×</button></div>'
      +'<p class="take-sub" id="take-sub">纪要 + 带说话人的逐字稿，一份 Markdown。</p>'
      +'<div class="take-row"><button type="button" class="p" id="take-dl">下载 Markdown</button></div>'
      +'<div class="take-row"><label for="take-lark">发到飞书</label>'
      +'<input id="take-q" placeholder="搜会话名，留空就发给我自己"><select id="take-lark"></select>'
      +'<button type="button" id="take-lark-go">发送</button></div>'
      +'<div class="take-row"><label>发到 Slack</label><span class="take-hint">发到你自己的 Slack 私聊</span>'
      +'<button type="button" id="take-slack-go">发送</button></div>'
      +'<p class="take-msg" id="take-msg" hidden></p>';
    document.body.appendChild(d);
    d.querySelector('[data-x]').onclick=()=>d.close();
    d.addEventListener('cancel',e=>{e.preventDefault();d.close();});
    d.addEventListener('click',e=>{if(e.target===d)d.close();});
    document.getElementById('take-dl').onclick=takeDownload;
    document.getElementById('take-q').oninput=debounceTargets();
    document.getElementById('take-lark-go').onclick=()=>takeSend('lark',{chatId:document.getElementById('take-lark').value});
    document.getElementById('take-slack-go').onclick=()=>takeSend('slack',{channel:'self'});
  }
  document.getElementById('take-msg').hidden=true;
  d.showModal();
  loadTargets('');
}
function debounceTargets(){ let t=null; return e=>{ clearTimeout(t); t=setTimeout(()=>loadTargets(e.target.value.trim()),400); }; }
async function loadTargets(q){
  const sel=document.getElementById('take-lark'); if(!sel) return;
  sel.innerHTML='<option value="self">发给我自己（飞书私聊）</option>';
  try{
    const r=await fetch('/asr-relay/share-targets?q='+encodeURIComponent(q)+'&token='+tok(),{cache:'no-store',signal:AbortSignal.timeout(25000)});
    const j=await r.json();
    if(!j.ok) return;
    sel.innerHTML=(j.lark||[]).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('')
      || '<option value="self">发给我自己（飞书私聊）</option>';
  }catch(e){ /* 搜不到就只剩「发给自己」，不打断 */ }
}
function takeMsg(text, warn){ const m=document.getElementById('take-msg'); m.textContent=text; m.className='take-msg'+(warn?' warn':''); m.hidden=false; }
async function takeDownload(){
  takeMsg('正在整理…');
  try{
    const r=await fetch('/asr-relay/share-export?id='+encodeURIComponent(id)+'&token='+tok(),{cache:'no-store',signal:AbortSignal.timeout(30000)});
    const j=await r.json();
    if(!j.ok) return takeMsg(j.error||'导不出来', true);
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([j.markdown],{type:'text/markdown;charset=utf-8'}));
    a.download=j.filename; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),4000);
    takeMsg('已下载 '+j.filename+'（'+Math.round(j.bytes/1024)+' KB）');
  }catch(e){ takeMsg('导不出来：'+e.message, true); }
}
async function takeSend(target, extra){
  const btn=document.getElementById(target==='lark'?'take-lark-go':'take-slack-go');
  btn.disabled=true; takeMsg(target==='slack'?'正在发到 Slack，走连接器会慢几秒…':'正在发…');
  try{
    const r=await fetch('/asr-relay/share-send?token='+tok(),{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({id,target,...extra}),signal:AbortSignal.timeout(200000)});
    const j=await r.json();
    const where=target==='lark'?'飞书':'Slack';
    takeMsg(j.ok
      ? (j.attached===false ? '纪要发到'+where+'了；逐字稿没能当附件发（'+(j.why||'')+'），用上面的下载拿全文'
                            : '发出去了（'+where+'，纪要 + 逐字稿附件）')
      : (j.error||'没发出去'), !j.ok);
  }catch(e){ takeMsg('没发出去：'+e.message, true); }
  finally{ btn.disabled=false; }
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
