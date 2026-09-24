'use strict';
// 会后「主题文档更新」预览（Aaron 2026-09-25）：每主题一份飞书真源文档，这场会带来的增量先在这里给差异预览，
// 只有点「接受」才带 confirmed:true 调 /topic-diff/apply 写飞书；不点不写。独立文件、独立区块 #topic-doc，不碰 archive-v2.js。
(function(){
  const mid=new URLSearchParams(location.search).get('id')||'';
  const box=document.getElementById('topic-doc');
  if(!mid||!box)return;
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const tok=()=>{let s={};try{s=JSON.parse(localStorage.getItem('tht-settings')||'{}');}catch{}return encodeURIComponent(s.relayToken||(window.THT_BOOT&&window.THT_BOOT.relayToken)||'');};
  const api=(path,opt)=>fetch('/asr-relay/'+path+(path.includes('?')?'&':'?')+'token='+tok(),Object.assign({cache:'no-store',signal:AbortSignal.timeout(opt&&opt.method==='POST'?180000:8000)},opt||{})).then(r=>r.json().then(j=>({status:r.status,j})));
  const post=(path,body)=>api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  function show(html){box.innerHTML='<h2>主题文档更新</h2>'+html;box.hidden=false;}
  function renderDiff(d){
    const groups=(d.sections||[]).filter(g=>g.items&&g.items.length);
    const head='<div class="td-meta">主题 <b>'+esc(d.topic)+'</b>'+(d.owner?' · 负责人 '+esc(d.owner):'')+' · '+esc(d.date||'')+'</div>';
    if(!groups.length){show(head+'<p class="td-empty">这场会对该主题没有新增。</p>');return;}
    const body=groups.map(g=>'<div class="td-sec"><div class="td-h">'+esc(g.section)+'</div>'+g.items.map(it=>
      '<label class="td-item"><input type="checkbox" data-id="'+esc(it.id)+'" checked> <span class="td-add">+ '+esc(it.text)+'</span> <span class="td-ev">'+esc((it.evidence||[]).join(' '))+'</span></label>').join('')+'</div>').join('');
    show(head+body+'<div class="td-bar"><button type="button" class="btn sm" id="td-accept">接受，写进主题文档</button><span id="td-msg" class="td-msg"></span></div>');
    box.querySelector('#td-accept').onclick=accept;
  }
  async function accept(){
    const ids=[...box.querySelectorAll('input[data-id]:checked')].map(i=>i.dataset.id);
    const msg=box.querySelector('#td-msg'),btn=box.querySelector('#td-accept');
    if(!ids.length){msg.textContent='没有勾选条目';return;}
    btn.disabled=true;msg.textContent='写入中…';
    try{const {j}=await post('topic-diff/apply',{id:mid,ids,confirmed:true});
      if(!j.ok)throw new Error(j.error||'写入失败');
      msg.textContent=j.skipped==='no_document'?'该主题还没有飞书文档，未写入':'已写入 '+(j.applied||[]).length+' 条';
    }catch(e){btn.disabled=false;msg.textContent='失败：'+e.message;}
  }
  async function compute(){
    show('<p class="td-empty">正在生成差异…</p>');
    try{const r=await api('meeting-result?id='+encodeURIComponent(mid));
      const {j}=await post('topic-diff/compute',{enhanced:Object.assign({},r.j,{id:mid})});
      if(!j.ok)throw new Error(j.error||'生成失败');
      if(!j.matched){show('<p class="td-empty">这场会没有对上任何主题。</p>');return;}
      renderDiff(j.diff);
    }catch(e){show('<p class="td-empty">生成失败：'+esc(e.message)+'</p>');}
  }
  async function load(){
    try{const {status,j}=await api('topic-diff?id='+encodeURIComponent(mid));
      if(j.ok&&j.diff)return renderDiff(j.diff);
      if(status===404){show('<p class="td-empty">还没有这场会的主题差异。</p><button type="button" class="btn sm" id="td-gen">生成差异预览</button>');box.querySelector('#td-gen').onclick=compute;}
    }catch(e){}
  }
  load();
  window.THT_TOPIC_DOC={reload:load};
})();
