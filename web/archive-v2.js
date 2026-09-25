'use strict';
// 会后页 v2（Aaron 2026-09-24 拍板）：首屏 = 这场会改变了什么 / 洞察→行动 / 下一步最重要的一件事 / 会议纪要。
// 数据全由服务端在 /meeting-result 里挑好（result.view），这里只渲染；旧版全量视图仍由 archive.js 渲染在 #legacy 里，收进右上角「⋯」。
// ⌘E：鼠标所在的块进入编辑，回车存（PATCH /archive-edit → enhanced.overrides），Esc / 失焦 = 撤回。💬 评论由 page-comments.js 管，两者并存。
(function(){
  const mid=new URLSearchParams(location.search).get('id')||'';
  const host=document.getElementById('v2');
  if(!mid||!host)return;
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const tok=()=>{let s={};try{s=JSON.parse(localStorage.getItem('tht-settings')||'{}');}catch{}return encodeURIComponent(s.relayToken||(window.THT_BOOT&&window.THT_BOOT.relayToken)||'');};
  const hhmm=t=>{const d=new Date(Number(t)||Date.now());return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');};
  let view=null,title='',start=0,open=new Set(),busy=new Set(),err=new Map();

  // ---- 右上角「⋯」：录音 / 下载 / 分享 / 逐字稿 / 旧版全量视图 ----
  const menu=document.getElementById('v2-menu'),more=document.getElementById('v2-more');
  const show=(sel,openDetails)=>{const el=$(sel);if(!el)return;el.classList.add('v2-show');el.hidden=false;if(openDetails&&el.tagName==='DETAILS')el.open=true;el.scrollIntoView({behavior:'smooth',block:'start'});};
  const ITEMS=[
    ['录音',()=>show('#aux-box',true)],
    ['下载 / 分享',()=>{const b=$('#download');if(b)b.click();}],
    ['逐字稿',()=>show('#tr-box',true)],
    ['旧版全量视图',()=>{document.body.classList.toggle('v2-full');paintMenu();}],
  ];
  function paintMenu(){menu.innerHTML=ITEMS.map((it,i)=>'<button type="button" data-m="'+i+'">'+esc(it[0]==='旧版全量视图'&&document.body.classList.contains('v2-full')?'收起旧版全量视图':it[0])+'</button>').join('');
    menu.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>{menu.hidden=true;ITEMS[Number(b.dataset.m)][1]();});}
  if(more&&menu){paintMenu();more.onclick=e=>{e.stopPropagation();menu.hidden=!menu.hidden;};document.addEventListener('mousedown',e=>{if(!menu.hidden&&!menu.contains(e.target)&&e.target!==more)menu.hidden=true;});}

  // ---- 渲染 ----
  const edh=(path,cls,inner,tag)=>'<'+(tag||'span')+' class="'+esc(cls||'')+'" data-path="'+esc(path)+'">'+inner+'</'+(tag||'span')+'>';
  const ed=(path,cls,text,tag)=>edh(path,cls,esc(text),tag);
  function card(x,path){
    const sid=x.sourceId,who=x.owner||'我';
    const sent=x.sent;
    return '<div class="v2-card" data-sid="'+esc(sid)+'"><div class="txt">'
      +'<div class="to">给 '+edh(path+'.owner','','<b>'+esc(who)+'</b>')+(x.topic&&x.topic!=='默认'?' · '+esc(x.topic):'')+'</div>'
      +ed(path+'.action','what',x.action||x.text||'','p')
      +(err.get(sid)?'<span class="err">'+esc(err.get(sid))+'</span>':'')
      +'</div>'
      +(sent?'<div class="st"><span class="sent">已发 · '+hhmm(sent.at)+(sent.person&&sent.person!==who?' · 给 '+esc(sent.person):'')+(sent.partial?' · 部分没成':'')+(sent.taskUrl?' · <a href="'+esc(sent.taskUrl)+'" target="_blank" rel="noopener">任务</a>':'')+'</span>'
        +(sent.partial?'<button type="button" class="go" data-retry="'+esc(sid)+'" title="任务、私聊、行动清单里没成的那几样再发一次，已成的不重发"'+(busy.has(sid)?' disabled':'')+'>'+(busy.has(sid)?'发送中…':'补发没成的')+'</button>':'')
        +'<span class="sub">发出去的任务和私聊撤不回；要改，去飞书里改那条任务。</span></div>'
       :'<button type="button" class="go" data-go="'+esc(sid)+'" title="把这个人在这场会的所有行动合成一条：一条飞书任务 + 一条私聊 + 行动清单 @他。发出后撤不回。"'+(busy.has(sid)?' disabled':'')+'>'+(busy.has(sid)?'发送中…':'发')+'</button>')
      +'</div>';
  }
  // 0.6.19（Aaron 2026-09-24「no template」）：第 2 块正文 = 模型自由写的 markdown（view.insightsMd），
  // 这里只渲染；右侧行动卡只对正文里 `@<人名>：` 的行生成（服务端 app/archive-v2.js actionsFromMd 已经挑好）。
  function mdInline(t){ return esc(String(t==null?'':t))
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s"']+)\)/g,function(m,x,u){return '<a href="'+u+'" target="_blank" rel="noopener">'+x+'</a>';}); }
  function mdHtml(src){
    const lines=String(src==null?'':src).replace(/\r/g,'').split('\n');
    let out='',list=null,first=true,sec=0;
    const closeList=function(){ if(list){ out+=(list==='ol'?'</ol>':'</ul>'); list=null; } };
    for(const raw of lines){
      const l=raw.trim();
      if(!l){ closeList(); continue; }
      if(/^(-{3,}|\*{3,})$/.test(l)){ closeList(); out+='<hr class="md-hr">'; continue; }
      const h=/^(#{1,6})\s+(.*)$/.exec(l);
      if(h){ closeList(); if(sec)out+='</article>'; sec++; out+='<article class="md-story"><div class="md-no">'+String(sec).padStart(2,'0')+'</div><h3 class="md-h">'+mdInline(h[2].replace(/\*\*/g,''))+'</h3>'; first=false; continue; }
      const q=/^>\s?(.*)$/.exec(l);
      if(q){ closeList(); out+='<blockquote class="md-q">'+mdInline(q[1])+'</blockquote>'; continue; }
      const ol=/^(\d+)[.)]\s+(.*)$/.exec(l);
      if(ol){ if(list!=='ol'){ closeList(); out+='<ol class="md-ol">'; list='ol'; } out+='<li>'+mdInline(ol[2])+'</li>'; continue; }
      const li=/^[-*+]\s+(.*)$/.exec(l);
      if(li){ if(list!=='ul'){ closeList(); out+='<ul class="md-ul">'; list='ul'; } out+='<li>'+mdInline(li[1])+'</li>'; continue; }
      closeList();
      const at=/^@[^：:]{1,20}[：:]/.test(l);
      const lead=first&&/^\*\*/.test(l);
      out+='<p class="md-p'+(at?' md-at':'')+(lead?' md-lead':'')+'">'+mdInline(l)+'</p>';
      first=false;
    }
    closeList(); if(sec)out+='</article>';
    return out;
  }
  function insightsHtml(){
    const md=String(view.insightsMd||'').trim();
    if(!md&&!view.insights.length)return '<div class="v2-row"><span>这场没整理出来。</span></div>';
    return '<div class="v2-md" data-path="insights_md">'+mdHtml(md)+'</div>'
      +view.insights.map(function(i){return card(i,'insights.'+i.n);}).join('');
  }
  const TT_CLS={'已一致':'ok','待讨论':'open','有分歧':'bad','搁置':'mute'};
  function minutesHtml(m){
    return '<section class="v2-min"><h2>会议纪要<span class="sp"></span><button type="button" class="btn sm" id="v2-copy">复制纪要</button><button type="button" class="btn sm" id="v2-share">发到群</button></h2>'
      +(m.topic?ed('minutes.topic','',m.topic,'p'):'')
      +(m.conclusions.length?'<h3>结论</h3><ol>'+m.conclusions.map((c,k)=>'<li data-path="summary.'+k+'">'+esc(c)+'</li>').join('')+'</ol>':'')
      +((m.topicTable||[]).length?'<h3>议题</h3><div class="v2-tt-wrap"><table class="v2-tt"><thead><tr><th>议题</th><th>结论</th><th>状态</th><th>未对齐</th><th>下一步</th></tr></thead><tbody>'
        +m.topicTable.map(r=>'<tr><td><b>'+esc(r.title)+'</b></td><td>'+(esc(r.conclusion)||'—')+'</td><td><span class="v2-st v2-st-'+TT_CLS[r.status]+'">'+esc(r.status)+'</span></td><td>'+(esc(r.open)||'—')+'</td><td>'+(esc(r.next)||'—')+'</td></tr>').join('')+'</tbody></table></div>':'')
      +(m.todos.length?'<h3>待办</h3><ul>'+m.todos.map(t=>'<li>'+esc(t.text)+(t.owner&&t.owner!=='未指定'?' <span class="who">— '+esc(t.owner)+'</span>':'')+'</li>').join('')+'</ul>':'')
      +(m.participants.length?'<h3>参会人</h3><p>'+esc(m.participants.join('、'))+'</p>':'')
      +'<p class="v2-msg" id="v2-min-msg" hidden></p></section>';
  }
  function minutesMd(m){
    const L=['# '+title,'',m.topic||''];
    if(m.conclusions.length){L.push('','## 结论');m.conclusions.forEach((c,k)=>L.push((k+1)+'. '+c));}
    if((m.topicTable||[]).length){const c=x=>String(x||'—').replace(/\|/g,'／');L.push('','## 议题','','| 议题 | 结论 | 状态 | 未对齐 | 下一步 |','|---|---|---|---|---|');m.topicTable.forEach(r=>L.push('| '+[r.title,r.conclusion,r.status,r.open,r.next].map(c).join(' | ')+' |'));}
    if(m.todos.length){L.push('','## 待办');m.todos.forEach(t=>L.push('- '+t.text+(t.owner&&t.owner!=='未指定'?'（'+t.owner+'）':'')));}
    if(m.participants.length)L.push('','参会人：'+m.participants.join('、'));
    return L.join('\n').trim()+'\n';
  }
  function render(){
    if(!view){host.hidden=true;return;}
    host.hidden=false;
    host.innerHTML=
      '<section><h2><span class="n">1</span>这场会改变了什么<span class="sp"></span><span class="hint">⌘E 改鼠标所在的那一块 · 回车存 · Esc 撤回</span></h2>'+(view.changes.length?view.changes.map((c,k)=>'<div class="v2-row"><span class="v2-tag k-'+esc(c.kind)+'">'+esc(c.kind)+'</span>'+ed('changes.'+k,'',c.text)+'</div>').join(''):'<div class="v2-row"><span>这场没整理出改变。</span></div>')+'</section>'
      +'<section><h2><span class="n">2</span>想法</h2>'+insightsHtml()+'</section>'
      +(view.next?'<section><h2><span class="n">3</span>下一步最重要的一件事</h2><div class="v2-next"><div>'+ed('next.text','big',view.next.text,'p')+'</div>'+card(view.next,'next')+'</div></section>':'')
      +minutesHtml(view.minutes);
    host.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>send(b.dataset.go));
    host.querySelectorAll('[data-retry]').forEach(b=>b.onclick=()=>send(b.dataset.retry,true));
    const cp=$('#v2-copy');if(cp)cp.onclick=async()=>{try{await navigator.clipboard.writeText(minutesMd(view.minutes));msg('纪要已复制（Markdown）');}catch(e){msg('复制没成：'+e.message);}};
    const sh=$('#v2-share');if(sh)sh.onclick=()=>{const b=$('#download');if(b)b.click();};
  }
  function msg(t){const m=$('#v2-min-msg');if(!m)return;m.textContent=t;m.hidden=false;setTimeout(()=>{m.hidden=true;},4000);}

  // ---- 「发」：复用 /person-handoff（一人一条任务 + 一条私聊 + 行动清单 @他）。点任何一张卡 = 把这个人在这场会所有还没发的行动收齐，一次 POST body.items，
  //      对方只收到一条消息（Aaron 09-24："to the same guy it should be in one message"）。发出后每张卡各自变「已发 · 时间」。----
  function cards(){const L=[];if(view.next)L.push({sid:view.next.sourceId,owner:view.next.owner,text:view.next.text,node:view.next});for(const i of view.insights)L.push({sid:i.sourceId,owner:i.owner,text:i.action||i.stance,node:i});return L.filter(c=>c.sid&&c.text);}
  // retry：只收这个人「部分没成」的那几张（服务端 retryFailed 只补失败的渠道）；普通发：只收还没发的
  function batchOf(sid,retry){
    const me=cards().find(c=>c.sid===sid);if(!me)return null;
    const who=me.owner||'我';
    const items=cards().filter(c=>(c.owner||'我')===who&&(retry?c.node.sent&&c.node.sent.partial:!c.node.sent)&&!busy.has(c.sid));
    return {person:who,items:items.length?items:[me]};
  }
  function meetingDate(){try{const d=new Date(start||Date.now());const p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());}catch(e){return '';}}
  async function send(sid,retry){
    const b=batchOf(sid,retry);if(!b||busy.has(sid))return;
    const sids=b.items.map(c=>c.sid);
    sids.forEach(s=>{busy.add(s);err.delete(s);});render();
    try{
      const r=await fetch('/asr-relay/person-handoff?token='+tok(),{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({meetingId:mid,kind:'todo',person:b.person,items:b.items.map(c=>({text:c.text,sourceId:c.sid})),confirmed:true,...(retry?{retryFailed:true,retryConfirmed:true}:{}),meetingTitle:title,meetingDate:meetingDate()}),signal:AbortSignal.timeout(120000)});
      const j=await r.json().catch(()=>({}));
      if(!r.ok||!j.ok)throw new Error(j.error||('HTTP '+r.status));
      const sent={at:j.at||Date.now(),partial:!!j.partial,person:(j.assignee&&j.assignee.name)||b.person,taskUrl:(j.task&&j.task.url)||''};
      b.items.forEach(c=>{c.node.sent=sent;});
      if(j.partial)sids.forEach(s=>err.set(s,'只成了一部分，失败：'+(j.failed||[]).join('、')));
    }catch(e){sids.forEach(s=>err.set(s,'没发出去：'+(e.message||e)));}
    sids.forEach(s=>busy.delete(s));render();
  }

  // ---- ⌘E：鼠标所在的块进入编辑；回车存、Esc / 失焦撤回 ----
  let mx=0,my=0,editing=null;
  document.addEventListener('mousemove',e=>{mx=e.clientX;my=e.clientY;},{passive:true});
  document.addEventListener('keydown',e=>{
    if(!(e.metaKey||e.ctrlKey)||String(e.key).toLowerCase()!=='e'||editing)return;
    const at=document.elementFromPoint(mx,my);const el=at&&at.closest&&at.closest('#v2 [data-path]');
    if(!el)return;e.preventDefault();beginEdit(el);
  });
  function beginEdit(el){
    // 「想法」那一块编辑的是 markdown 原文（不是渲染后的文字），换行用 Shift+Enter，回车存
    const isMd=el.dataset.path==='insights_md';
    const orig=isMd?String(view.insightsMd||''):el.textContent;
    editing={el,orig,path:el.dataset.path,isMd};
    if(isMd){el.classList.add('v2-md-edit');el.textContent=orig;}
    el.contentEditable='true';el.focus();
    try{const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);}catch{}
    const done=()=>{el.contentEditable='false';el.classList.remove('v2-md-edit');el.removeEventListener('keydown',onKey);el.removeEventListener('blur',onBlur);editing=null;};
    const cancel=()=>{if(isMd)el.innerHTML=mdHtml(orig);else el.textContent=orig;done();};
    const onKey=async ev=>{
      if(ev.key==='Escape'){ev.preventDefault();cancel();return;}
      if(ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();const text=(isMd?el.innerText:el.textContent).trim();el.removeEventListener('blur',onBlur);
        if(text===orig.trim()){cancel();return;}
        el.contentEditable='false';
        try{await save(editing.path,text);done();}catch(x){cancel();msg('没存上：'+(x.message||x));}}
    };
    const onBlur=()=>cancel();
    el.addEventListener('keydown',onKey);el.addEventListener('blur',onBlur);
  }
  async function save(path,text){
    const r=await fetch('/asr-relay/archive-edit?token='+tok(),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:mid,path,text}),signal:AbortSignal.timeout(15000)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||('HTTP '+r.status));
    if(j.view){view=j.view;render();}
  }

  // ---- 取数：和 archive.js 各取一次 /meeting-result（服务端已把 view 挑好）----
  async function load(){
    try{
      const r=await fetch('/asr-relay/meeting-result?id='+encodeURIComponent(mid)+'&token='+tok(),{cache:'no-store',signal:AbortSignal.timeout(8000)});
      if(!r.ok)throw new Error(String(r.status));
      const s=await r.json();
      title=s.topicTitle||s.title||'';start=s.start||0;
      view=s.view||null;
      if(!view){document.body.classList.add('v2-full');}   // 没有 v2 数据（未归档 / 老场）就直接给旧版全量
      render();
    }catch(e){document.body.classList.add('v2-full');}
  }
  load();
  window.THT_ARCHIVE_V2={reload:load,view:()=>view};
})();
